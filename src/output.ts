import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { renderDataset, type RenderOptions } from './render/markdown.js';
import type { Dataset, Level } from './types.js';

export interface WriteOptions extends RenderOptions {
  outDir: string;
}

export interface WriteResult {
  outDir: string;
  files: string[];
  counts: Record<Level, number>;
  reviewCount: number;
  readmePath: string;
}

const GENERATED_LIST_RE = /^\d{2}-[a-z-]+\.md$/;

/** 先写临时文件再 rename，读者只会看到完整旧文件或完整新文件。 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temp, content, 'utf8');
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** 写入 README、lists/*.md、review.md、data.json、lists.json。 */
export async function writeDataset(
  dataset: Dataset,
  options: WriteOptions,
): Promise<WriteResult> {
  const outDir = resolve(options.outDir);
  if (outDir === resolve(process.cwd())) {
    throw new Error('输出目录不能是当前工作目录，请使用 --out out/<username> 之类的子目录。');
  }
  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, 'lists'), { recursive: true });

  const rendered = renderDataset(dataset, options);
  const expected = new Set(rendered.files.map((file) => file.path));

  // data.json 是读取方判断“这批产物已完成”的提交点，放到最后写。
  const files = [...rendered.files];
  const commitIndex = files.findIndex((file) => file.path === 'data.json');
  const commit = commitIndex === -1 ? undefined : files.splice(commitIndex, 1)[0];

  for (const file of files) {
    await writeFileAtomic(join(outDir, file.path), file.content);
  }

  // 清理上一次生成但本次已不存在的清单，避免留旧数据
  try {
    const listFiles = await readdir(join(outDir, 'lists'));
    for (const name of listFiles) {
      if (GENERATED_LIST_RE.test(name) && !expected.has(`lists/${name}`)) {
        await unlink(join(outDir, 'lists', name));
      }
    }
  } catch {
    // 目录刚刚创建时可能为空
  }
  if (!expected.has('review.md')) {
    try {
      await unlink(join(outDir, 'review.md'));
    } catch {
      // ignore
    }
  }

  if (commit) await writeFileAtomic(join(outDir, commit.path), commit.content);

  return {
    outDir,
    files: rendered.files.map((file) => join(outDir, file.path)),
    counts: rendered.counts,
    reviewCount: dataset.repos.filter((item) => item.needsReview).length,
    readmePath: join(outDir, 'README.md'),
  };
}
