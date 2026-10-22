import { describe, expect, it } from 'vitest';
import { renderDataset } from '../src/render/markdown.js';
import { classified, makeDataset } from './helpers.js';

function file(files: Array<{ path: string; content: string }>, path: string): string {
  const found = files.find((item) => item.path === path);
  if (!found) throw new Error(`missing file: ${path}`);
  return found.content;
}

describe('renderDataset', () => {
  const dataset = makeDataset([
    classified('demo/cli', 'cli', { description: 'A | B cli tool', stars: 1200, language: 'Go' }),
    classified('demo/kernel', 'kernel', { description: 'Kernel module', stars: 5000 }),
    classified('demo/unknown', 'unclassified', { description: null }, 0.15),
  ]);

  it('生成 README、清单、review 与 JSON', () => {
    const result = renderDataset(dataset);
    const paths = result.files.map((item) => item.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('lists/01-kernel.md');
    expect(paths).toContain('lists/04-cli.md');
    expect(paths).toContain('lists/08-unclassified.md');
    expect(paths).toContain('review.md');
    expect(paths).toContain('data.json');
    expect(paths).toContain('lists.json');
    expect(paths).not.toContain('lists/02-foundation.md');

    const readme = file(result.files, 'README.md');
    expect(readme).toContain('共 **3** 个 Star');
    expect(readme).toContain('[🧩 内核与系统底层](lists/01-kernel.md)');
    expect(readme).toContain('已归类 **2**');
  });


  it('转义表格中的竖线', () => {
    const result = renderDataset(dataset);
    const cli = file(result.files, 'lists/04-cli.md');
    expect(cli).toContain('A \\| B cli tool');
  });

  it('data.json / lists.json 可解析', () => {
    const result = renderDataset(dataset);
    const data = JSON.parse(file(result.files, 'data.json')) as {
      username: string;
      repos: unknown[];
    };
    expect(data.username).toBe('demo');
    expect(data.repos).toHaveLength(3);

    const lists = JSON.parse(file(result.files, 'lists.json')) as {
      lists: Array<{ level: string; count: number }>;
    };
    expect(lists.lists.map((item) => item.level).sort()).toEqual(['cli', 'kernel', 'unclassified']);
    expect(lists.lists.find((item) => item.level === 'cli')?.count).toBe(1);
  });

  it('topPerList 截断并保留总数', () => {
    const result = renderDataset(dataset, { topPerList: 1 });
    expect(file(result.files, 'lists/04-cli.md')).toContain('**1** 个项目');
  });
});
