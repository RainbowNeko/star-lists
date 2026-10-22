import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCache } from '../src/cache.js';
import { DeepAnalyzer } from '../src/deep.js';
import type { GitHubClient, TreeResult } from '../src/github.js';
import { makeRepo } from './helpers.js';

interface FakeClient {
  treeCalls: number;
  rawCalls: string[];
  getTree(fullName: string, ref: string): Promise<TreeResult>;
  getRawFile(fullName: string, ref: string, path: string): Promise<string | null>;
}

function fakeClient(files: Record<string, string>, tree?: Partial<TreeResult>): FakeClient {
  const paths = Object.keys(files);
  return {
    treeCalls: 0,
    rawCalls: [],
    async getTree(): Promise<TreeResult> {
      this.treeCalls += 1;
      return {
        sha: 'sha',
        truncated: false,
        tree: paths.map((path) => ({ path, mode: '100644', type: 'blob' as const, size: 100 })),
        ...tree,
      };
    },
    async getRawFile(_fullName, _ref, path): Promise<string | null> {
      this.rawCalls.push(path);
      return files[path] ?? null;
    },
  };
}

describe('DeepAnalyzer', () => {
  it('读取文件树、manifest 与 README 并生成信号', async () => {
    const client = fakeClient({
      'package.json': JSON.stringify({ name: 'tiny', bin: { tiny: './cli.js' } }),
      'Dockerfile': 'FROM node:22',
      'README.md': '# tiny\n\n```bash\nnpm install -g tiny\n```',
    });
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient, { concurrency: 1 });
    const signals = await analyzer.analyzeRepo(makeRepo('acme/tiny'));

    expect(client.treeCalls).toBe(1);
    expect(signals.packageJson?.hasBin).toBe(true);
    expect(signals.hasDockerfile).toBe(true);
    expect(signals.readme?.globalInstall).toBe(true);
    expect(signals.hasMainEntry).toBe(true);
    expect(signals.errors).toEqual([]);
  });


  it('识别 GGUF / safetensors / tokenizer 等模型文件', async () => {
    const client = fakeClient({
      'model.gguf': '',
      'model.safetensors': '',
      'model.safetensors.index.json': '{}',
      'config.json': '{}',
      'tokenizer.json': '{}',
      'train.py': '',
    });
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient);
    const signals = await analyzer.analyzeRepo(makeRepo('acme/model'));
    expect(signals.hasGguf).toBe(true);
    expect(signals.hasSafetensors).toBe(true);
    expect(signals.hasModelIndex).toBe(true);
    expect(signals.hasTokenizer).toBe(true);
    expect(signals.hasModelConfig).toBe(true);
    expect(signals.hasTrainingScript).toBe(true);
  });

  it('解析内核信号', async () => {
    const client = fakeClient({
      Kconfig: 'config GPIO',
      Makefile: 'obj-m += gpio.o\n',
    });
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient);
    const signals = await analyzer.analyzeRepo(makeRepo('acme/gpio', { language: 'C' }));
    expect(signals.kernel.kconfig).toBe(true);
    expect(signals.kernel.objM).toBe(true);
  });

  it('使用缓存避免重复读取文件树', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp', 'deep-'));
    const cache = new FileCache(root, 12);
    const client = fakeClient({ 'package.json': JSON.stringify({ name: 'x' }) });
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient, { cache });

    await analyzer.analyzeRepo(makeRepo('acme/x'));
    await analyzer.analyzeRepo(makeRepo('acme/x'));
    expect(client.treeCalls).toBe(1);
  });

  it('文件树读取失败时记录错误而不抛出', async () => {
    const client = {
      async getTree(): Promise<TreeResult> {
        throw new Error('boom');
      },
      async getRawFile(): Promise<string | null> {
        return null;
      },
    };
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient);
    const signals = await analyzer.analyzeRepo(makeRepo('acme/broken'));
    expect(signals.errors[0]).toContain('boom');
  });

  it('私有仓库跳过网络请求', async () => {
    const client = fakeClient({});
    const analyzer = new DeepAnalyzer(client as unknown as GitHubClient);
    const signals = await analyzer.analyzeRepo(makeRepo('acme/private', { isPrivate: true }));
    expect(client.treeCalls).toBe(0);
    expect(signals.errors[0]).toContain('私有');
  });
});
