import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveToken } from './auth.js';
import { FileCache } from './cache.js';
import { classifyAll, selectDeepCandidates } from './classify.js';
import { createEngine, mergeEngineResults } from './engine.js';
import { DeepAnalyzer } from './deep.js';
import { GitHubClient, toStarredRepo } from './github.js';
import type {
  Dataset,
  DeepSignals,
  GitHubProfile,
  RunOptions,
  StarredRepo,
} from './types.js';

const CACHE_ROOT = resolve('.cache/star-lists');

export interface AnalyzeOptions extends RunOptions {
  onStatus?: (message: string) => void;
}

interface StarCache {
  profile: GitHubProfile | null;
  repos: StarredRepo[];
  fetchedAt: string;
  truncated: boolean;
}

function isInternalRepo(value: unknown): value is StarredRepo {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as StarredRepo).nameWithOwner === 'string' &&
    typeof (value as StarredRepo).stars === 'number' &&
    typeof (value as StarredRepo).nodeId === 'string'
  );
}

interface FixtureBundle {
  username: string;
  profile: GitHubProfile | null;
  repos: StarredRepo[];
  fetchedAt: string;
  declaredTotal: number | null;
  deepSignals: Map<string, DeepSignals>;
}

/** 读取离线 fixture / 之前生成的 data.json。 */
export async function loadFixture(
  path: string,
  fallbackUsername?: string,
): Promise<FixtureBundle> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 --input 文件 ${path}：${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`--input 文件不是合法 JSON：${path}（${String(error)}）`);
  }
  const container =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container.repos)
      ? container.repos
      : [];

  const deepSignals = new Map<string, DeepSignals>();
  const repos: StarredRepo[] = [];
  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry as {
      repo?: unknown;
      signals?: DeepSignals;
      starredAt?: string | null;
      starred_at?: string | null;
    };
    const payload = wrapper.repo ?? entry;
    const starredAt =
      wrapper.starredAt ??
      wrapper.starred_at ??
      ((payload as {starred_at?: string | null}).starred_at ?? null);

    let repo: StarredRepo;
    if (isInternalRepo(payload)) {
      repo = { ...payload, starredAt: payload.starredAt ?? starredAt };
    } else {
      const record = payload as Record<string, unknown>;
      const fullName = record.full_name ?? record.nameWithOwner;
      const merged = {
        ...record,
        full_name:
          typeof fullName === 'string'
            ? fullName
            : `${String(record.owner ?? '')}/${String(record.name ?? '')}`,
        html_url:
          typeof record.html_url === 'string'
            ? record.html_url
            : typeof record.url === 'string'
              ? record.url
              : undefined,
      };
      repo = toStarredRepo(merged, starredAt);
    }

    if (!repo.nameWithOwner) continue;
    repos.push(repo);
    const signals = wrapper.signals;
    if (signals) deepSignals.set(repo.nameWithOwner.toLowerCase(), signals);
  }

  const username =
    (typeof container.username === 'string' && container.username) ||
    fallbackUsername ||
    'local';
  const profile =
    container.profile && typeof container.profile === 'object'
      ? (container.profile as GitHubProfile)
      : null;
  const fetchedAt =
    typeof container.fetchedAt === 'string' ? container.fetchedAt : new Date().toISOString();
  const declaredTotal =
    typeof container.totalStarred === 'number' ? container.totalStarred : null;

  return {
    username,
    profile,
    repos,
    fetchedAt,
    declaredTotal,
    deepSignals,
  };
}

function applyFilters(repos: StarredRepo[], options: AnalyzeOptions, warnings: string[]): StarredRepo[] {
  let filtered = repos;
  if (!options.includeForks) filtered = filtered.filter((repo) => !repo.fork);
  if (!options.includeArchived) filtered = filtered.filter((repo) => !repo.archived);
  if (options.minStars > 0) {
    filtered = filtered.filter((repo) => repo.stars >= options.minStars);
  }
  if (options.since) {
    const since = options.since.getTime();
    const missing = filtered.filter((repo) => !repo.starredAt).length;
    if (missing > 0) {
      warnings.push(`有 ${missing} 个仓库缺少 star 时间，--since 过滤时已保留。`);
    }
    filtered = filtered.filter((repo) => {
      if (!repo.starredAt) return true;
      const time = Date.parse(repo.starredAt);
      return !Number.isFinite(time) || time >= since;
    });
  }
  if (options.limit && options.limit > 0) filtered = filtered.slice(0, options.limit);
  return filtered;
}

