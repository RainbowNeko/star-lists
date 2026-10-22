import type { GitHubProfile, StarredRepo } from './types.js';

export class GitHubError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.url = url;
  }
}

export class RateLimitError extends GitHubError {
  readonly resetAt: Date | null;

  constructor(message: string, url: string, resetAt: Date | null) {
    super(message, 403, url);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

export class UserNotFoundError extends Error {
  readonly username: string;

  constructor(username: string) {
    super(`GitHub 用户不存在或不可见：${username}`);
    this.name = 'UserNotFoundError';
    this.username = username;
  }
}

export interface GraphQLErrorPayload {
  type?: string;
  message: string;
  path?: (string | number)[];
}

export class GraphQLApiError extends Error {
  readonly errors: GraphQLErrorPayload[];

  constructor(errors: GraphQLErrorPayload[]) {
    super(errors.map((e) => e.message).join('; ') || 'GraphQL 请求失败');
    this.name = 'GraphQLApiError';
    this.errors = errors;
  }

  hasType(type: string): boolean {
    return this.errors.some((error) => error.type === type);
  }
}

export interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  apiBase?: string;
  rawBase?: string;
  graphqlUrl?: string;
  maxRetries?: number;
  log?: (message: string) => void;
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  reset: Date | null;
  used: number | null;
}

export interface StarredFetchResult {
  repos: StarredRepo[];
  /** 是否因为 max 限制或 API 分页上限而没有拉全。 */
  truncated: boolean;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

export interface TreeResult {
  sha: string;
  truncated: boolean;
  tree: TreeEntry[];
}

export interface RepoPayload {
  id?: number;
  node_id?: string;
  name?: string;
  full_name?: string;
  owner?: { login?: string };
  html_url?: string;
  description?: string | null;
  topics?: string[];
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  archived?: boolean;
  fork?: boolean;
  private?: boolean;
  size?: number;
  homepage?: string | null;
  default_branch?: string;
  pushed_at?: string | null;
  created_at?: string | null;
  license?: { spdx_id?: string | null } | null;
}

/** 把 GitHub REST 的 repo 对象（或 fixture）归一化为内部结构。 */
export function toStarredRepo(
  payload: RepoPayload,
  starredAt: string | null = null,
): StarredRepo {
  const fullName = payload.full_name ?? payload.name ?? '';
  const owner = payload.owner?.login ?? fullName.split('/')[0] ?? '';
  const name = payload.name ?? fullName.split('/')[1] ?? fullName;
  return {
    id: payload.id ?? 0,
    nodeId: payload.node_id ?? '',
    nameWithOwner: fullName,
    owner,
    name,
    url: payload.html_url ?? `https://github.com/${fullName}`,
    description: payload.description ?? null,
    topics: Array.isArray(payload.topics) ? payload.topics : [],
    language: payload.language ?? null,
    stars: payload.stargazers_count ?? 0,
    forks: payload.forks_count ?? 0,
    archived: payload.archived === true,
    fork: payload.fork === true,
    isPrivate: payload.private === true,
    size: payload.size ?? 0,
    homepage: payload.homepage || null,
    defaultBranch: payload.default_branch ?? 'main',
    pushedAt: payload.pushed_at ?? null,
    createdAt: payload.created_at ?? null,
    starredAt,
    license: payload.license?.spdx_id ?? null,
  };
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match && match[2] === 'next') return match[1] ?? null;
  }
  return null;
}

