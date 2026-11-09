import {
  DOMAIN_FACETS,
  FACET_GROUPS,
  FORM_FACETS,
  LAYER_FACETS,
  ROLE_FACETS,
} from './types.js';
import type {
  DeepSignals,
  DomainFacet,
  FacetGroup,
  FormFacet,
  LayerFacet,
  Level,
  RepoFacets,
  RoleFacet,
  StarredRepo,
} from './types.js';

export const FACET_GROUP_META: Record<FacetGroup, { zh: string; description: string }> = {
  form: { zh: '形态', description: '交付与使用形态' },
  layer: { zh: '层次', description: '技术栈层次' },
  role: { zh: '用途', description: '在项目中的用途' },
  domain: { zh: '领域', description: '所属领域' },
};

export const FACET_VALUE_META: Record<
  FacetGroup,
  Record<string, { zh: string; emoji: string }>
> = {
  form: {
    cli: { zh: '命令行', emoji: '⌨️' },
    gui: { zh: '桌面 GUI', emoji: '🖥️' },
    mobile: { zh: '移动端', emoji: '📱' },
    web: { zh: 'Web', emoji: '🌐' },
    api: { zh: 'API / 服务', emoji: '🔌' },
    library: { zh: '库', emoji: '📦' },
    docs: { zh: '文档 / 教程', emoji: '📚' },
    data: { zh: '数据 / 模型', emoji: '🗃️' },
  },
  layer: {
    system: { zh: '系统底层', emoji: '🧩' },
    platform: { zh: '平台基础', emoji: '🏗️' },
    infra: { zh: '基础设施', emoji: '🛠️' },
    app: { zh: '应用层', emoji: '🖥️' },
  },
  role: {
    runtime: { zh: '运行时依赖', emoji: '⚙️' },
    build: { zh: '构建工具', emoji: '🔨' },
    operational: { zh: '运维/操作', emoji: '🚀' },
    learning: { zh: '学习资源', emoji: '🎓' },
  },
  domain: {
    ai: { zh: 'AI / 机器学习', emoji: '🤖' },
    data: { zh: '数据', emoji: '📊' },
    devtools: { zh: '开发工具', emoji: '🧰' },
    security: { zh: '安全', emoji: '🔐' },
    media: { zh: '媒体', emoji: '🎬' },
    productivity: { zh: '效率', emoji: '✅' },
    web: { zh: 'Web', emoji: '🌐' },
    systems: { zh: '系统', emoji: '🧩' },
    infra: { zh: '基础设施', emoji: '🏗️' },
    science: { zh: '科学', emoji: '🔬' },
  },
};

export function isFacetGroup(value: unknown): value is FacetGroup {
  return typeof value === 'string' && (FACET_GROUPS as readonly string[]).includes(value);
}

export function emptyFacets(): RepoFacets {
  return { form: [], layer: [], role: [], domain: [] };
}

export function facetListName(group: FacetGroup, value: string): string {
  const meta = FACET_VALUE_META[group][value];
  if (!meta) throw new Error(`未知标签：${group}:${value}`);
  return `${meta.emoji} ${FACET_GROUP_META[group].zh} · ${meta.zh}`;
}

export function facetListDescription(group: FacetGroup, value: string): string {
  const meta = FACET_VALUE_META[group][value];
  const groupMeta = FACET_GROUP_META[group];
  return meta && groupMeta
    ? `${groupMeta.description}：${meta.zh}`
    : `按${FACET_GROUP_META[group].zh}分类的仓库`;
}

/** 合并多组标签并去重，保持首次出现顺序。 */
export function mergeFacets(...parts: Array<Partial<RepoFacets> | undefined>): RepoFacets {
  const result = emptyFacets();
  for (const part of parts) {
    if (!part) continue;
    for (const group of FACET_GROUPS) {
      const values = part[group as keyof RepoFacets];
      if (!values) continue;
      for (const value of values) {
        const list = result[group as keyof RepoFacets] as string[];
        if (!list.includes(value)) list.push(value);
      }
    }
  }
  return result;
}

/** 主层级自带的基础标签。 */
export function facetsForLevel(level: Level): Partial<RepoFacets> {
  switch (level) {
    case 'kernel':
      return { layer: ['system'], role: ['runtime'], domain: ['systems'] };
    case 'foundation':
      return { layer: ['platform'], role: ['runtime'] };
    case 'dependency':
      return { form: ['library'], layer: ['platform'], role: ['runtime'] };
    case 'cli':
      return { form: ['cli'], layer: ['infra'], role: ['operational'], domain: ['devtools'] };
    case 'server':
      return { form: ['api'], layer: ['infra'], role: ['operational'], domain: ['infra'] };
    case 'app':
      return { layer: ['app'] };
    case 'resource':
      return { form: ['docs'], role: ['learning'] };
    default:
      return {};
  }
}

