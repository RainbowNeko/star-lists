/** 顶层分类，对应一份 star list。 */
export type Level =
  | 'kernel'
  | 'foundation'
  | 'dependency'
  | 'cli'
  | 'server'
  | 'app'
  | 'resource'
  | 'unclassified';

export const LEVEL_IDS = [
  'kernel',
  'foundation',
  'dependency',
  'cli',
  'server',
  'app',
  'resource',
  'unclassified',
] as const satisfies readonly Level[];

/** 证据来源，用于解释“为什么分到这一层”。 */
export type EvidenceSource =
  | 'anchor'
  | 'topic'
  | 'description'
  | 'name'
  | 'language'
  | 'meta'
  | 'manifest'
  | 'readme'
  | 'model'
  | 'manual';

/** 分类引擎：规则引擎 / 端侧小模型 / 大模型。 */
export type EngineName = 'rules' | 'edge' | 'large';

/** 正交标签的四个维度。 */
export const FACET_GROUPS = ['form', 'layer', 'role', 'domain'] as const;
export type FacetGroup = (typeof FACET_GROUPS)[number];

export const FORM_FACETS = [
  'cli',
  'gui',
  'mobile',
  'web',
  'api',
  'library',
  'docs',
  'data',
] as const;
export type FormFacet = (typeof FORM_FACETS)[number];

export const LAYER_FACETS = ['system', 'platform', 'infra', 'app'] as const;
export type LayerFacet = (typeof LAYER_FACETS)[number];

export const ROLE_FACETS = ['runtime', 'build', 'operational', 'learning'] as const;
export type RoleFacet = (typeof ROLE_FACETS)[number];

export const DOMAIN_FACETS = [
  'ai',
  'data',
  'devtools',
  'security',
  'media',
  'productivity',
  'web',
  'systems',
  'infra',
  'science',
] as const;
export type DomainFacet = (typeof DOMAIN_FACETS)[number];

/** 一个仓库可以同时拥有的正交标签；与主层级 level 并存。 */
export interface RepoFacets {
  form: FormFacet[];
  layer: LayerFacet[];
  role: RoleFacet[];
  domain: DomainFacet[];
}

export interface Evidence {
  level: Level;
  weight: number;
  reason: string;
  source: EvidenceSource;
}

/** 从 GitHub REST API（或本地 fixture）归一化后的仓库信息。 */
export interface StarredRepo {
  id: number;
  /** GraphQL global id，同步 GitHub Lists 时需要。 */
  nodeId: string;
  nameWithOwner: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  fork: boolean;
  isPrivate: boolean;
  /** 仓库体积，单位 KB。 */
  size: number;
  homepage: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  createdAt: string | null;
  starredAt: string | null;
  license: string | null;
}

export interface PackageJsonInfo {
  name?: string;
  private: boolean;
  hasBin: boolean;
  hasExports: boolean;
  hasTypes: boolean;
  workspaces: boolean;
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
}

export interface CargoInfo {
  hasBin: boolean;
  hasLib: boolean;
  crateTypes: string[];
  dependencies: string[];
  isWorkspace: boolean;
}

export interface PythonInfo {
  hasConsoleScripts: boolean;
  dependencies: string[];
  isPackage: boolean;
}

export interface GoInfo {
  hasMain: boolean;
  module: string;
  imports: string[];
}

export interface KernelSignals {
  kconfig: boolean;
  objM: boolean;
  bpfSource: boolean;
  moduleInit: boolean;
}

export interface ReadmeInfo {
  path: string;
  hasScreenshot: boolean;
  globalInstall: boolean;
  dockerRun: boolean;
  libraryInstall: boolean;
  desktopApp: boolean;
  selfHosted: boolean;
  commandLine: boolean;
}

