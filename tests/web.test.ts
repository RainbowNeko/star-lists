import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWebServer } from '../src/web/server.js';
import { classified, makeDataset } from './helpers.js';

let server: Server;
let base = '';
let datasetDir = '';
let datasetDirName = '';

beforeAll(async () => {
  server = createWebServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;

  const outRoot = join(process.cwd(), 'out');
  await mkdir(outRoot, { recursive: true });
  datasetDir = await mkdtemp(join(outRoot, 'web-test-'));
  datasetDirName = `out/${datasetDir.split(/[\\/]/).pop()}`;
  const dataset = makeDataset([
    classified('owner/a', 'dependency'),
    classified('owner/b', 'server'),
    classified('owner/c', 'dependency', {}, 0.3),
  ]);
  await writeFile(join(datasetDir, 'data.json'), JSON.stringify(dataset, null, 2), 'utf8');
});

afterAll(async () => {
  await rm(datasetDir, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function loadDataset(): Promise<{
  revision: string;
  repos: Array<{
    repo: { nameWithOwner: string };
    level: string;
    needsReview: boolean;
    evidence: Array<{ source: string; reason: string }>;
  }>;
}> {
  const response = await fetch(`${base}/api/dataset?dir=${encodeURIComponent(datasetDirName)}`);
  expect(response.status).toBe(200);
  return response.json();
}

function save(
  revision: string,
  changes: Array<{ nameWithOwner: string; level: string; reviewed?: boolean }>,
) {
  return fetch(`${base}/api/reclassify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: datasetDirName, revision, changes }),
  });
}

describe('web server', () => {
  it('health 与 levels', async () => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    expect(health.ok).toBe(true);

    const levels = await fetch(`${base}/api/levels`).then((r) => r.json());
    expect(levels.levels).toHaveLength(8);
    expect(levels.levels[0].id).toBe('kernel');
    expect(levels.levels[7].id).toBe('unclassified');
  });

  it('静态首页可访问', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('star-lists');
  });

  it('拒绝 out/ 之外的目录', async () => {
    const response = await fetch(`${base}/api/dataset?dir=../etc`);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('out/');
  });

  it('reclassify 用 revision 做乐观并发控制', async () => {
    const loaded = await loadDataset();
    expect(typeof loaded.revision).toBe('string');
    expect(loaded.revision).toHaveLength(16);

    const saved = await save(loaded.revision, [{ nameWithOwner: 'owner/a', level: 'app' }]);
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.changed).toBe(1);
    expect(body.revision).not.toBe(loaded.revision);

    const stale = await save(loaded.revision, [{ nameWithOwner: 'owner/a', level: 'kernel' }]);
    expect(stale.status).toBe(409);

    const after = await loadDataset();
    expect(after.repos.find((item) => item.repo.nameWithOwner === 'owner/a')?.level).toBe('app');
  });

  it('并发保存同一数据集只允许一个成功', async () => {
    const loaded = await loadDataset();
    const [first, second] = await Promise.all([
      save(loaded.revision, [{ nameWithOwner: 'owner/a', level: 'cli' }]),
      save(loaded.revision, [{ nameWithOwner: 'owner/b', level: 'app' }]),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('未找到的仓库通过 missing 返回，且不产生残留临时文件', async () => {
    const loaded = await loadDataset();
    const response = await save(loaded.revision, [
      { nameWithOwner: 'owner/missing', level: 'cli' },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changed).toBe(0);
    expect(body.missing).toEqual(['owner/missing']);

    const entries = [...(await readdir(datasetDir)), ...(await readdir(join(datasetDir, 'lists')))];
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('复核确认保持层级并清除待复核标记', async () => {
    const loaded = await loadDataset();
    const before = loaded.repos.find((item) => item.repo.nameWithOwner === 'owner/c');
    expect(before?.needsReview).toBe(true);

    const response = await save(loaded.revision, [
      { nameWithOwner: 'owner/c', level: 'dependency', reviewed: true },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changed).toBe(1);
    const after = body.dataset.repos.find(
      (item: { repo: { nameWithOwner: string } }) => item.repo.nameWithOwner === 'owner/c',
    );
    expect(after.level).toBe('dependency');
    expect(after.confidence).toBe(1);
    expect(after.needsReview).toBe(false);
    expect(after.evidence[0].source).toBe('manual');
    expect(after.evidence[0].reason).toBe('人工复核确认');
  });
});
