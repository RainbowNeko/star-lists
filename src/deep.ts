import type { FileCache } from './cache.js';
import { GitHubError, RateLimitError, type GitHubClient } from './github.js';
import {
  parseCargoToml,
  parseGoMod,
  parsePackageJson,
  parsePyprojectToml,
  parseReadme,
  parseSetupCfg,
  parseSetupPy,
  treeHasGoMain,
  treeHasMainEntry,
} from './manifests.js';
import type { DeepSignals, StarredRepo } from './types.js';
import { mapLimit } from './util.js';

export interface DeepAnalyzerOptions {
  concurrency?: number;
  cache?: FileCache;
  log?: (message: string) => void;
  onProgress?: (done: number, total: number, current: string) => void;
}

function emptySignals(): DeepSignals {
  return {
    files: [],
    kernel: { kconfig: false, objM: false, bpfSource: false, moduleInit: false },
    hasDockerfile: false,
    hasCompose: false,
    hasTauri: false,
    hasElectronBuilder: false,
    hasAndroidManifest: false,
    hasXcodeProject: false,
    hasWebIndex: false,
    hasMainEntry: false,
    hasFrontendFramework: false,
    hasGguf: false,
    hasSafetensors: false,
    hasModelIndex: false,
    hasTokenizer: false,
    hasModelConfig: false,
    hasOnnx: false,
    hasTflite: false,
    hasCoreml: false,
    hasLora: false,
    hasTrainingScript: false,
    errors: [],
  };
}

const FRONTEND_DEPS = new Set([
  'react',
  'react-dom',
  'vue',
  'svelte',
  '@angular/core',
  'solid-js',
  'preact',
  'next',
  'nuxt',
  'astro',
]);

function findRoot(paths: string[], name: string): string | undefined {
  const lowered = name.toLowerCase();
  return paths.find((path) => path.toLowerCase() === lowered);
}

function findReadme(paths: string[]): string | undefined {
  const candidates = paths
    .filter((path) => /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(path))
    .sort((a, b) => {
      const rank = (p: string): number => (p.toLowerCase() === 'readme.md' ? 0 : 1);
      return rank(a) - rank(b);
    });
  return candidates[0];
}

/**
 * 深度分析器：每个仓库读取一次文件树，再按需读取 manifest / README。
 * 结果按 `owner/name@pushedAt` 缓存，仓库更新后自动失效。
 */
export class DeepAnalyzer {
  private readonly client: GitHubClient;
  private readonly cache?: FileCache;
  private readonly concurrency: number;
  private readonly onProgress?: DeepAnalyzerOptions['onProgress'];

  constructor(client: GitHubClient, options: DeepAnalyzerOptions = {}) {
    this.client = client;
    this.cache = options.cache;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.onProgress = options.onProgress;
  }

  async analyzeRepos(
    repos: StarredRepo[],
    options: { onProgress?: (done: number, total: number, current: string) => void } = {},
  ): Promise<Map<string, DeepSignals>> {
    const result = new Map<string, DeepSignals>();
    let done = 0;
    const total = repos.length;
    await mapLimit(repos, this.concurrency, async (repo) => {
      const signals = await this.analyzeRepo(repo);
      result.set(repo.nameWithOwner.toLowerCase(), signals);
      done += 1;
      options.onProgress?.(done, total, repo.nameWithOwner);
      this.onProgress?.(done, total, repo.nameWithOwner);
    });
    return result;
  }