const TOPIC_FACETS: Record<FacetGroup, Array<[string, readonly string[]]>> = {
  form: [
    ['cli', ['cli', 'cli-app', 'cli-tool', 'command-line', 'command-line-tool', 'terminal', 'terminal-ui', 'tui', 'shell']],
    ['gui', ['gui', 'desktop', 'desktop-app', 'desktop-application', 'electron', 'tauri', 'qt', 'gtk']],
    ['mobile', ['android', 'android-app', 'ios', 'ios-app', 'mobile', 'mobile-app', 'flutter', 'react-native']],
    ['web', ['web', 'web-app', 'webapp', 'website', 'frontend', 'pwa', 'browser-extension']],
    ['api', ['api', 'rest-api', 'graphql', 'backend', 'web-server', 'http-server', 'server']],
    ['library', ['library', 'libraries', 'sdk', 'framework', 'package', 'npm-package', 'crate', 'plugin']],
    ['docs', ['awesome', 'awesome-list', 'curated-list', 'tutorial', 'tutorials', 'course', 'docs', 'documentation', 'book', 'roadmap', 'cheatsheet', 'guide']],
    ['data', ['dataset', 'datasets', 'data', 'corpus', 'model', 'models', 'llm']],
  ],
  layer: [
    ['system', ['kernel', 'driver', 'drivers', 'firmware', 'bootloader', 'rtos', 'embedded', 'operating-system', 'ebpf', 'bpf', 'hypervisor']],
    ['platform', ['runtime', 'compiler', 'interpreter', 'programming-language', 'standard-library', 'libc', 'wasm', 'webassembly', 'protocol']],
    ['infra', ['docker', 'container', 'kubernetes', 'k8s', 'self-hosted', 'selfhosted', 'proxy', 'reverse-proxy', 'database', 'monitoring', 'devops', 'infrastructure', 'gitops', 'homelab']],
    ['app', ['app', 'application', 'desktop-app', 'mobile-app', 'web-app', 'game', 'gui']],
  ],
  role: [
    ['runtime', ['library', 'sdk', 'runtime', 'framework', 'package', 'crate', 'orm', 'api-client']],
    ['build', ['build-tool', 'build-system', 'bundler', 'linter', 'formatter', 'compiler', 'toolchain', 'package-manager', 'monorepo']],
    ['operational', ['server', 'self-hosted', 'docker', 'kubernetes', 'devops', 'monitoring', 'observability', 'cli', 'tui', 'sysadmin']],
    ['learning', ['awesome', 'awesome-list', 'tutorial', 'tutorials', 'course', 'book', 'roadmap', 'interview', 'cheatsheet', 'learning', 'guide']],
  ],
  domain: [
    ['ai', ['ai', 'artificial-intelligence', 'machine-learning', 'deep-learning', 'llm', 'gpt', 'transformer', 'neural-network', 'pytorch', 'tensorflow', 'embedding', 'rag', 'agent']],
    ['data', ['data', 'data-analysis', 'analytics', 'database', 'sql', 'etl', 'dataframe', 'data-science', 'pipeline']],
    ['devtools', ['devtools', 'developer-tools', 'linter', 'build-tool', 'ide', 'debugger', 'testing', 'formatter', 'package-manager']],
    ['security', ['security', 'cryptography', 'crypto', 'authentication', 'authorization', 'pentest', 'vulnerability', 'tls', 'ssl', 'secrets-management']],
    ['media', ['media', 'video', 'audio', 'image', 'graphics', 'music', 'codec', 'streaming', 'photo']],
    ['productivity', ['productivity', 'notes', 'note-taking', 'todo', 'task-management', 'calendar', 'chat', 'email', 'wiki']],
    ['web', ['web', 'frontend', 'react', 'vue', 'svelte', 'angular', 'nextjs', 'nuxt', 'css', 'tailwindcss']],
    ['systems', ['kernel', 'linux', 'operating-system', 'embedded', 'firmware', 'ebpf', 'rtos', 'systems-programming']],
    ['infra', ['infrastructure', 'devops', 'docker', 'kubernetes', 'self-hosted', 'homelab', 'monitoring', 'deployment', 'gitops']],
    ['science', ['science', 'physics', 'math', 'mathematics', 'research', 'bioinformatics', 'simulation', 'astronomy']],
  ],
};

