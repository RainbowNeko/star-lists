import type { Dataset, Level, PublishReport } from './types.js';
import { GraphQLApiError, type GitHubClient } from './github.js';
import { LEVELS, ORDERED_LEVELS } from './levels.js';
import { mapLimit, sleep } from './util.js';

export interface PublishRepoItem {
  id: string;
  nameWithOwner: string;
}

export interface ExistingList {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  items: PublishRepoItem[];
}

/** 对 GitHub Lists 的最小抽象，便于用假实现做单测。 */
export interface ListsApi {
  viewerLogin(): Promise<string>;
  fetchLists(): Promise<ExistingList[]>;
  createList(input: { name: string; description: string }): Promise<{ id: string; name: string }>;
  setItemLists(itemId: string, listIds: string[]): Promise<void>;
  resolveRepoId(fullName: string): Promise<string | null>;
}

export class PublishPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishPermissionError';
  }
}

interface ViewerData {
  viewer: { login: string };
}

interface ListItemNode {
  id: string;
  nameWithOwner: string;
}

interface ItemsPage {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<ListItemNode | null>;
}

interface UserListNode {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  items: ItemsPage;
}

interface ListsData {
  viewer: {
    lists: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: UserListNode[];
    };
  };
}

const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      login
    }
  }
`;

const LISTS_QUERY = /* GraphQL */ `
  query Lists($after: String) {
    viewer {
      lists(first: 50, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          description
          isPrivate
          items(first: 100) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ... on Repository {
                id
                nameWithOwner
              }
            }
          }
        }
      }
    }
  }
`;

const ITEMS_QUERY = /* GraphQL */ `
  query ListItems($listId: ID!, $after: String) {
    node(id: $listId) {
      ... on UserList {
        items(first: 100, after: $after) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Repository {
              id
              nameWithOwner
            }
          }
        }
      }
    }
  }
`;

const CREATE_LIST_MUTATION = /* GraphQL */ `
  mutation CreateList($name: String!, $description: String) {
    createUserList(input: { name: $name, description: $description }) {
      list {
        id
        name
        description
        isPrivate
      }
    }
  }
`;

const SET_ITEM_LISTS_MUTATION = /* GraphQL */ `
  mutation SetItemLists($itemId: ID!, $listIds: [ID!]!) {
    updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
      item {
        ... on Repository {
          id
          nameWithOwner
        }
      }
      lists {
        id
        name
      }
    }
  }
`;

const REPO_ID_QUERY = /* GraphQL */ `
  query RepoId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
    }
  }
