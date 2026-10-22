import { describe, expect, it } from 'vitest';
import { GraphQLApiError } from '../src/github.js';
import { LEVELS } from '../src/levels.js';
import {
  publishLists,
  PublishPermissionError,
  type ExistingList,
  type ListsApi,
} from '../src/publish.js';
import { classified, makeDataset } from './helpers.js';

class FakeApi implements ListsApi {
  viewer = 'demo';
  lists: ExistingList[];
  createCalls: Array<{ name: string; description: string }> = [];
  setCalls: Array<{ itemId: string; listIds: string[] }> = [];

  constructor(lists: ExistingList[] = []) {
    this.lists = lists;
  }

  async viewerLogin(): Promise<string> {
    return this.viewer;
  }

  async fetchLists(): Promise<ExistingList[]> {
    return structuredClone(this.lists);
  }

  async createList(input: { name: string; description: string }): Promise<{ id: string; name: string }> {
    this.createCalls.push(input);
    const list: ExistingList = {
      id: `L_${this.lists.length + 1}`,
      name: input.name,
      description: input.description,
      isPrivate: false,
      items: [],
    };
    this.lists.push(list);
    return { id: list.id, name: list.name };
  }

  async setItemLists(itemId: string, listIds: string[]): Promise<void> {
    this.setCalls.push({ itemId, listIds });
  }

  async resolveRepoId(): Promise<string | null> {
    return null;
  }
}

function dataset() {
  return makeDataset([
    classified('demo/cli-one', 'cli', { nodeId: 'R1' }),
    classified('demo/cli-two', 'cli', { nodeId: 'R2' }),
    classified('demo/server-one', 'server', { nodeId: 'R3' }),
  ]);
}

const cliList: ExistingList = {
  id: 'L_cli',
  name: LEVELS.cli.listName,
  description: null,
  isPrivate: false,
  items: [{ id: 'R1', nameWithOwner: 'demo/cli-one' }],
};

async function run(options: Parameters<typeof publishLists>[0]) {
  return publishLists(options);
}

describe('publishLists', () => {
  it('复用已有列表、创建缺失列表、只更新有变化的仓库', async () => {
    const api = new FakeApi([cliList]);
    const report = await run({ api, dataset: dataset() });

    expect(report.createdLists).toEqual([LEVELS.server.listName]);
    expect(report.reusedLists).toEqual([LEVELS.cli.listName]);
    expect(report.unchanged).toBe(1);
    expect(report.updated.sort()).toEqual(['demo/cli-two', 'demo/server-one']);
    expect(report.failed).toEqual([]);

    expect(api.createCalls).toHaveLength(1);
    expect(api.setCalls).toEqual([
      { itemId: 'R2', listIds: ['L_cli'] },
      { itemId: 'R3', listIds: ['L_2'] },
    ]);
  });


  it('默认保留仓库已有的其它列表', async () => {
    const resourceList: ExistingList = {
      id: 'L_res',
      name: LEVELS.resource.listName,
      description: null,
      isPrivate: false,
      items: [{ id: 'R2', nameWithOwner: 'demo/cli-two' }],
    };
    const api = new FakeApi([cliList, resourceList]);
    await run({ api, dataset: dataset() });
    expect(api.setCalls).toContainEqual({ itemId: 'R2', listIds: ['L_res', 'L_cli'] });
  });

  it('replaceLists 会精确覆盖归属', async () => {
    const resourceList: ExistingList = {
      id: 'L_res',
      name: LEVELS.resource.listName,
      description: null,
      isPrivate: false,
      items: [{ id: 'R1', nameWithOwner: 'demo/cli-one' }],
    };
    const api = new FakeApi([cliList, resourceList]);
    const report = await run({ api, dataset: dataset(), replaceLists: true });
    expect(report.unchanged).toBe(0);
    expect(api.setCalls).toContainEqual({ itemId: 'R1', listIds: ['L_cli'] });
  });

  it('dry-run 不写任何变更', async () => {
    const api = new FakeApi([cliList]);
    const report = await run({ api, dataset: dataset(), dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.createdLists).toEqual([LEVELS.server.listName]);
    expect(report.updated).toHaveLength(2);
    expect(api.createCalls).toHaveLength(0);
    expect(api.setCalls).toHaveLength(0);
  });

  it('只同步指定层级', async () => {
    const api = new FakeApi([]);
    const report = await run({ api, dataset: dataset(), levels: ['cli'] });
    expect(report.createdLists).toEqual([LEVELS.cli.listName]);
    expect(report.updated.sort()).toEqual(['demo/cli-one', 'demo/cli-two']);
    expect(api.setCalls.some((call) => call.itemId === 'R3')).toBe(false);
  });

  it('拒绝为其他账号发布', async () => {
    const api = new FakeApi();
    api.viewer = 'someone-else';
    await expect(run({ api, dataset: dataset() })).rejects.toBeInstanceOf(
      PublishPermissionError,
    );
  });

  it('缺少 user scope 时给出明确错误', async () => {
    class ScopedApi extends FakeApi {
      override async createList(): Promise<{ id: string; name: string }> {
        throw new GraphQLApiError([
          {
            type: 'INSUFFICIENT_SCOPES',
            message: "'createUserList' requires ['user']",
          },
        ]);
      }
    }
    const api = new ScopedApi([]);
    await expect(run({ api, dataset: dataset() })).rejects.toBeInstanceOf(
      PublishPermissionError,
    );
  });
});
