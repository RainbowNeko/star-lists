import { parse as parseToml } from 'smol-toml';
import type { Evidence } from './types.js';
import type {
  CargoInfo,
  DeepSignals,
  GoInfo,
  PackageJsonInfo,
  PythonInfo,
  ReadmeInfo,
} from './types.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function depNames(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record) : [];
}

/** 解析 package.json；失败返回 null。 */
export function parsePackageJson(text: string): PackageJsonInfo | null {
  try {
    const pkg = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
    const record = asRecord(pkg);
    if (!record) return null;
    const deps = [
      ...depNames(record.dependencies),
      ...depNames(record.optionalDependencies),
      ...depNames(record.peerDependencies),
    ];
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      private: record.private === true,
      hasBin:
        typeof record.bin === 'string' ||
        Boolean(record.bin && Object.keys(asRecord(record.bin) ?? {}).length > 0),
      hasExports: record.exports !== undefined,
      hasTypes: record.types !== undefined || record.typings !== undefined,
      workspaces: record.workspaces !== undefined,
      dependencies: deps,
      devDependencies: depNames(record.devDependencies),
      scripts: depNames(record.scripts),
    };
  } catch {
    return null;
  }
}

/** 解析 Cargo.toml。 */
export function parseCargoToml(text: string): CargoInfo | null {
  try {
    const doc = asRecord(parseToml(text) as unknown);
    if (!doc) return null;
    const pkg = asRecord(doc.package);
    const lib = asRecord(doc.lib);
    const bins = doc.bin;
    const dependencies = [
      ...depNames(doc.dependencies),
      ...depNames(doc['dev-dependencies']),
      ...depNames(doc['build-dependencies']),
    ];
    const crateTypes = asStringArray(lib?.['crate-type']);
    return {
      hasBin: Array.isArray(bins) && bins.length > 0,
      hasLib: Boolean(lib) || crateTypes.length > 0,
      crateTypes,
      dependencies,
      isWorkspace: !pkg && doc.workspace !== undefined,
    };
  } catch {
    return null;
  }
}

/** 解析 pyproject.toml（PEP 621 / Poetry）。 */
export function parsePyprojectToml(text: string): PythonInfo | null {
  try {
    const doc = asRecord(parseToml(text) as unknown);
    if (!doc) return null;
    const project = asRecord(doc.project);
    const poetry = asRecord(asRecord(doc.tool)?.poetry);
    const scripts = asRecord(project?.scripts) ?? asRecord(poetry?.scripts);
    const dependencies = [
      ...asStringArray(project?.dependencies),
      ...depNames(poetry?.dependencies),
    ];
    return {
      hasConsoleScripts: Boolean(scripts && Object.keys(scripts).length > 0),
      dependencies,
      isPackage: Boolean(project ?? poetry),
    };
  } catch {
    return null;
  }
}