`;

/** 基于 GitHub GraphQL 的实现。变更类操作需要 token 具备 `user` scope。 */
export class GitHubListsApi implements ListsApi {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  async viewerLogin(): Promise<string> {
    const data = await this.client.graphql<ViewerData>(VIEWER_QUERY);
    return data.viewer.login;
  }

  async fetchLists(): Promise<ExistingList[]> {
    const result: ExistingList[] = [];
    let after: string | null = null;

    do {
      const data: ListsData = await this.client.graphql<ListsData>(LISTS_QUERY, {
        after,
      });
      for (const node of data.viewer.lists.nodes) {
        const items = [...node.items.nodes];
        let page = node.items;
        while (page.pageInfo.hasNextPage && page.pageInfo.endCursor) {
          const next = await this.client.graphql<{
            node: { items: ItemsPage } | null;
          }>(ITEMS_QUERY, { listId: node.id, after: page.pageInfo.endCursor });
          if (!next.node) break;
          page = next.node.items;
          items.push(...page.nodes);
        }
        result.push({
          id: node.id,
          name: node.name,
          description: node.description,
          isPrivate: node.isPrivate,
          items: items.filter((item): item is ListItemNode => Boolean(item?.id)),
        });
      }
      after = data.viewer.lists.pageInfo.hasNextPage
        ? data.viewer.lists.pageInfo.endCursor
        : null;
    } while (after);

    return result;
  }

  async createList(input: {
    name: string;
    description: string;
  }): Promise<{ id: string; name: string }> {
    const data = await this.client.graphql<{
      createUserList: { list: { id: string; name: string } | null } | null;
    }>(CREATE_LIST_MUTATION, input);
    const list = data.createUserList?.list;
    if (!list) throw new Error(`创建列表失败：${input.name}`);
    return list;
  }

  async setItemLists(itemId: string, listIds: string[]): Promise<void> {
    await this.client.graphql(SET_ITEM_LISTS_MUTATION, { itemId, listIds });
  }

  async resolveRepoId(fullName: string): Promise<string | null> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) return null;
    const data = await this.client.graphql<{
      repository: { id: string } | null;
    }>(REPO_ID_QUERY, { owner, name });
    return data.repository?.id ?? null;
  }
}

export interface PublishOptions {
  api: ListsApi;
  dataset: Dataset;
  /** 只同步这些层级；默认全部。 */
  levels?: Level[];
  /** 覆盖仓库已有的其它列表（默认保留）。 */
  replaceLists?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  log?: (message: string) => void;
  onProgress?: (done: number, total: number, current: string) => void;
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof GraphQLApiError &&
    (error.hasType('INSUFFICIENT_SCOPES') ||
      error.errors.some((item) => /scope/i.test(item.message)))
  );
}

async function setItemListsWithRetry(
  api: ListsApi,
  itemId: string,
  listIds: string[],
  log: (message: string) => void,
): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await api.setItemLists(itemId, listIds);
      return;
    } catch (error) {
      if (isPermissionError(error)) throw error;
      const retryable =
        error instanceof GraphQLApiError &&
        (error.hasType('RATE_LIMITED') ||
          error.errors.some((item) => /rate limit|secondary/i.test(item.message)));
      if (!retryable || attempt === attempts) throw error;
      const wait = 1500 * attempt;
      log(`GitHub Lists 限流，${wait}ms 后重试…`);
      await sleep(wait);
    }
  }
}

/**
 * 把分类结果同步为 GitHub Lists。
 *
 * 注意：Lists 属于 token 对应的 viewer，因此只能整理自己的 star。
 * 默认保留仓库已有的其它列表归属，只增量添加目标列表；`replaceLists`
 * 会把仓库的列表归属精确改成目标列表（会移除手工列表）。
 */
export async function publishLists(options: PublishOptions): Promise<PublishReport> {
  const { api, dataset } = options;
  const dryRun = options.dryRun === true;
  const replaceLists = options.replaceLists === true;
  const log = options.log ?? (() => {});

  const viewer = await api.viewerLogin();
  if (viewer.toLowerCase() !== dataset.username.toLowerCase()) {
    throw new PublishPermissionError(
      `Lists 属于 token 所属账号 @${viewer}，无法为 @${dataset.username} 创建。` +
        '请使用该账号的 token，或省略 --publish 只生成 Markdown。',
    );
  }

  const allowed = new Set<Level>(
    options.levels ?? ORDERED_LEVELS.map((meta) => meta.id),
  );
  const groups = new Map<Level, Dataset['repos']>();
  for (const level of ORDERED_LEVELS.map((meta) => meta.id)) {
    groups.set(level, []);
  }
  for (const item of dataset.repos) {
    if (allowed.has(item.level)) groups.get(item.level)?.push(item);
  }

  const nonEmpty = [...groups.entries()].filter(([, items]) => items.length > 0);
  if (nonEmpty.length === 0) {
    throw new Error('没有可同步的项目：所有层级都为空。');
  }

  const existing = await api.fetchLists();
  const byName = new Map(existing.map((list) => [list.name, list]));
  const listIdByLevel = new Map<Level, string>();
  const createdLists: string[] = [];
  const reusedLists: string[] = [];

  for (const [level] of nonEmpty) {
    const meta = LEVELS[level];
    const found = byName.get(meta.listName);
    if (found) {
      listIdByLevel.set(level, found.id);
      reusedLists.push(found.name);
      continue;
    }
    if (dryRun) {
      listIdByLevel.set(level, `dry-run:${level}`);
      createdLists.push(meta.listName);
      continue;
    }
    try {
      const created = await api.createList({
        name: meta.listName,
        description: meta.listDescription,
      });
      listIdByLevel.set(level, created.id);
      createdLists.push(created.name);
      log(`已创建列表「${created.name}」`);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new PublishPermissionError(
          '当前 token 缺少 `user` scope，无法创建 GitHub Lists。\n' +
            '  gh auth refresh -h github.com -s user\n' +
            '或使用带 user scope 的 classic PAT。',
        );
      }
      throw error;
    }
  }

  const existingByRepo = new Map<string, string[]>();
  for (const list of existing) {
    for (const item of list.items) {
      const current = existingByRepo.get(item.id) ?? [];
      if (!current.includes(list.id)) current.push(list.id);
      existingByRepo.set(item.id, current);
    }
  }

  const report: PublishReport = {
    viewer,
    createdLists,
    reusedLists,
    updated: [],
    unchanged: 0,
    failed: [],
    dryRun,
  };

  const total = dataset.repos.filter((item) => allowed.has(item.level)).length;
  let done = 0;
  log(
    `${dryRun ? '（dry-run）' : ''}准备同步 ${total} 个仓库到 ${nonEmpty.length} 个列表…`,
  );

  await mapLimit(
    dataset.repos.filter((item) => allowed.has(item.level)),
    Math.max(1, options.concurrency ?? 2),
    async (item) => {
      const targetId = listIdByLevel.get(item.level);
      done += 1;
      options.onProgress?.(done, total, item.repo.nameWithOwner);
      if (!targetId) return;

      let itemId = item.repo.nodeId;
      if (!itemId) {
        try {
          itemId = (await api.resolveRepoId(item.repo.nameWithOwner)) ?? '';
        } catch (error) {
          report.failed.push({
            repo: item.repo.nameWithOwner,
            error: String(error),
          });
          return;
        }
        if (!itemId) {
          report.failed.push({
            repo: item.repo.nameWithOwner,
            error: '无法解析仓库的 GraphQL ID',
          });
          return;
        }
      }

      const current = existingByRepo.get(itemId) ?? [];
      const desired = replaceLists
        ? [targetId]
        : [...new Set([...current, targetId])];
      const same =
        desired.length === current.length &&
        desired.every((id) => current.includes(id));
      if (same) {
        report.unchanged += 1;
        return;
      }
      if (dryRun) {
        report.updated.push(item.repo.nameWithOwner);
        return;
      }
      try {
        await setItemListsWithRetry(api, itemId, desired, log);
        report.updated.push(item.repo.nameWithOwner);
      } catch (error) {
        if (isPermissionError(error)) {
          throw new PublishPermissionError(
            '当前 token 缺少 `user` scope，无法更新 GitHub Lists。\n' +
              '  gh auth refresh -h github.com -s user',
          );
        }
        report.failed.push({
          repo: item.repo.nameWithOwner,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  return report;
}

export function formatPublishReport(report: PublishReport): string {
  const verb = report.dryRun ? '将更新' : '已更新';
  const lines = [
    `GitHub Lists 同步${report.dryRun ? '（dry-run，未写入）' : ''}`,
    `  账号：@${report.viewer}`,
    `  新建列表：${report.createdLists.length ? report.createdLists.join('、') : '无'}`,
    `  复用列表：${report.reusedLists.length ? report.reusedLists.join('、') : '无'}`,
    `  ${verb}仓库：${report.updated.length}`,
    `  无需变更：${report.unchanged}`,
  ];
  if (report.failed.length > 0) {
    lines.push(`  失败：${report.failed.length}`);
    for (const item of report.failed.slice(0, 10)) {
      lines.push(`    - ${item.repo}: ${item.error}`);
    }
    if (report.failed.length > 10) {
      lines.push(`    … 其余 ${report.failed.length - 10} 个见日志`);
    }
  }
  return lines.join('\n');
}
