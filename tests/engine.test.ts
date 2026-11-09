import { afterEach, describe, expect, it } from 'vitest';
import {
  OpenAICompatibleEngine,
  buildSystemPrompt,
  mergeEngineResults,
  resolveEngineConfig,
  type EngineConfig,
} from '../src/engine.js';
import { classified, makeRepo } from './helpers.js';

function config(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    engine: 'edge',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:3b',
    batchSize: 2,
    concurrency: 1,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function fakeFetch(rows: unknown[], calls: string[] = []) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(rows) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

afterEach(() => {
  delete process.env.STARLISTS_ENGINE_BASE_URL;
  delete process.env.STARLISTS_ENGINE_MODEL;
  delete process.env.STARLISTS_EDGE_BASE_URL;
  delete process.env.STARLISTS_EDGE_MODEL;
  delete process.env.STARLISTS_LARGE_BASE_URL;
  delete process.env.STARLISTS_LARGE_MODEL;
  delete process.env.STARLISTS_LARGE_API_KEY;
  delete process.env.STARLISTS_EDGE_API_KEY;
  delete process.env.STARLISTS_ENGINE_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('分类引擎', () => {
  it('system prompt 只包含现有 8 层', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('kernel');
    expect(prompt).toContain('unclassified');
    expect(prompt).not.toContain('edge-model');
    expect(prompt).not.toContain('large-model');
  });

  it('按批次调用 OpenAI 兼容接口并解析结果', async () => {
    const calls: string[] = [];
    const items = [
      classified('demo/one', 'cli'),
      classified('demo/two', 'app'),
      classified('demo/three', 'server'),
    ];
    const engine = new OpenAICompatibleEngine(config(), {
      fetchImpl: fakeFetch(
        items.map((item) => ({
          name: item.repo.nameWithOwner,
          level: 'cli',
          confidence: 0.8,
          reason: 'test',
        })),
        calls,
      ),
    });
    const outcome = await engine.classify(items);
    expect(outcome.results.size).toBe(3);
    expect(calls).toHaveLength(2); // batchSize=2
    expect(outcome.results.get('demo/two')?.level).toBe('cli');
    expect(outcome.errors).toEqual([]);
  });

  it('模型漏返回时记录错误并保留规则回退', async () => {
    const items = [classified('demo/one', 'app'), classified('demo/two', 'app')];
    const engine = new OpenAICompatibleEngine(config({ batchSize: 10 }), {
      fetchImpl: fakeFetch([{ name: 'demo/one', level: 'cli', confidence: 0.9, reason: 'ok' }]),
    });
    const outcome = await engine.classify(items);
    expect(outcome.results.size).toBe(1);
    expect(outcome.errors[0]).toContain('1/2');

    const merged = mergeEngineResults(items, outcome, 'edge');
    expect(merged.applied).toBe(1);
    expect(merged.fallback).toBe(1);
    expect(merged.repos[0]?.level).toBe('cli');
    expect(merged.repos[0]?.evidence[0]?.source).toBe('model');
    expect(merged.repos[1]?.level).toBe('app');
  });

  it('解析模型返回的正交标签并与规则标签合并', async () => {
    const items = [classified('demo/one', 'cli')];
    items[0].facets = {
      form: ['cli'],
      layer: ['infra'],
      role: ['operational'],
      domain: ['devtools'],
    };
    const engine = new OpenAICompatibleEngine(config(), {
      fetchImpl: fakeFetch([
        {
          name: 'demo/one',
          level: 'server',
          confidence: 0.9,
          reason: 'test',
          facets: { form: ['api', 'not-a-form'], domain: ['infra'] },
        },
      ]),
    });
    const outcome = await engine.classify(items);
    expect(outcome.results.get('demo/one')?.facets?.form).toEqual(['api']);

    const merged = mergeEngineResults(items, outcome, 'edge');
    expect(merged.repos[0]?.facets?.form).toEqual(expect.arrayContaining(['cli', 'api']));
    expect(merged.repos[0]?.facets?.domain).toEqual(
      expect.arrayContaining(['devtools', 'infra']),
    );
  });

  it('大模型引擎缺少地址时给出明确错误', () => {
    expect(() => resolveEngineConfig({ engine: 'large' })).toThrow(/engine-base-url/);
  });

  it('端侧引擎默认使用 Ollama 地址', () => {
    const resolved = resolveEngineConfig({ engine: 'edge' });
    expect(resolved.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(resolved.model).toBe('qwen2.5:3b');
  });
});