/** `--deep` 模式从仓库文件树、manifest 和 README 中提取的信号。 */
export interface DeepSignals {
  /** 实际读取过的文件（相对路径）。 */
  files: string[];
  packageJson?: PackageJsonInfo;
  cargo?: CargoInfo;
  python?: PythonInfo;
  go?: GoInfo;
  kernel: KernelSignals;
  readme?: ReadmeInfo;
  hasDockerfile: boolean;
  hasCompose: boolean;
  hasTauri: boolean;
  hasElectronBuilder: boolean;
  hasAndroidManifest: boolean;
  hasXcodeProject: boolean;
  hasWebIndex: boolean;
  hasMainEntry: boolean;
  hasFrontendFramework: boolean;
  /** 端侧 / 模型文件信号（旧缓存可能没有这些字段）。 */
  hasGguf?: boolean;
  hasSafetensors?: boolean;
  hasModelIndex?: boolean;
  hasTokenizer?: boolean;
  hasModelConfig?: boolean;
  hasOnnx?: boolean;
  hasTflite?: boolean;
  hasCoreml?: boolean;
  hasLora?: boolean;
  hasTrainingScript?: boolean;
  /** 解析失败等非致命问题，便于排查。 */
  errors: string[];
}

export interface ClassifiedRepo {
  repo: StarredRepo;
  level: Level;
  /** 最高层级的得分。 */
  score: number;
  /** 0~1，越高越确定。 */
  confidence: number;
  evidence: Evidence[];
  runnerUp: Level | null;
  /** 是否需要人工复核（置信度低或分差太小）。 */
  needsReview: boolean;
  deepAnalyzed: boolean;
  signals?: DeepSignals;
  /** 与主层级正交的标签；旧数据可能没有。 */
  facets?: RepoFacets;
}

export interface GitHubProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  bio: string | null;
  publicRepos: number | null;
  followers?: number | null;
}

export interface Dataset {
  /** 2 起包含正交标签 facets；旧文件仍可能是 1。 */
  schemaVersion: 1 | 2;
  username: string;
  profile: GitHubProfile | null;
  fetchedAt: string;
  deep: boolean;
  /** 原始 star 数（过滤前）。 */
  totalStarred: number;
  /** 本次过滤后参与分类的数量。 */
  totalAnalyzed: number;
  /** 是否因为限额/limit 而没有拉全。 */
  truncated: boolean;
  /** 本次使用的分类引擎。 */
  engine?: EngineName;
  repos: ClassifiedRepo[];
  warnings: string[];
}

/** 本地输入文件的宽松格式：支持 `{ username, repos }`、数组或完整 Dataset。 */
export interface FixtureInput {
  username?: string;
  profile?: GitHubProfile | null;
  fetchedAt?: string;
  repos?: unknown[];
  [key: string]: unknown;
}

export interface RunOptions {
  username: string;
  token?: string;
  deep: boolean;
  deepMax: number;
  concurrency: number;
  since?: Date;
  limit?: number;
  minStars: number;
  includeForks: boolean;
  includeArchived: boolean;
  cacheTtlHours: number;
  cacheEnabled: boolean;
  refresh: boolean;
  input?: string;
  json: boolean;
  quiet: boolean;
  /** 分类引擎；默认 rules。 */
  engine?: EngineName;
  /** 覆盖引擎默认 OpenAI 兼容接口地址。 */
  engineBaseUrl?: string;
  /** 覆盖引擎默认模型名。 */
  engineModel?: string;
  /** 覆盖引擎 API key。 */
  engineApiKey?: string;
  /** 每次请求分类多少个仓库。 */
  engineBatchSize?: number;
  /** 引擎并发批次数。 */
  engineConcurrency?: number;
  /** 单次请求超时（毫秒）。 */
  engineTimeoutMs?: number;
}

export interface PublishReport {
  viewer: string;
  createdLists: string[];
  reusedLists: string[];
  updated: string[];
  unchanged: number;
  failed: { repo: string; error: string }[];
  dryRun: boolean;
}
