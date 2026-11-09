#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToken } from '../auth.js';
import { resolveEngineConfig } from '../engine.js';
import { facetCatalog, isFacetGroup, inferFacets } from '../facets.js';
import { GitHubClient } from '../github.js';
import { isLevel, LEVELS, ORDERED_LEVELS } from '../levels.js';
import { applyManualChanges, type ManualChange } from '../manual.js';
import { writeDataset } from '../output.js';
import { analyzeUser } from '../pipeline.js';
import { GitHubListsApi, publishLists } from '../publish.js';
import type { Dataset, EngineName, Level, RunOptions } from '../types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '../../web');
const OUT_ROOT = resolve(process.cwd(), 'out');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '127.0.0.1';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

type JobKind = 'analyze' | 'publish';
type JobState = 'running' | 'done' | 'error';

interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  message: string;
  createdAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new HttpError(413, '请求体过大');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON');
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveOutDir(input?: unknown): string {
  const raw = typeof input === 'string' && input.trim() ? input.trim() : '';
  const target = raw ? (isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw)) : '';
  if (!target || !isInside(OUT_ROOT, target) || target === OUT_ROOT) {
    throw new HttpError(400, '输出目录必须是 out/ 下的子目录');
  }
  return target;
}

function resolveInputPath(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  const target = isAbsolute(input) ? resolve(input) : resolve(process.cwd(), input);
  if (!isInside(process.cwd(), target)) {
    throw new HttpError(400, '输入文件必须在项目目录内');
  }
  if (!existsSync(target)) throw new HttpError(400, `输入文件不存在：${input}`);
  return target;
}

async function readDataset(dir: string): Promise<Dataset> {
  return (await readDatasetWithRevision(dir)).dataset;
}

function revisionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function readDatasetWithRevision(
  dir: string,
): Promise<{ dataset: Dataset; revision: string }> {
  const text = await readFile(join(dir, 'data.json'), 'utf8');
  let parsed: Dataset;
  try {
    parsed = JSON.parse(text) as Dataset;
  } catch {
    throw new HttpError(400, `${dir}/data.json 不是合法 JSON`);
  }
  if (!parsed || !Array.isArray(parsed.repos) || typeof parsed.username !== 'string') {
    throw new HttpError(400, `${dir}/data.json 格式不正确`);
  }
  // 旧数据没有 facets：读取时按主层级与已有信号补算，写回时自然迁移。
  let enriched = false;
  const repos = parsed.repos.map((item) => {
    if (!item || typeof item !== 'object' || !item.repo || item.facets) return item;
    enriched = true;
    return { ...item, facets: inferFacets(item.repo, item.signals, item.level) };
  });
  if (enriched) parsed = { ...parsed, schemaVersion: 2, repos };
  return { dataset: parsed, revision: revisionOf(text) };
}

/** 同一输出目录的读-改-写串行化，避免并发请求互相覆盖。 */
const dirLocks = new Map<string, Promise<void>>();

function withDirLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const previous = dirLocks.get(dir) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  dirLocks.set(dir, tail);
  void tail.then(() => {
    if (dirLocks.get(dir) === tail) dirLocks.delete(dir);
  });
  return run;
}

function countLevels(repos: Dataset['repos']): Record<Level, number> {
  const counts = Object.fromEntries(ORDERED_LEVELS.map((meta) => [meta.id, 0])) as Record<Level, number>;
  for (const item of repos) counts[item.level] += 1;
  return counts;
}

function manualCount(repos: Dataset['repos']): number {
  return repos.filter((item) => item.evidence.some((entry) => entry.source === 'manual')).length;
}

