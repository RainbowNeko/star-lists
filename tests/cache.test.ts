import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCache } from '../src/cache.js';
import { makeTempDir } from './helpers.js';

describe('FileCache', () => {
  it('写入 / 读取 / 过期 / 删除', async () => {
    const root = await makeTempDir('cache-');
    const cache = new FileCache(root, 12);
    await cache.set('key', { hello: 'world' });
    const value = await cache.get<{ hello: string }>('key');
    expect(value?.data.hello).toBe('world');
    expect(value?.fetchedAt).toBeTruthy();

    await cache.delete('key');
    expect(await cache.get('key')).toBeNull();
  });

  it('过期缓存返回 null', async () => {
    const root = await makeTempDir('cache-');
    const cache = new FileCache(root, -1);
    await cache.set('key', 1);
    expect(await cache.get('key')).toBeNull();
  });

  it('损坏的缓存文件不抛错', async () => {
    const root = await makeTempDir('cache-');
    await mkdir(root, { recursive: true });
    const cache = new FileCache(root, 12);
    await cache.set('key', 1);
    const { readdir, writeFile } = await import('node:fs/promises');
    const [name] = await readdir(root);
    if (name) await writeFile(join(root, name), '{broken');
    expect(await cache.get('key')).toBeNull();
  });
});
