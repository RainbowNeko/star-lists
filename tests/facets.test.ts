import { describe, expect, it } from 'vitest';
import {
  facetListName,
  inferFacets,
  sanitizeFacets,
  withLevelFacets,
} from '../src/facets.js';
import { makeRepo, makeSignals } from './helpers.js';

describe('正交标签', () => {
  it('结合主层级、topics 与描述推断', () => {
    const repo = makeRepo('demo/tool', {
      topics: ['cli', 'devtools'],
      description: 'A command-line tool for developers',
    });
    const facets = inferFacets(repo, undefined, 'cli');
    expect(facets.form).toContain('cli');
    expect(facets.layer).toContain('infra');
    expect(facets.role).toContain('operational');
    expect(facets.domain).toContain('devtools');
  });

  it('同一个仓库可以同时是库和 CLI', () => {
    const repo = makeRepo('demo/pkg', {
      topics: ['library', 'cli'],
      description: 'A small library with a command-line interface',
    });
    const facets = inferFacets(repo, undefined, 'dependency');
    expect(facets.form).toEqual(expect.arrayContaining(['library', 'cli']));
    expect(facets.layer).toContain('platform');
    expect(facets.role).toEqual(expect.arrayContaining(['runtime', 'operational']));
  });

  it('深度信号补充形态、层次与领域', () => {
    const repo = makeRepo('demo/model', { description: 'model runner' });
    const deep = makeSignals({ hasGguf: true, hasDockerfile: true, hasTauri: true });
    const facets = inferFacets(repo, deep, 'unclassified');
    expect(facets.form).toEqual(expect.arrayContaining(['data', 'gui']));
    expect(facets.domain).toContain('ai');
    expect(facets.layer).toContain('infra');
    expect(facets.role).toContain('operational');
  });

  it('主层级变化时替换旧的基础标签', () => {
    const facets = withLevelFacets(
      { form: ['library'], layer: ['platform'], role: ['runtime'], domain: [] },
      'dependency',
      'cli',
    );
    expect(facets.form).toEqual(['cli']);
    expect(facets.layer).toEqual(['infra']);
    expect(facets.role).toEqual(['operational']);
  });

  it('清洗模型标签并忽略未知值', () => {
    const facets = sanitizeFacets({
      form: ['cli', 'not-a-form'],
      layer: ['infra'],
      role: 'bad',
      domain: ['ai'],
    });
    expect(facets?.form).toEqual(['cli']);
    expect(facets?.layer).toEqual(['infra']);
    expect(facets?.role).toEqual([]);
    expect(facets?.domain).toEqual(['ai']);
    expect(sanitizeFacets({ form: ['not-a-form'] })).toBeUndefined();
  });

  it('标签列表名稳定', () => {
    expect(facetListName('form', 'cli')).toContain('形态');
    expect(facetListName('form', 'cli')).toContain('命令行');
  });
});
