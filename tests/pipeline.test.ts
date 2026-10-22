import { describe, expect, it } from 'vitest';
import { analyzeUser } from '../src/pipeline.js';
import type { RunOptions } from '../src/types.js';

const base: RunOptions = {
  username: '',
  token: undefined,
  deep: false,
  deepMax: 0,
  concurrency: 1,
  minStars: 0,
  includeForks: true,
  includeArchived: true,
  cacheTtlHours: 12,
  cacheEnabled: false,
  refresh: false,
  input: 'fixtures/stars.demo.json',
  json: false,
  quiet: true,
};

describe('analyzeUser - 离线 fixture', () => {
  it('读取并分类所有演示仓库', async () => {
    const dataset = await analyzeUser(base);
    expect(dataset.username).toBe('demo');
    expect(dataset.totalStarred).toBe(33);
    expect(dataset.totalAnalyzed).toBe(33);
    expect(dataset.profile?.login).toBe('demo');

    const byName = new Map(dataset.repos.map((item) => [item.repo.nameWithOwner, item]));
    expect(byName.get('torvalds/linux')?.level).toBe('kernel');
    expect(byName.get('openssl/openssl')?.level).toBe('foundation');
    expect(byName.get('facebook/react')?.level).toBe('dependency');
    expect(byName.get('BurntSushi/ripgrep')?.level).toBe('cli');
    expect(byName.get('redis/redis')?.level).toBe('server');
    expect(byName.get('microsoft/vscode')?.level).toBe('app');
    expect(byName.get('awesome-selfhosted/awesome-selfhosted')?.level).toBe('resource');

    // fixture 自带 deep signals
    expect(byName.get('acme/gpio-mod')?.level).toBe('kernel');
    expect(byName.get('acme/tiny-cli')?.level).toBe('cli');
    expect(byName.get('acme/notes-api')?.level).toBe('server');
    expect(byName.get('acme/ui-kit')?.level).toBe('dependency');
    expect(byName.get('someuser/scratchpad')?.level).toBe('unclassified');
    expect(byName.get('someuser/scratchpad')?.needsReview).toBe(true);
  });

  it('按 star 数过滤', async () => {
    const dataset = await analyzeUser({ ...base, minStars: 100_000 });
    expect(dataset.totalStarred).toBe(33);
    expect(dataset.totalAnalyzed).toBeGreaterThan(0);
    expect(dataset.repos.every((item) => item.repo.stars >= 100_000)).toBe(true);
  });

  it('按 star 时间过滤', async () => {
    const dataset = await analyzeUser({ ...base, since: new Date('2024-01-20T00:00:00Z') });
    expect(dataset.totalAnalyzed).toBeLessThan(33);
    expect(
      dataset.repos.every(
        (item) => !item.repo.starredAt || Date.parse(item.repo.starredAt) >= Date.parse('2024-01-20T00:00:00Z'),
      ),
    ).toBe(true);
  });
});