function dedupe(repos: StarredRepo[]): StarredRepo[] {
  const seen = new Set<string>();
  const result: StarredRepo[] = [];
  for (const repo of repos) {
    const key = repo.nameWithOwner.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(repo);
  }
  return result;
}

function mergeDeep(
  current: Map<string, DeepSignals>,
  extra: Map<string, DeepSignals>,
): Map<string, DeepSignals> {
  for (const [key, value] of extra) current.set(key, value);
  return current;
}

/** 主流程：拉取（或读取）→ 初步分类 → 深度分析 → 最终分类。 */
export async function analyzeUser(options: AnalyzeOptions): Promise<Dataset> {
  const warnings: string[] = [];
  const status = options.onStatus ?? (() => {});
  let repos: StarredRepo[];
  let profile: GitHubProfile | null = null;
  let username = options.username;
  let fetchedAt = new Date().toISOString();
  let totalStarred = 0;
  let truncated = false;
  let deepSignals = new Map<string, DeepSignals>();
  let client: GitHubClient | null = null;

  if (options.input) {
    status(`读取离线数据 ${options.input}`);
    const fixture = await loadFixture(options.input, options.username);
    username = options.username || fixture.username;
    profile = fixture.profile;
    repos = dedupe(fixture.repos);
    totalStarred = fixture.declaredTotal ?? repos.length;
    fetchedAt = fixture.fetchedAt;
    deepSignals = new Map(fixture.deepSignals);
  } else {
    const resolved = await resolveToken(options.token);
    if (!resolved.token) {
      warnings.push(
        '未检测到 GitHub token（GITHUB_TOKEN / GH_TOKEN / gh auth token）：匿名 API 限额 60 次/小时。',
      );
    }
    client = new GitHubClient({ token: resolved.token });
    status(
      `读取 @${username} 的 Star 列表${resolved.token ? `（token: ${resolved.source}）` : '（匿名）'}…`,
    );
    profile = await client.getUser(username);

    const cacheKey = `stars:${username.toLowerCase()}`;
    const cache = new FileCache(join(CACHE_ROOT, 'stars'), options.cacheTtlHours, (message) =>
      warnings.push(message),
    );
    const useCache = options.cacheEnabled && !options.refresh && !options.limit;
    const cached = useCache ? await cache.get<StarCache>(cacheKey) : null;

    if (cached) {
      repos = cached.data.repos;
      profile = cached.data.profile ?? profile;
      fetchedAt = cached.data.fetchedAt;
      totalStarred = repos.length;
      truncated = cached.data.truncated;
      status(`使用缓存：${repos.length} 个 Star（${fetchedAt.slice(0, 16).replace('T', ' ')}）`);
    } else {
      const result = await client.listStarred(username, {
        max: options.limit,
        onProgress: (loaded) => status(`已读取 ${loaded} 个 Star…`),
      });
      repos = result.repos;
      truncated = result.truncated;
      totalStarred = repos.length;
      fetchedAt = new Date().toISOString();
      if (useCache) {
        await cache.set<StarCache>(cacheKey, {
          profile,
          repos,
          fetchedAt,
          truncated,
        });
      }
    }
    if (
      client.rateLimit.remaining !== null &&
      client.rateLimit.remaining <= 5
    ) {
      warnings.push(
        `GitHub API 剩余额度仅 ${client.rateLimit.remaining} 次，建议设置 token 或稍后重试。`,
      );
    }
  }

  repos = dedupe(repos);
  if (truncated) warnings.push('Star 列表未拉取完整（受 --limit 或分页限制）。');
  const analyzedRepos = applyFilters(repos, options, warnings);
  if (analyzedRepos.length !== repos.length) {
    status(`过滤后剩余 ${analyzedRepos.length} 个仓库`);
  }

  let classified = classifyAll(analyzedRepos);
  let deepCount = 0;

  if (options.deep && client) {
    const effectiveMax = client.hasToken
      ? options.deepMax
      : Math.min(options.deepMax, 8);
    if (!client.hasToken && effectiveMax < options.deepMax) {
      warnings.push(
        `未登录时深度分析最多 ${effectiveMax} 个仓库（匿名限额 60 次/小时）。`,
      );
    }
    const candidates = selectDeepCandidates(classified, effectiveMax);
    if (candidates.length > 0) {
      status(`深度分析 ${candidates.length} 个需要确认的仓库…`);
      const cache =
        options.cacheEnabled && !options.refresh
          ? new FileCache(join(CACHE_ROOT, 'deep'), 24 * 7, (message) =>
              warnings.push(message),
            )
          : undefined;
      const analyzer = new DeepAnalyzer(client, {
        concurrency: options.concurrency,
        cache,
        log: (message) => warnings.push(message),
      });
      let lastReport = 0;
      const signals = await analyzer.analyzeRepos(candidates.map((item) => item.repo), {
        onProgress: (done, total) => {
          if (done === total || done - lastReport >= 10) {
            lastReport = done;
            status(`深度分析 ${done}/${total}…`);
          }
        },
      });
      deepSignals = mergeDeep(deepSignals, signals);
      classified = classifyAll(analyzedRepos, deepSignals);
      deepCount = signals.size;
    }
  } else if (options.deep && !client) {
    warnings.push('离线模式下 --deep 不会发起网络请求，仅使用 fixture 自带的 signals。');
    if (deepSignals.size > 0) {
      classified = classifyAll(analyzedRepos, deepSignals);
      deepCount = deepSignals.size;
    }
  } else if (deepSignals.size > 0) {
    // fixture 自带 signals 时即使没有 --deep 也使用它们
    classified = classifyAll(analyzedRepos, deepSignals);
    deepCount = deepSignals.size;
  }

  const engine = options.engine ?? 'rules';
  if (engine !== 'rules') {
    const label = engine === 'edge' ? '端侧小模型' : '大模型';
    status(`使用${label}引擎分类 ${classified.length} 个仓库…`);
    const modelEngine = createEngine({
      engine,
      baseUrl: options.engineBaseUrl,
      model: options.engineModel,
      apiKey: options.engineApiKey,
      batchSize: options.engineBatchSize,
      concurrency: options.engineConcurrency,
      timeoutMs: options.engineTimeoutMs,
      onStatus: status,
    });
    const outcome = await modelEngine.classify(classified);
    if (outcome.results.size === 0) {
      throw new Error(
        `${label}引擎没有返回有效分类。${outcome.errors[0] ? `首个错误：${outcome.errors[0]}` : ''}`,
      );
    }
    const merged = mergeEngineResults(classified, outcome, engine);
    classified = merged.repos;
    if (merged.fallback > 0) {
      warnings.push(
        `${label}引擎有 ${merged.fallback} 个仓库未返回有效结果，已回退规则引擎；` +
          `有效模型结果 ${merged.applied}/${classified.length}。`,
      );
    }
    for (const error of outcome.errors.slice(0, 3)) warnings.push(`${label}引擎：${error}`);
    if (outcome.errors.length > 3) {
      warnings.push(`${label}引擎还有 ${outcome.errors.length - 3} 条错误未展示。`);
    }
  }

  const unclassified = classified.filter((item) => item.level === 'unclassified').length;
  if (unclassified > 0) {
    warnings.push(`${unclassified} 个项目证据不足，已放入「待归类」；建议补充 --deep。`);
  }

  return {
    schemaVersion: 1,
    username,
    profile,
    fetchedAt,
    deep: options.deep || deepCount > 0,
    totalStarred,
    totalAnalyzed: classified.length,
    truncated,
    engine,
    repos: classified,
    warnings: [...new Set(warnings)],
  };
}