/** 解析 setup.py 中的 entry_points / install_requires。 */
export function parseSetupPy(text: string): PythonInfo | null {
  if (!text.trim()) return null;
  const hasConsoleScripts =
    /console_scripts/.test(text) || /entry_points\s*=/.test(text);
  const depsBlock = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? '';
  const dependencies = [...depsBlock.matchAll(/['"]([A-Za-z0-9_.-]+)/g)].map((m) => m[1] ?? '');
  return {
    hasConsoleScripts,
    dependencies: dependencies.filter(Boolean),
    isPackage: /packages\s*=/.test(text) || /setup\s*\(/.test(text),
  };
}

/** 解析 setup.cfg 的 entry_points / install_requires。 */
export function parseSetupCfg(text: string): PythonInfo | null {
  if (!text.trim()) return null;
  const hasConsoleScripts = /console_scripts\s*=/.test(text);
  const depsBlock = /install_requires\s*=([\s\S]*?)(?:\n\s*\n|\n\[|$)/.exec(text)?.[1] ?? '';
  const dependencies = depsBlock
    .split('\n')
    .map((line) => line.trim().replace(/[<>=!~;].*$/, ''))
    .filter((line) => line && !line.startsWith('#'));
  return { hasConsoleScripts, dependencies, isPackage: true };
}

/** 解析 go.mod 的 module 与 require。 */
export function parseGoMod(text: string): GoInfo {
  const module = /^module\s+(\S+)/m.exec(text)?.[1] ?? '';
  const imports: string[] = [];
  const block = /require\s*\(([\s\S]*?)\)/g;
  for (const match of text.matchAll(block)) {
    for (const line of (match[1] ?? '').split('\n')) {
      const name = line.trim().split(/\s+/)[0];
      if (name && !name.startsWith('//')) imports.push(name);
    }
  }
  for (const match of text.matchAll(/^require\s+([^\s(]+)/gm)) {
    const name = match[1];
    if (name) imports.push(name);
  }
  return { hasMain: false, module, imports };
}

/** 从文件树判断 Go 可执行入口。 */
export function treeHasGoMain(paths: string[]): boolean {
  return paths.some((path) => /(^|\/)main\.go$/.test(path));
}

/** 从文件树判断常见入口点。 */
export function treeHasMainEntry(paths: string[], language: string | null): boolean {
  if (paths.some((path) => /(^|\/)main\.(rs|go|py|js|ts|c|cc|cpp)$/.test(path))) {
    return true;
  }
  if (language === 'Go') return treeHasGoMain(paths);
  return false;
}

const SCREENSHOT_RE = /!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|webp)(?:\?[^)]*)?)\)/gi;
const HTML_IMG_RE = /<img[^>]+src=["']([^"']+\.(?:png|jpe?g|gif|webp)(?:\?[^"']*)?)["']/gi;
const BADGE_HOSTS = /(shields\.io|badgen\.net|badge|travis-ci|codecov|coveralls|img\.shields)/i;

/** 从 README 正文提取安装/使用方式的弱信号。 */
export function parseReadme(text: string, path = 'README.md'): ReadmeInfo {
  const globalInstall =
    /npm (?:i|install) (?:-g|--global)/i.test(text) ||
    /pnpm (?:add|install) (?:-g|--global)/i.test(text) ||
    /yarn global add/i.test(text) ||
    /brew install/i.test(text) ||
    /cargo install/i.test(text) ||
    /go install/i.test(text) ||
    /pipx install/i.test(text) ||
    /winget install/i.test(text) ||
    /scoop install/i.test(text) ||
    /snap install/i.test(text) ||
    /(?:apt|apt-get) install/i.test(text) ||
    /curl [^\n|]+\|\s*(?:ba)?sh/i.test(text);

  const dockerRun =
    /docker run/i.test(text) ||
    /docker[ -]compose up/i.test(text) ||
    /docker compose up/i.test(text) ||
    /helm install/i.test(text);

  const libraryInstall =
    !globalInstall &&
    (/\b(?:npm|pnpm|yarn) (?:i|install|add) [@a-z0-9]/i.test(text) ||
      /\bpip install\b/i.test(text) ||
      /\bcargo add\b/i.test(text) ||
      /\bgo get\b/i.test(text) ||
      /\bcomposer require\b/i.test(text));

  const selfHosted = /self[ -]hosted/i.test(text) || /自托管/.test(text);
  const desktopApp =
    /desktop (?:app|application|client)/i.test(text) ||
    /system tray|menu bar app/i.test(text) ||
    /download for (?:macos|windows|linux)/i.test(text) ||
    /桌面(?:应用|客户端)/.test(text);
  const commandLine =
    /\bcli\b/i.test(text) ||
    /command[ -]line/i.test(text) ||
    /\bterminal\b/i.test(text) ||
    /命令行/.test(text);

  let hasScreenshot = false;
  for (const match of text.matchAll(SCREENSHOT_RE)) {
    const url = match[1] ?? '';
    if (!BADGE_HOSTS.test(url)) {
      hasScreenshot = true;
      break;
    }
  }
  if (!hasScreenshot) {
    for (const match of text.matchAll(HTML_IMG_RE)) {
      const url = match[1] ?? '';
      if (!BADGE_HOSTS.test(url)) {
        hasScreenshot = true;
        break;
      }
    }
  }

  return {
    path,
    hasScreenshot,
    globalInstall,
    dockerRun,
    libraryInstall,
    desktopApp,
    selfHosted,
    commandLine,
  };
}

const APP_DEPS = new Set([
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
  '@remix-run/react',
]);

const SERVER_DEPS = new Set([
  'express',
  'koa',
  'fastify',
  'hono',
  '@nestjs/core',
  '@hapi/hapi',
  'restify',
  'socket.io',
]);

const CLI_DEPS = new Set(['commander', 'yargs', 'meow', 'ink', 'oclif', '@oclif/core', 'cac']);

function hasAny(list: string[], set: Set<string>): string | null {
  for (const name of list) {
    if (set.has(name)) return name;
  }
  return null;
}

function push(
  out: Evidence[],
  level: Evidence['level'],
  weight: number,
  reason: string,
  source: Evidence['source'] = 'manifest',
): void {
  out.push({ level, weight, reason, source });
}

/**
 * 将深度分析信号转换为可解释的评分证据。
 * 该函数保持纯函数，方便单测。
 */
export function signalsFromDeep(deep: DeepSignals): Evidence[] {
  const out: Evidence[] = [];
  const pkg = deep.packageJson;
  if (pkg) {
    if (pkg.hasBin) push(out, 'cli', 5, 'package.json 声明了 bin 可执行入口');
    if (pkg.hasExports && !pkg.hasBin) push(out, 'dependency', 2, 'package.json 暴露 exports 供其他项目引用');
    if (pkg.hasTypes && !pkg.hasBin) push(out, 'dependency', 1, 'package.json 提供类型声明，通常是库');
    if (pkg.name?.startsWith('@types/')) push(out, 'dependency', 3, '这是 @types 类型定义包');
    if (pkg.private) push(out, 'app', 1, 'package.json 标记为 private（通常是应用而非发布包）');

    const allDeps = [...pkg.dependencies, ...pkg.devDependencies];
    const appDep = hasAny(allDeps, APP_DEPS);
    if (appDep) push(out, 'dependency', 2, `依赖前端框架 ${appDep}`);
    if (pkg.private && appDep) push(out, 'app', 2, `私有项目 + ${appDep}，更像应用`);

    const serverDep = hasAny(allDeps, SERVER_DEPS);
    if (serverDep) push(out, 'server', 2, `依赖服务端框架 ${serverDep}`);

    const cliDep = hasAny(allDeps, CLI_DEPS);
    if (cliDep) push(out, 'cli', 2, `依赖 CLI 框架 ${cliDep}`);

    if (allDeps.includes('electron')) push(out, 'app', 3, '依赖 Electron 构建桌面应用');
    if (allDeps.includes('react-native') || allDeps.includes('expo')) {
      push(out, 'app', 4, '依赖 React Native / Expo 构建移动应用');
    }
    if (pkg.devDependencies.includes('electron-builder')) {
      push(out, 'app', 3, '使用 electron-builder 打包桌面应用');
    }
    if (pkg.workspaces) push(out, 'dependency', 1, 'package.json 是 monorepo workspace');
  }

  const cargo = deep.cargo;
  if (cargo) {
    if (cargo.hasBin) push(out, 'cli', 4, 'Cargo.toml 声明了 [[bin]] 可执行目标');
    if (cargo.hasLib && !cargo.hasBin) push(out, 'dependency', 3, 'Cargo.toml 只有 [lib] 库目标');
    if (cargo.crateTypes.includes('proc-macro')) push(out, 'dependency', 3, '这是过程宏 crate');
    if (cargo.crateTypes.includes('cdylib')) push(out, 'dependency', 2, '这是动态库 crate');

    const cliDep = hasAny(cargo.dependencies, new Set(['clap', 'structopt', 'argh', 'lexopt', 'bpaf']));
    if (cliDep) push(out, 'cli', 3, `依赖 CLI 库 ${cliDep}`);
    const serverDep = hasAny(
      cargo.dependencies,
      new Set(['axum', 'actix-web', 'rocket', 'warp', 'tonic', 'poem', 'tide']),
    );
    if (serverDep) push(out, 'server', 3, `依赖服务端框架 ${serverDep}`);
    const embeddedDep = hasAny(
      cargo.dependencies,
      new Set(['embedded-hal', 'cortex-m', 'rtic', 'esp-idf-sys', 'embassy-executor', 'embassy-time']),
    );
    if (embeddedDep) push(out, 'kernel', 4, `依赖嵌入式/内核库 ${embeddedDep}`);
  }

  const python = deep.python;
  if (python) {
    if (python.hasConsoleScripts) push(out, 'cli', 5, 'pyproject / setup 声明了 console_scripts');
    const appDep = hasAny(python.dependencies, new Set(['streamlit', 'gradio', 'dash']));
    if (appDep) push(out, 'dependency', 3, `依赖应用构建框架 ${appDep}`);
    const serverDep = hasAny(
      python.dependencies,
      new Set(['flask', 'django', 'fastapi', 'starlette', 'tornado', 'aiohttp', 'sanic']),
    );
    if (serverDep) push(out, 'server', 3, `依赖服务端框架 ${serverDep}`);
    if (python.isPackage) push(out, 'dependency', 1, '这是可安装的 Python 包');
  }

  const go = deep.go;
  if (go) {
    if (go.hasMain) {
      push(out, 'cli', 2, '包含 main 包，可编译为可执行文件');
      const cliDep = hasAny(go.imports, new Set(['github.com/spf13/cobra', 'github.com/urfave/cli/v2', 'github.com/urfave/cli']));
      if (cliDep) push(out, 'cli', 3, `使用 CLI 库 ${cliDep}`);
      const serverDep = hasAny(
        go.imports,
        new Set([
          'github.com/gin-gonic/gin',
          'github.com/labstack/echo/v4',
          'github.com/gofiber/fiber/v2',
          'github.com/go-chi/chi/v5',
        ]),
      );
      if (serverDep) push(out, 'server', 3, `使用 Web 框架 ${serverDep}`);
    } else if (go.module) {
      push(out, 'dependency', 2, 'Go module 没有 main 包，是可复用库');
    }
  }

  const kernel = deep.kernel ?? {
    kconfig: false,
    objM: false,
    bpfSource: false,
    moduleInit: false,
  };
  if (kernel.kconfig) push(out, 'kernel', 4, '仓库包含 Kconfig 内核配置');
  if (kernel.objM) push(out, 'kernel', 6, 'Makefile 使用 obj-m 编译内核模块');
  if (kernel.bpfSource) push(out, 'kernel', 5, '仓库包含 eBPF 源文件');
  if (kernel.moduleInit) push(out, 'kernel', 5, '包含 module_init 等内核模块入口');

  if (deep.hasCompose) push(out, 'server', 3, '包含 docker-compose 部署编排');
  if (deep.hasDockerfile) push(out, 'server', 2, '包含 Dockerfile，可部署为服务');
  if (deep.hasTauri) push(out, 'app', 5, '包含 Tauri 桌面应用配置');
  if (deep.hasElectronBuilder) push(out, 'app', 4, '包含 electron-builder 打包配置');
  if (deep.hasAndroidManifest) push(out, 'app', 5, '包含 AndroidManifest.xml');
  if (deep.hasXcodeProject) push(out, 'app', 5, '包含 Xcode 工程');
  if (deep.hasWebIndex && deep.hasFrontendFramework) {
    push(out, 'app', 3, '包含前端入口 index.html 与前端框架');
  }

  const readme = deep.readme;
  if (readme) {
    if (readme.globalInstall) push(out, 'cli', 3, 'README 提供全局安装命令', 'readme');
    if (readme.commandLine) push(out, 'cli', 1, 'README 强调命令行用法', 'readme');
    if (readme.dockerRun) push(out, 'server', 2, 'README 提供 docker run / compose 部署方式', 'readme');
    if (readme.selfHosted) push(out, 'server', 2, 'README 标明可自托管', 'readme');
    if (readme.desktopApp) push(out, 'app', 2, 'README 描述桌面应用安装包', 'readme');
    if (readme.libraryInstall) push(out, 'dependency', 1, 'README 提供作为依赖安装的方式', 'readme');
    if (readme.hasScreenshot) push(out, 'app', 1, 'README 包含应用截图', 'readme');
  }

  return out;
}