const TEXT_FACETS: Array<[FacetGroup, string, RegExp]> = [
  ['form', 'cli', /\bcli\b|command[ -]line|terminal (ui|app)|\btui\b/i],
  ['form', 'gui', /\bdesktop (app|application|client)\b|\bgui\b|\belectron\b|\btauri\b/i],
  ['form', 'mobile', /\bandroid\b|\bios\b|mobile (app|application)|react[ -]native|\bflutter\b/i],
  ['form', 'web', /web ?app(lication)?|\bwebsite\b|\bfrontend\b|\bpwa\b/i],
  ['form', 'api', /\bapi\b|\bbackend\b|rest(ful)? (api|service)|graphql server/i],
  ['form', 'library', /\blibrar(y|ies)\b|\bsdk\b|\bframework\b|\bnpm package\b/i],
  ['form', 'docs', /\bawesome\b|\btutorials?\b|\bguide\b|\bdocumentation\b|\bbook\b|\broadmap\b|cheat ?sheet/i],
  ['form', 'data', /\bdataset\b|\bcorpus\b|\bmodel weights\b/i],
  ['layer', 'system', /\bkernel\b|\bdrivers?\b|\bfirmware\b|\bboot ?loader\b|\brtos\b|\bembedded\b|operating system|\bebpf\b/i],
  ['layer', 'platform', /\bruntime\b|\bcompiler\b|\binterpreter\b|standard library|\bwasm\b|protocol stack/i],
  ['layer', 'infra', /\bdocker\b|\bkubernetes\b|self[ -]hosted|\breverse proxy\b|\bdatabase\b|\bmonitoring\b|\bdevops\b|infrastructure/i],
  ['layer', 'app', /\bdesktop app\b|\bmobile app\b|\bweb app\b|\bgame\b|\bgui\b/i],
  ['role', 'runtime', /\bruntime\b|\blibrar(y|ies)\b|\bsdk\b|\bframework\b/i],
  ['role', 'build', /build tool|\bbundler\b|\blinter\b|\bformatter\b|\bcompiler\b|\btoolchain\b|package manager/i],
  ['role', 'operational', /\bserver\b|self[ -]hosted|\bdocker\b|\bkubernetes\b|\bmonitoring\b|\bobservability\b|terminal tool|\bcli\b/i],
  ['role', 'learning', /\bawesome\b|\btutorials?\b|\bcourse\b|\bguide\b|\bbook\b|\broadmap\b|\binterview\b|cheat ?sheet/i],
  ['domain', 'ai', /\bai\b|machine learning|deep learning|\bllm\b|\bgpt\b|transformer|neural network|pytorch|tensorflow/i],
  ['domain', 'data', /\bdata\b|\banalytics\b|\bdatabase\b|\bsql\b|\betl\b|dataframe/i],
  ['domain', 'devtools', /developer tool|\bdevtools\b|\blinter\b|\bdebugger\b|build tool|\bide\b|testing framework/i],
  ['domain', 'security', /security|cryptograph|authentication|authorization|vulnerabilit|\bpentest\b|\btls\b|\bssl\b/i],
  ['domain', 'media', /\bmedia\b|\bvideo\b|\baudio\b|\bimage\b|\bgraphics\b|\bmusic\b|\bstreaming\b|\bcodec\b/i],
  ['domain', 'productivity', /productivity|note[- ]taking|\bnotes\b|\btodo\b|\bcalendar\b|\bchat\b|\bemail\b|\bwiki\b/i],
  ['domain', 'web', /\bweb\b|\bfrontend\b|\breact\b|\bvue\b|\bsvelte\b|\bangular\b|\bnextjs\b|\bcss\b|tailwind/i],
  ['domain', 'systems', /\bkernel\b|\blinux\b|operating system|\bembedded\b|\bfirmware\b|\bebpf\b|\brtos\b/i],
  ['domain', 'infra', /infrastructure|\bdevops\b|\bdocker\b|\bkubernetes\b|self[ -]hosted|\bhomelab\b|\bmonitoring\b/i],
  ['domain', 'science', /\bscience\b|\bphysics\b|\bmath\b|\bresearch\b|bioinformatics|\bsimulation\b|\bastronomy\b/i],
];

function addFacet(
  target: RepoFacets,
  group: FacetGroup,
  value: string,
): void {
  const list = target[group] as string[];
  if (!list.includes(value)) list.push(value);
}

function inferFromText(facets: RepoFacets, repo: StarredRepo): void {
  const topics = new Set(
    repo.topics.map((topic) => topic.trim().toLowerCase().replace(/_/g, '-')),
  );
  for (const group of FACET_GROUPS) {
    for (const [value, keywords] of TOPIC_FACETS[group]) {
      if (keywords.some((keyword) => topics.has(keyword))) addFacet(facets, group, value);
    }
  }
  const text = `${repo.name} ${repo.description ?? ''}`;
  for (const [group, value, pattern] of TEXT_FACETS) {
    if (pattern.test(text)) addFacet(facets, group, value);
  }
}