function parseRateLimit(headers: Headers): RateLimitState | null {
  if (!headers.has('x-ratelimit-limit') && !headers.has('x-ratelimit-remaining')) {
    return null;
  }
  const num = (name: string): number | null => {
    const value = headers.get(name);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const reset = num('x-ratelimit-reset');
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    reset: reset ? new Date(reset * 1000) : null,
    used: num('x-ratelimit-used'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 极简 GitHub API 客户端：REST + GraphQL + raw 文件。
 * 只依赖原生 fetch，便于注入 mock 做测试。
 */
export class GitHubClient {
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly rawBase: string;
  private readonly graphqlUrl: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly log: (message: string) => void;

  rateLimit: RateLimitState = { limit: null, remaining: null, reset: null, used: null };
  requestCount = 0;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.rawBase = (options.rawBase ?? 'https://raw.githubusercontent.com').replace(/\/$/, '');
    this.graphqlUrl = options.graphqlUrl ?? 'https://api.github.com/graphql';
    this.userAgent = options.userAgent ?? 'star-lists/0.1 (+https://github.com)';
    this.maxRetries = options.maxRetries ?? 3;
    this.log = options.log ?? (() => {});
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
      ...extra,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    description: string,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.requestCount += 1;
        const response = await this.fetchImpl(url, init);
        const rateLimit = parseRateLimit(response.headers);
        if (rateLimit) this.rateLimit = rateLimit;

        if (response.ok) return response;

        if (
          response.status === 403 &&
          response.headers.get('x-ratelimit-remaining') === '0'
        ) {
          const reset = this.rateLimit.reset;
          const resetText = reset ? reset.toLocaleString('zh-CN') : '未知';
          throw new RateLimitError(
            `GitHub API 限额已用尽（${description}），将于 ${resetText} 重置。请设置 GITHUB_TOKEN 后重试。`,
            url,
            reset,
          );
        }

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after') ?? '0');
          const wait = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          if (attempt < this.maxRetries) {
            this.log(`GitHub 返回 ${response.status}，${wait}ms 后重试：${description}`);
            await sleep(wait);
            continue;
          }
        }

        let message = `GitHub 请求失败（${response.status}）：${description}`;
        try {
          const body = (await response.json()) as { message?: string };
          if (body.message) message += ` — ${body.message}`;
        } catch {
          // ignore
        }
        throw new GitHubError(message, response.status, url);
      } catch (error) {
        if (error instanceof RateLimitError || error instanceof GitHubError) throw error;
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
      }
    }
    throw new GitHubError(
      `网络请求失败：${description} — ${String(lastError)}`,
      0,
      url,
    );
  }

  private async requestJson<T>(
    path: string,
    options: { accept?: string; query?: Record<string, string | number> } = {},
  ): Promise<{ data: T; response: Response }> {
    const url = new URL(`${this.apiBase}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const response = await this.fetchWithRetry(
      url.toString(),
      { headers: this.headers(options.accept ? { Accept: options.accept } : {}) },
      path,
    );
    const data = (await response.json()) as T;
    return { data, response };
  }

  async getUser(username: string): Promise<GitHubProfile> {
    try {
      const { data } = await this.requestJson<{
        login: string;
        name: string | null;
        avatar_url: string | null;
        html_url: string;
        bio: string | null;
        public_repos: number | null;
        followers: number | null;
      }>(`/users/${encodeURIComponent(username)}`);
      return {
        login: data.login,
        name: data.name ?? null,
        avatarUrl: data.avatar_url ?? null,
        htmlUrl: data.html_url,
        bio: data.bio ?? null,
        publicRepos: data.public_repos ?? null,
        followers: data.followers ?? null,
      };
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) {
        throw new UserNotFoundError(username);
      }
      throw error;
    }
  }

  /** 拉取用户所有 starred 仓库（按 starred_at 倒序）。 */
  async listStarred(
    username: string,
    options: { max?: number; perPage?: number; onProgress?: (loaded: number) => void } = {},
  ): Promise<StarredFetchResult> {
    const perPage = Math.min(100, options.perPage ?? 100);
    const max = options.max ?? Number.POSITIVE_INFINITY;
    const repos: StarredRepo[] = [];
    let page = 1;
    let truncated = false;

    for (;;) {
      let result: {
        data: Array<{ starred_at?: string; repo?: RepoPayload } | RepoPayload>;
        response: Response;
      };
      try {
        result = await this.requestJson(
          `/users/${encodeURIComponent(username)}/starred`,
          {
            accept: 'application/vnd.github.star+json',
            query: { per_page: perPage, page },
          },
        );
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) {
          throw new UserNotFoundError(username);
        }
        throw error;
      }

      const items = Array.isArray(result.data) ? result.data : [];
      for (const item of items) {
        const wrapper = item as { starred_at?: string; repo?: RepoPayload };
        const payload = wrapper.repo ?? (item as RepoPayload);
        if (!payload || typeof payload !== 'object') continue;
        const repo = toStarredRepo(payload, wrapper.starred_at ?? null);
        if (!repo.nameWithOwner) continue;
        repos.push(repo);
        if (repos.length >= max) {
          truncated = true;
          break;
        }
      }

      options.onProgress?.(repos.length);
      if (repos.length >= max) {
        truncated = true;
        break;
      }
      const next = parseLinkNext(result.response.headers.get('link'));
      if (!next) break;
      page += 1;
      if (page > 1000) {
        truncated = true;
        break;
      }
    }

    return { repos, truncated };
  }

  /** 获取仓库完整文件树（递归）。 */
  async getTree(fullName: string, ref: string): Promise<TreeResult> {
    const encodedRef = ref
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    try {
      const { data } = await this.requestJson<TreeResult>(
        `/repos/${fullName}/git/trees/${encodedRef}`,
        { query: { recursive: '1' } },
      );
      return {
        sha: data.sha ?? '',
        truncated: data.truncated === true,
        tree: Array.isArray(data.tree) ? data.tree : [],
      };
    } catch (error) {
      if (error instanceof GitHubError && error.status === 409) {
        return { sha: '', truncated: false, tree: [] };
      }
      throw error;
    }
  }

  /** 从 raw.githubusercontent.com 读取文本（支持 Range）。 */
  async getRawFile(
    fullName: string,
    ref: string,
    path: string,
    maxBytes = 64 * 1024,
  ): Promise<string | null> {
    const encodedRef = ref
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    const encodedPath = path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    const url = `${this.rawBase}/${fullName}/${encodedRef}/${encodedPath}`;
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': this.userAgent,
          Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
        },
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  /** 执行 GraphQL 查询 / 变更。 */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.fetchWithRetry(
      this.graphqlUrl,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query, variables }),
      },
      'GraphQL',
    );
    const json = (await response.json()) as {
      data?: T;
      errors?: GraphQLErrorPayload[];
    };
    if (json.errors?.length) {
      throw new GraphQLApiError(json.errors);
    }
    if (!json.data) {
      throw new GraphQLApiError([{ message: 'GraphQL 返回了空数据' }]);
    }
    return json.data;
  }
}
