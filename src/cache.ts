import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CacheEntry<T> {
  version: 1;
  key: string;
  fetchedAt: string;
  data: T;
}

export interface CachedValue<T> {
  data: T;
  fetchedAt: string;
}

/** 简单的 JSON 文件缓存，用于 star 列表与深度分析结果。 */
export class FileCache {
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly onWarning: (message: string) => void;

  constructor(
    root: string,
    ttlHours = 12,
    onWarning: (message: string) => void = () => {},
  ) {
    this.root = root;
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.onWarning = onWarning;
  }

  private filePath(key: string): string {
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
    const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
    return join(this.root, `${safe}-${hash}.json`);
  }

  async get<T>(key: string): Promise<CachedValue<T> | null> {
    try {
      const text = await readFile(this.filePath(key), 'utf8');
      const entry = JSON.parse(text) as CacheEntry<T>;
      if (entry.version !== 1) return null;
      const age = Date.now() - Date.parse(entry.fetchedAt);
      if (!Number.isFinite(age) || age > this.ttlMs) return null;
      return { data: entry.data, fetchedAt: entry.fetchedAt };
    } catch {
      return null;
    }
  }

  async set<T>(key: string, data: T): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      const entry: CacheEntry<T> = {
        version: 1,
        key,
        fetchedAt: new Date().toISOString(),
        data,
      };
      const target = this.filePath(key);
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(entry), 'utf8');
      await rename(temporary, target);
    } catch (error) {
      this.onWarning(`写入缓存失败：${String(error)}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key));
    } catch {
      // 文件不存在时忽略
    }
  }
}