function inferFromDeep(facets: RepoFacets, deep: DeepSignals): void {
  const pkg = deep.packageJson;
  const cargo = deep.cargo;
  const python = deep.python;
  const go = deep.go;
  const readme = deep.readme;

  if (pkg?.hasBin || cargo?.hasBin || python?.hasConsoleScripts || go?.hasMain || readme?.commandLine) {
    addFacet(facets, 'form', 'cli');
    addFacet(facets, 'role', 'operational');
  }
  if (pkg?.hasExports || pkg?.hasTypes || cargo?.hasLib || readme?.libraryInstall) {
    addFacet(facets, 'form', 'library');
    addFacet(facets, 'role', 'runtime');
  }
  if (deep.hasTauri || deep.hasElectronBuilder || readme?.desktopApp) {
    addFacet(facets, 'form', 'gui');
    addFacet(facets, 'layer', 'app');
  }
  if (deep.hasAndroidManifest) {
    addFacet(facets, 'form', 'mobile');
    addFacet(facets, 'layer', 'app');
  }
  if (deep.hasWebIndex || deep.hasFrontendFramework) {
    addFacet(facets, 'form', 'web');
  }
  if (deep.hasDockerfile || deep.hasCompose) {
    addFacet(facets, 'layer', 'infra');
    addFacet(facets, 'role', 'operational');
  }
  if (readme?.selfHosted) {
    addFacet(facets, 'form', 'api');
    addFacet(facets, 'layer', 'infra');
    addFacet(facets, 'role', 'operational');
  }
  if (deep.kernel.kconfig || deep.kernel.objM || deep.kernel.bpfSource || deep.kernel.moduleInit) {
    addFacet(facets, 'layer', 'system');
    addFacet(facets, 'domain', 'systems');
  }
  if (
    deep.hasGguf ||
    deep.hasSafetensors ||
    deep.hasModelIndex ||
    deep.hasTokenizer ||
    deep.hasModelConfig ||
    deep.hasOnnx ||
    deep.hasTflite ||
    deep.hasCoreml ||
    deep.hasLora ||
    deep.hasTrainingScript
  ) {
    addFacet(facets, 'form', 'data');
    addFacet(facets, 'domain', 'ai');
  }
}

/** 主层级变化时替换该层级自带的基础标签，保留由 topics/描述/深度信号得到的标签。 */
export function withLevelFacets(
  current: Partial<RepoFacets> | undefined,
  previous: Level,
  next: Level,
): RepoFacets {
  const oldBase = facetsForLevel(previous);
  const newBase = facetsForLevel(next);
  const kept = emptyFacets();
  for (const group of FACET_GROUPS) {
    const oldValues = new Set((oldBase[group as keyof RepoFacets] as string[]) ?? []);
    const newValues = new Set((newBase[group as keyof RepoFacets] as string[]) ?? []);
    for (const value of (current?.[group as keyof RepoFacets] as string[]) ?? []) {
      if (!oldValues.has(value) || newValues.has(value)) addFacet(kept, group, value);
    }
  }
  return mergeFacets(kept, newBase);
}

/** 综合主层级、topics/描述与深度信号，推断正交标签。 */
export function inferFacets(
  repo: StarredRepo,
  deep: DeepSignals | undefined,
  level: Level,
): RepoFacets {
  const facets = mergeFacets(facetsForLevel(level));
  inferFromText(facets, repo);
  if (deep) inferFromDeep(facets, deep);
  return facets;
}

/** 校验并清洗模型返回的标签；无有效值时返回 undefined。 */
export function sanitizeFacets(raw: unknown): RepoFacets | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const result = emptyFacets();
  let found = false;
  for (const group of FACET_GROUPS) {
    const allowed: readonly string[] =
      group === 'form'
        ? FORM_FACETS
        : group === 'layer'
          ? LAYER_FACETS
          : group === 'role'
            ? ROLE_FACETS
            : DOMAIN_FACETS;
    const values = record[group];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === 'string' && allowed.includes(value)) {
        addFacet(result, group, value);
        found = true;
      }
    }
  }
  return found ? result : undefined;
}

/** 给 UI / API 用的标签目录。 */
export function facetCatalog(): Array<{
  id: FacetGroup;
  zh: string;
  values: Array<{ id: string; zh: string; emoji: string }>;
}> {
  return FACET_GROUPS.map((group) => ({
    id: group,
    zh: FACET_GROUP_META[group].zh,
    values: Object.entries(FACET_VALUE_META[group]).map(([id, meta]) => ({
      id,
      zh: meta.zh,
      emoji: meta.emoji,
    })),
  }));
}

export type { DomainFacet, FormFacet, LayerFacet, RoleFacet };