function numberValue(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${name} 需要是 ${min}~${max} 之间的整数`);
  }
  return parsed;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === 1;
}

function engineValue(value: unknown): EngineName {
  if (value === 'edge' || value === 'large') return value;
  return 'rules';
}

function startJob(kind: JobKind, runner: (job: Job) => Promise<unknown>): Job {
  const job: Job = {
    id: randomUUID(),
    kind,
    state: 'running',
    message: '准备中…',
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  void (async () => {
    try {
      job.result = await runner(job);
      job.state = 'done';
      job.message = '完成';
    } catch (error) {
      job.state = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      job.message = '失败';
    } finally {
      job.finishedAt = new Date().toISOString();
      const old = [...jobs.values()].filter((item) => item.state !== 'running');
      for (const item of old.slice(0, Math.max(0, old.length - 50))) jobs.delete(item.id);
    }
  })();
  return job;
}

function getJob(id: string): Job {
  const job = jobs.get(id);
  if (!job) throw new HttpError(404, '任务不存在');
  return job;
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const engine = engineValue(body.engine);
  const input = resolveInputPath(body.input);
  const username = String(body.username ?? '').trim();
  if (!username && !input) throw new HttpError(400, '请填写 GitHub 用户名，或提供本地 data.json 路径');
  const concurrency = numberValue(body.concurrency, 'concurrency', 4, 1, 16);
  const deepMax = numberValue(body.deepMax, 'deepMax', 300, 0, 100_000);
  const minStars = numberValue(body.minStars, 'minStars', 0, 0, 1_000_000_000);
  const limit = numberValue(body.limit, 'limit', 0, 0, 1_000_000);
  const cacheTtlHours = numberValue(body.cacheTtlHours, 'cacheTtlHours', 12, 0, 24 * 365);
  const engineBatchSize = numberValue(body.engineBatchSize, 'engineBatchSize', 20, 1, 500);
  const engineConcurrency = numberValue(body.engineConcurrency, 'engineConcurrency', engine === 'edge' ? 1 : 2, 1, 8);
  const engineTimeoutMs = numberValue(body.engineTimeout, 'engineTimeout', 120, 1, 3600) * 1000;
  let since: Date | undefined;
  if (typeof body.since === 'string' && body.since.trim()) {
    since = new Date(body.since);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'since 不是有效日期');
  }

  const engineBaseUrl = textValue(body.engineBaseUrl);
  const engineModel = textValue(body.engineModel);
  const engineApiKey = textValue(body.engineApiKey);
  if (engine !== 'rules') {
    resolveEngineConfig({
      engine,
      baseUrl: engineBaseUrl,
      model: engineModel,
      apiKey: engineApiKey,
      batchSize: engineBatchSize,
      concurrency: engineConcurrency,
      timeoutMs: engineTimeoutMs,
    });
  }

  const job = startJob('analyze', async (current) => {
    const options: RunOptions = {
      username,
      token: textValue(body.token),
      deep: boolValue(body.deep),
      deepMax,
      concurrency,
      since,
      limit: limit > 0 ? limit : undefined,
      minStars,
      includeForks: !boolValue(body.excludeForks),
      includeArchived: !boolValue(body.excludeArchived),
      cacheTtlHours,
      cacheEnabled: !boolValue(body.noCache),
      refresh: boolValue(body.refresh),
      input,
      json: false,
      quiet: true,
      engine,
      engineBaseUrl,
      engineModel,
      engineApiKey,
      engineBatchSize,
      engineConcurrency,
      engineTimeoutMs,
    };
    const dataset = await analyzeUser({
      ...options,
      onStatus: (message) => {
        current.message = message;
      },
    });
    const outDir = resolveOutDir(
      typeof body.out === 'string' && body.out.trim() ? body.out : join('out', dataset.username),
    );
    const written = await withDirLock(outDir, () =>
      writeDataset(dataset, { outDir, sort: 'stars' }),
    );
    return {
      outDir: relative(process.cwd(), outDir),
      username: dataset.username,
      totalStarred: dataset.totalStarred,
      totalAnalyzed: dataset.totalAnalyzed,
      counts: written.counts,
      reviewCount: written.reviewCount,
      manualCount: manualCount(dataset.repos),
      engine: dataset.engine ?? engine,
      warnings: dataset.warnings,
    };
  });

  sendJson(res, 202, { jobId: job.id });
}

async function handleManual(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const dir = resolveOutDir(body.dir);
  const rawChanges = Array.isArray(body.changes) ? body.changes : [];
  const changes: ManualChange[] = [];
  for (const raw of rawChanges) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.nameWithOwner === 'string' ? record.nameWithOwner : '';
    const level = record.level;
    if (!name || typeof level !== 'string' || !isLevel(level)) {
      throw new HttpError(400, `无效的人工分类项：${JSON.stringify(raw)}`);
    }
    changes.push({ nameWithOwner: name, level, reviewed: record.reviewed === true });
  }
  if (changes.length === 0) throw new HttpError(400, '没有需要保存的修改');
  const expectedRevision =
    typeof body.revision === 'string' && body.revision.trim() ? body.revision.trim() : undefined;

  const result = await withDirLock(dir, async () => {
    const { dataset, revision } = await readDatasetWithRevision(dir);
    if (expectedRevision && expectedRevision !== revision) {
      throw new HttpError(409, '数据已被其他窗口或进程修改，请重新加载后再保存');
    }
    const applied = applyManualChanges(dataset, changes);
    await writeDataset(applied.dataset, { outDir: dir, sort: 'stars' });
    const text = await readFile(join(dir, 'data.json'), 'utf8');
    return { applied, revision: revisionOf(text) };
  });

  sendJson(res, 200, {
    changed: result.applied.changed,
    missing: result.applied.missing,
    counts: countLevels(result.applied.dataset.repos),
    manualCount: manualCount(result.applied.dataset.repos),
    dataset: result.applied.dataset,
    revision: result.revision,
  });
}

async function handlePublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as Record<string, unknown>;
  const dir = resolveOutDir(body.dir);
  const dataset = await readDataset(dir);
  const explicitToken = typeof body.token === 'string' ? body.token.trim() : '';
  const resolved = explicitToken ? { token: explicitToken } : await resolveToken();
  if (!resolved.token) throw new HttpError(400, '发布需要 GitHub token（建议 user scope）');
  const skipLevels = new Set(
    Array.isArray(body.skipLevels)
      ? body.skipLevels.filter((item): item is Level => typeof item === 'string' && isLevel(item))
      : [],
  );
  const levels = ORDERED_LEVELS.map((meta) => meta.id).filter((level) => !skipLevels.has(level));
  if (levels.length === 0) throw new HttpError(400, '不能跳过所有层级');
  const facetGroups = Array.isArray(body.facetLists)
    ? [...new Set(body.facetLists.filter(isFacetGroup))]
    : [];
  const dryRun = boolValue(body.dryRun);
  const replaceLists = boolValue(body.replaceLists);
  if (!dryRun && body.confirm !== true && body.yes !== true) {
    throw new HttpError(400, '写入 GitHub Lists 需要 confirm: true（建议先 dry-run）');
  }

  const job = startJob('publish', async (current) => {
    const client = new GitHubClient({ token: resolved.token });
    const api = new GitHubListsApi(client);
    const report = await publishLists({
      api,
      dataset,
      levels,
      dryRun,
      replaceLists,
      facetGroups,
      concurrency: 2,
      log: (message) => {
        current.message = message;
      },
      onProgress: (done, total) => {
        if (done === total || done % 50 === 0) current.message = `同步 ${done}/${total}…`;
      },
    });
    return report;
  });
  sendJson(res, 202, { jobId: job.id });
}

async function handleDatasets(res: ServerResponse): Promise<void> {
  if (!existsSync(OUT_ROOT)) {
    sendJson(res, 200, { datasets: [] });
    return;
  }
  const entries = await readdir(OUT_ROOT, { withFileTypes: true });
  const datasets: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(OUT_ROOT, entry.name);
    const dataPath = join(dir, 'data.json');
    if (!existsSync(dataPath)) continue;
    try {
      const dataset = await readDataset(dir);
      const info = await stat(dataPath);
      datasets.push({
        dir: `out/${entry.name}`,
        username: dataset.username,
        totalAnalyzed: dataset.totalAnalyzed,
        totalStarred: dataset.totalStarred,
        manualCount: manualCount(dataset.repos),
        fetchedAt: dataset.fetchedAt,
        updatedAt: info.mtime.toISOString(),
      });
    } catch {
      // 忽略损坏的 data.json
    }
  }
  datasets.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  sendJson(res, 200, { datasets });
}

async function handleExport(url: URL, res: ServerResponse): Promise<void> {
  const dir = resolveOutDir(url.searchParams.get('dir'));
  const data = await readFile(join(dir, 'data.json'));
  const name = `${dir.split(sep).pop() ?? 'dataset'}-data.json`;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function serveStatic(url: URL, res: ServerResponse): Promise<boolean> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '非法 URL');
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = resolve(WEB_ROOT, `.${pathname}`);
  if (!isInside(WEB_ROOT, target)) throw new HttpError(403, '禁止访问');
  if (!existsSync(target)) return false;
  const info = await stat(target);
  if (!info.isFile()) return false;
  const ext = extname(target).toLowerCase();
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  const body = await readFile(target);
  res.writeHead(200, {
    'Content-Type': mime[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
  return true;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, version: '0.1.0', cwd: process.cwd() });
    return;
  }
  if (url.pathname === '/api/levels') {
    sendJson(res, 200, {
      levels: ORDERED_LEVELS.map((meta) => ({
        id: meta.id,
        emoji: meta.emoji,
        zh: meta.zh,
        en: meta.en,
        description: meta.description,
        fileBase: meta.fileBase,
      })),
      facets: facetCatalog(),
    });
    return;
  }
  if (url.pathname === '/api/datasets' && method === 'GET') {
    await handleDatasets(res);
    return;
  }
  if (url.pathname === '/api/dataset' && method === 'GET') {
    const dir = resolveOutDir(url.searchParams.get('dir'));
    const { dataset, revision } = await readDatasetWithRevision(dir);
    sendJson(res, 200, { ...dataset, revision });
    return;
  }
  if (url.pathname === '/api/export' && method === 'GET') {
    await handleExport(url, res);
    return;
  }
  if (url.pathname === '/api/analyze' && method === 'POST') {
    await handleAnalyze(req, res);
    return;
  }
  if (url.pathname === '/api/reclassify' && method === 'POST') {
    await handleManual(req, res);
    return;
  }
  if (url.pathname === '/api/publish' && method === 'POST') {
    await handlePublish(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/jobs/') && method === 'GET') {
    const id = url.pathname.slice('/api/jobs/'.length);
    const job = getJob(id);
    sendJson(res, 200, job);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: '未知 API' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }
  if (await serveStatic(url, res)) return;
  sendText(res, 404, 'Not Found');
}

export function createWebServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.end();
    });
  });
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const server = createWebServer();
  server.listen(PORT, HOST, () => {
    console.log(`star-lists web UI: http://${HOST}:${PORT}/`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
      console.warn('⚠️ 当前绑定到非本地地址；请确保只有可信网络可以访问。');
    }
  });
}
