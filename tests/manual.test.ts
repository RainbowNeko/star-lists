import { describe, expect, it } from 'vitest';
import { applyManualChanges } from '../src/manual.js';
import { classified, makeDataset } from './helpers.js';

describe('人工手动分类', () => {
  it('修改层级并写入 manual 证据', () => {
    const dataset = makeDataset([
      classified('demo/cli', 'cli'),
      classified('demo/app', 'app'),
    ]);
    const result = applyManualChanges(dataset, [
      { nameWithOwner: 'demo/cli', level: 'server' },
    ]);
    expect(result.changed).toBe(1);
    expect(result.missing).toEqual([]);
    const changed = result.dataset.repos.find((item) => item.repo.nameWithOwner === 'demo/cli');
    expect(changed?.level).toBe('server');
    expect(changed?.confidence).toBe(1);
    expect(changed?.needsReview).toBe(false);
    expect(changed?.evidence[0]?.source).toBe('manual');
    expect(changed?.runnerUp).toBe('cli');
    // 未修改的仓库保持不变
    expect(result.dataset.repos.find((item) => item.repo.nameWithOwner === 'demo/app')?.level).toBe('app');
  });

  it('忽略不存在的仓库并返回 missing', () => {
    const dataset = makeDataset([classified('demo/cli', 'cli')]);
    const result = applyManualChanges(dataset, [
      { nameWithOwner: 'demo/nope', level: 'app' },
    ]);
    expect(result.changed).toBe(0);
    expect(result.missing).toEqual(['demo/nope']);
    expect(result.dataset.repos[0]?.level).toBe('cli');
  });

  it('相同层级不重复计数，但可覆盖旧人工证据', () => {
    const dataset = makeDataset([classified('demo/cli', 'cli')]);
    const first = applyManualChanges(dataset, [{ nameWithOwner: 'demo/cli', level: 'cli' }]);
    expect(first.changed).toBe(0);
    const second = applyManualChanges(dataset, [{ nameWithOwner: 'demo/cli', level: 'server' }]);
    expect(second.changed).toBe(1);
    expect(second.dataset.repos[0]?.evidence.filter((e) => e.source === 'manual')).toHaveLength(1);
  });

  it('复核确认保持层级并清除待复核标记', () => {
    const dataset = makeDataset([classified('demo/cli', 'cli', {}, 0.3)]);
    expect(dataset.repos[0]?.needsReview).toBe(true);
    const result = applyManualChanges(dataset, [
      { nameWithOwner: 'demo/cli', level: 'cli', reviewed: true },
    ]);
    expect(result.changed).toBe(1);
    const item = result.dataset.repos[0];
    expect(item?.level).toBe('cli');
    expect(item?.confidence).toBe(1);
    expect(item?.needsReview).toBe(false);
    expect(item?.evidence[0]?.source).toBe('manual');
    expect(item?.evidence[0]?.reason).toBe('人工复核确认');
  });

  it('复核确认在层级与当前不一致时不生效', () => {
    const dataset = makeDataset([classified('demo/cli', 'cli', {}, 0.3)]);
    const result = applyManualChanges(dataset, [
      { nameWithOwner: 'demo/cli', level: 'server', reviewed: true },
    ]);
    expect(result.changed).toBe(0);
    expect(result.dataset.repos[0]).toBe(dataset.repos[0]);
  });

  it('已确认的项目重复确认不重复计数', () => {
    const dataset = makeDataset([classified('demo/cli', 'cli', {}, 0.3)]);
    const first = applyManualChanges(dataset, [
      { nameWithOwner: 'demo/cli', level: 'cli', reviewed: true },
    ]);
    const second = applyManualChanges(first.dataset, [
      { nameWithOwner: 'demo/cli', level: 'cli', reviewed: true },
    ]);
    expect(second.changed).toBe(0);
    expect(second.dataset.repos[0]?.evidence.filter((e) => e.source === 'manual')).toHaveLength(1);
  });
});