  async analyzeRepo(repo: StarredRepo): Promise<DeepSignals> {
    if (repo.isPrivate) {
      const signals = emptySignals();
      signals.errors.push('私有仓库跳过深度分析');
      return signals;
    }

    const cacheKey = `deep:v2:${repo.nameWithOwner.toLowerCase()}@${repo.pushedAt ?? 'unknown'}`;
    if (this.cache) {
      const cached = await this.cache.get<DeepSignals>(cacheKey);
      if (cached) return cached.data;
    }

    const signals = emptySignals();
    const branch = repo.defaultBranch || 'main';

    let tree;
    try {
      tree = await this.client.getTree(repo.nameWithOwner, branch);
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      if (error instanceof GitHubError && error.status === 404 && branch !== 'main') {
        try {
          tree = await this.client.getTree(repo.nameWithOwner, 'main');
        } catch (fallbackError) {
          if (fallbackError instanceof RateLimitError) throw fallbackError;
          signals.errors.push(`读取文件树失败：${String(fallbackError)}`);
          return signals;
        }
      } else {
        signals.errors.push(`读取文件树失败：${String(error)}`);
        return signals;
      }
    }

    const paths = tree.tree.map((entry) => entry.path);
    if (tree.truncated) signals.errors.push('文件树被 GitHub 截断，仅分析可见部分');

    // ── 文件存在性信号 ────────────────────────────────────────────
    signals.hasDockerfile = paths.some((path) => {
      const lower = path.toLowerCase();
      return (
        lower === 'dockerfile' ||
        lower === 'containerfile' ||
        lower === 'docker/dockerfile'
      );
    });
    signals.hasCompose = paths.some((path) =>
      /^(docker-)?compose\.ya?ml$/i.test(path),
    );
    signals.hasTauri = paths.some(
      (path) => /(^|\/)src-tauri\/tauri\.conf\.json$/i.test(path) || /^tauri\.conf\.json$/i.test(path),
    );
    signals.hasElectronBuilder = paths.some((path) =>
      /^electron-builder\.(json|ya?ml|js|ts|mjs|cjs)$/i.test(path),
    );
    signals.hasAndroidManifest = paths.some((path) => /(^|\/)AndroidManifest\.xml$/i.test(path));
    signals.hasXcodeProject = paths.some((path) => /\.xcodeproj(\/|$)/i.test(path));
    signals.hasWebIndex = paths.some((path) =>
      /^(public\/|src\/)?index\.html$/i.test(path),
    );
    signals.kernel.kconfig = Boolean(findRoot(paths, 'Kconfig'));
    signals.kernel.bpfSource = paths.some((path) => /\.bpf\.c$/i.test(path));

    // ── 模型文件信号（端侧 / 大模型）─────────────────────────────
    signals.hasGguf = paths.some((path) => /\.gguf$/i.test(path));
    signals.hasSafetensors = paths.some((path) => /\.safetensors$/i.test(path));
    signals.hasModelIndex = paths.some((path) =>
      /(^|\/)(model|pytorch_model)\.safetensors\.index\.json$|(^|\/)pytorch_model\.bin\.index\.json$/i.test(path),
    );
    signals.hasTokenizer = paths.some((path) =>
      /^((tokenizer|tokenizer_config)\.json|tokenizer\.model|vocab\.json)$/i.test(path),
    );
    signals.hasModelConfig = paths.some((path) => /^config\.json$/i.test(path));
    signals.hasOnnx = paths.some((path) => /\.onnx$/i.test(path));
    signals.hasTflite = paths.some((path) => /\.tflite$/i.test(path));
    signals.hasCoreml = paths.some((path) => /\.(mlmodel|mlpackage)$/i.test(path));
    signals.hasLora = paths.some((path) =>
      /(^|\/)(adapter_config\.json|adapter_model\.(safetensors|bin))$/i.test(path),
    );
    signals.hasTrainingScript = paths.some((path) =>
      /^(train|finetune|fine_tune|trainer)\.py$/i.test(path),
    );

    // ── 读取 manifest / README ───────────────────────────────────
    const fetchPlan: { kind: string; path: string; maxBytes?: number }[] = [];
    for (const name of ['package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg', 'go.mod']) {
      const path = findRoot(paths, name);
      if (path) fetchPlan.push({ kind: name, path });
    }
    const readme = findReadme(paths);
    if (readme) fetchPlan.push({ kind: 'readme', path: readme, maxBytes: 96 * 1024 });
    const makefile = findRoot(paths, 'Makefile') ?? findRoot(paths, 'Kbuild');
    if (makefile) fetchPlan.push({ kind: 'makefile', path: makefile, maxBytes: 128 * 1024 });

    const contents = new Map<string, string>();
    await Promise.all(
      fetchPlan.map(async (item) => {
        const text = await this.client.getRawFile(
          repo.nameWithOwner,
          branch,
          item.path,
          item.maxBytes ?? 64 * 1024,
        );
        if (text !== null) {
          contents.set(item.kind, text);
          signals.files.push(item.path);
        }
      }),
    );

    const packageText = contents.get('package.json');
    if (packageText) {
      const info = parsePackageJson(packageText);
      if (info) signals.packageJson = info;
      else signals.errors.push('package.json 解析失败');
    }

    const cargoText = contents.get('Cargo.toml');
    if (cargoText) {
      const info = parseCargoToml(cargoText);
      if (info) signals.cargo = info;
      else signals.errors.push('Cargo.toml 解析失败');
    }

    const pyprojectText = contents.get('pyproject.toml');
    const setupPyText = contents.get('setup.py');
    const setupCfgText = contents.get('setup.cfg');
    const python =
      (pyprojectText ? parsePyprojectToml(pyprojectText) : null) ??
      (setupPyText ? parseSetupPy(setupPyText) : null) ??
      (setupCfgText ? parseSetupCfg(setupCfgText) : null);
    if (python) signals.python = python;

    const goText = contents.get('go.mod');
    if (goText || treeHasGoMain(paths)) {
      const info = goText
        ? parseGoMod(goText)
        : { hasMain: false, module: '', imports: [] };
      info.hasMain = treeHasGoMain(paths);
      signals.go = info;
    }

    const makefileText = contents.get('makefile');
    if (makefileText) {
      signals.kernel.objM = /^\s*obj-[my]\s*[:+?]?=/m.test(makefileText);
      signals.kernel.moduleInit = /module_init\s*\(/.test(makefileText);
    }

    const readmeText = contents.get('readme');
    if (readmeText) {
      signals.readme = parseReadme(readmeText, readme ?? 'README.md');
    }

    // ── 汇总入口 / 前端框架信号 ──────────────────────────────────
    const frontendDeps = new Set([
      ...(signals.packageJson?.dependencies ?? []),
      ...(signals.packageJson?.devDependencies ?? []),
    ]);
    signals.hasFrontendFramework = [...FRONTEND_DEPS].some((dep) => frontendDeps.has(dep));
    signals.hasMainEntry =
      treeHasMainEntry(paths, repo.language) ||
      Boolean(signals.packageJson?.hasBin) ||
      Boolean(signals.cargo?.hasBin) ||
      Boolean(signals.go?.hasMain);

    if (signals.errors.length === 0 && this.cache) {
      await this.cache.set(cacheKey, signals);
    }
    return signals;
  }
}
