#!/usr/bin/env node
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import pc from 'picocolors';
import { resolveToken } from './auth.js';
import { resolveEngineConfig } from './engine.js';
import { isFacetGroup } from './facets.js';
import { GitHubClient, GraphQLApiError, RateLimitError } from './github.js';
import { isLevel, ORDERED_LEVELS } from './levels.js';
import { writeDataset } from './output.js';
import { analyzeUser } from './pipeline.js';
import { formatPublishReport, GitHubListsApi, publishLists } from './publish.js';
import { formatConsoleSummary } from './render/console.js';
import type { FacetGroup, Level, RunOptions } from './types.js';

const VERSION = '0.1.0';

interface CliOptions {
  out?: string;
  token?: string;
  deep?: boolean;
  deepMax: string;
  concurrency: string;
  since?: string;
  limit?: string;
  minStars: string;
  excludeForks?: boolean;
  excludeArchived?: boolean;
  cacheTtl: string;
  cache: boolean;
  refresh?: boolean;
  input?: string;
  json?: boolean;
  quiet?: boolean;
  engine: 'rules' | 'edge' | 'large';
  engineBaseUrl?: string;
  engineModel?: string;
  engineApiKey?: string;
  engineBatchSize?: string;
  engineConcurrency?: string;
  engineTimeout: string;
  sort: 'stars' | 'name' | 'starred';
  top: string;
  publish?: boolean;
  publishDryRun?: boolean;
  replaceLists?: boolean;
  skipLevels?: string;
  facetLists?: string;
  yes?: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function positiveInt(value: string | undefined, name: string, fallback: number, max = 10_000): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    fail(`${name} 需要是 0~${max} 之间的整数，收到：${value}`);
  }
  return parsed;
}

function parseSince(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail(`--since 不是有效日期：${value}（示例：2024-01-01）`);
  }
  return date;
}

function parseLevels(value?: string): Level[] | undefined {
  if (!value) return undefined;
  const levels: Level[] = [];
  for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!isLevel(part)) {
      fail(`未知层级「${part}」。可选：${ORDERED_LEVELS.map((meta) => meta.id).join(', ')}`);
    }
    levels.push(part);
  }
  return levels;
}

function parseFacetGroups(value?: string): FacetGroup[] | undefined {
  if (!value) return undefined;
  const groups: FacetGroup[] = [];
  for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!isFacetGroup(part)) {
      fail(`未知标签维度「${part}」。可选：form, layer, role, domain`);
    }
    if (!groups.includes(part)) groups.push(part);
  }
  return groups;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    fail('非交互环境执行 --publish 需要加 --yes 确认。');
  }
  const answer = await ask(`${message} [y/N] `);
  return /^y(es)?$/i.test(answer.trim());
}

function printError(error: unknown, json: boolean): void {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    return;
  }
  const prefix = pc.red('✖');
  const extra =
    error instanceof RateLimitError && error.resetAt
      ? `\n  重置时间：${error.resetAt.toLocaleString('zh-CN')}`
      : '';
  const graphQLExtra =
    error instanceof GraphQLApiError && error.errors.length > 1
      ? `\n${error.errors.map((item) => `  - ${item.type ?? 'ERROR'}: ${item.message}`).join('\n')}`
      : '';
  process.stderr.write(`${prefix} ${message}${extra}${graphQLExtra}\n`);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('starlists')
    .description('读取 GitHub 用户的全部 Star，按技术层级分类为多份 star list（可选同步到 GitHub Lists）')
    .version(VERSION)
    .argument('[username]', 'GitHub 用户名（使用 --input 时可省略）')
    .option('-o, --out <dir>', '输出目录（默认 out/<username>）')
    .option('--token <token>', 'GitHub token（默认读取 GITHUB_TOKEN / GH_TOKEN / gh auth token）')
    .option('--deep', '读取文件树、manifest 与 README 做深度分析（更准，但更慢）')
    .option('--deep-max <n>', '深度分析最多分析多少个仓库', '300')
    .option('--concurrency <n>', '深度分析并发数（1-16）', '4')
    .option('--since <date>', '只保留该日期之后 Star 的项目，例如 2024-01-01')
    .option('--limit <n>', '只处理前 N 个 Star（调试用，不写缓存）')
    .option('--min-stars <n>', '只保留 Star 数不少于 N 的项目', '0')
    .option('--exclude-forks', '排除 fork 仓库')
    .option('--exclude-archived', '排除已归档仓库')
    .option('--cache-ttl <hours>', 'Star 列表缓存时长（小时）', '12')
    .option('--no-cache', '禁用缓存')
    .option('--refresh', '忽略缓存，重新拉取')
    .option('--input <file>', '从本地 JSON 读取（离线 / 演示 / 复用 data.json）')
    .addOption(
      new Option(
        '--engine <name>',
        '分类引擎：rules=规则（默认）/ edge=端侧小模型 / large=大模型（OpenAI 兼容接口）',
      )
        .choices(['rules', 'edge', 'large'])
        .default('rules'),
    )
    .option('--engine-base-url <url>', '模型引擎的 OpenAI 兼容接口地址（如 http://127.0.0.1:11434/v1）')
    .option('--engine-model <model>', '模型名（如 qwen2.5:3b / deepseek-chat）')
    .option('--engine-api-key <key>', '模型 API key（建议改用环境变量）')
    .option('--engine-batch-size <n>', '每次请求分类多少个仓库', '20')
    .option('--engine-concurrency <n>', '模型引擎并发批次数')
    .option('--engine-timeout <seconds>', '单次模型请求超时秒数', '120')
    .option('--json', '把完整结果 JSON 打印到 stdout（日志走 stderr）')
    .option('-q, --quiet', '只输出错误')
    .addOption(
      new Option('--sort <mode>', '清单排序方式').choices(['stars', 'name', 'starred']).default('stars'),
    )
    .option('--top <n>', '每个清单最多展示 N 项（0 = 全部）', '0')
    .option('--publish', '把分类同步为 GitHub Lists（需要 token 具备 user scope）')
    .option('--publish-dry-run', '只展示 Lists 同步计划，不写入')
    .option('--replace-lists', '同步时覆盖仓库已有列表归属（默认保留并合并）')
    .option('--skip-levels <levels>', '同步时跳过某些层级，逗号分隔，如 resource,unclassified')
    .option('--facet-lists <groups>', '同步时额外发布的正交标签维度，逗号分隔，如 form')
    .option('-y, --yes', '跳过发布确认')
    .addHelpText(
      'after',
      `
示例：
  $ starlists sindresorhus
  $ starlists torvalds --deep --token $GITHUB_TOKEN
  $ starlists sindresorhus --publish --publish-dry-run
  $ starlists --input out/sindresorhus/data.json --out out/offline
  $ starlists sindresorhus --engine edge --engine-model qwen2.5:3b
  $ starlists sindresorhus --engine large --engine-model deepseek-chat

层级：
  kernel        🧩 内核与系统底层
  foundation    🏗️ 基础库
  dependency    📦 软件依赖包
  cli           ⌨️ 命令行应用
  server        🌐 服务端应用
  app           🖥️ 应用
  resource      📚 资源与模板
  unclassified  ❓ 待归类
`,
    )
    .action(async (usernameArg: string | undefined, options: CliOptions) => {
      let username = usernameArg;
      if (!username && !options.input) {
        if (process.stdin.isTTY) {
          username = (await ask('GitHub 用户名：')).trim();
        }
        if (!username) {
          fail('请提供 GitHub 用户名，或使用 --input 读取本地数据。运行 starlists --help 查看用法。');
        }
      }

      const concurrency = positiveInt(options.concurrency, '--concurrency', 4, 16) || 1;
      const deepMax = positiveInt(options.deepMax, '--deep-max', 300, 100_000);
      const parsedLimit = options.limit
        ? positiveInt(options.limit, '--limit', 0, 1_000_000)
        : 0;
      const limit = parsedLimit > 0 ? parsedLimit : undefined;
      const minStars = positiveInt(options.minStars, '--min-stars', 0, 1_000_000_000);
      const cacheTtl = positiveInt(options.cacheTtl, '--cache-ttl', 12, 24 * 365);
      const top = positiveInt(options.top, '--top', 0, 100_000);
      const since = parseSince(options.since);
      const skipLevels = parseLevels(options.skipLevels);
      const facetGroups = parseFacetGroups(options.facetLists);
      const engineBatchSize = positiveInt(options.engineBatchSize, '--engine-batch-size', 20, 500);
      if (engineBatchSize < 1) fail('--engine-batch-size 需要是正整数。');
      const engineConcurrency = options.engineConcurrency
        ? positiveInt(options.engineConcurrency, '--engine-concurrency', 1, 8)
        : undefined;
      const engineTimeoutSeconds = positiveInt(options.engineTimeout, '--engine-timeout', 120, 3600);
      if (engineTimeoutSeconds < 1) fail('--engine-timeout 需要是正整数。');
      const engine = options.engine;
      const publish = Boolean(options.publish || options.publishDryRun);
      const dryRun = Boolean(options.publishDryRun);

      if (options.replaceLists && !publish) {
        fail('--replace-lists 需要与 --publish 一起使用。');
      }

      const resolved = await resolveToken(options.token);
      if (engine !== 'rules') {
        // 提前校验模型引擎配置，避免先拉取 star 再报错。
        resolveEngineConfig({
          engine,
          baseUrl: options.engineBaseUrl,
          model: options.engineModel,
          apiKey: options.engineApiKey,
          batchSize: engineBatchSize,
          concurrency: engineConcurrency,
          timeoutMs: engineTimeoutSeconds * 1000,
        });
      }

      if (publish && !resolved.token) {
        fail(
          '同步 GitHub Lists 需要 token。请设置 GITHUB_TOKEN / GH_TOKEN，或运行 gh auth login。\n' +
            '  创建/更新 Lists 还需要 user scope：gh auth refresh -h github.com -s user',
        );
      }

      const runOptions: RunOptions = {
        username: username ?? '',
        token: resolved.token,
        deep: Boolean(options.deep),
        deepMax,
        concurrency,
        since,
        limit,
        minStars,
        includeForks: !options.excludeForks,
        includeArchived: !options.excludeArchived,
        cacheTtlHours: cacheTtl,
        cacheEnabled: options.cache !== false,
        refresh: Boolean(options.refresh),
        input: options.input,
        json: Boolean(options.json),
        quiet: Boolean(options.quiet),
        engine,
        engineBaseUrl: options.engineBaseUrl,
        engineModel: options.engineModel,
        engineApiKey: options.engineApiKey,
        engineBatchSize,
        engineConcurrency,
        engineTimeoutMs: engineTimeoutSeconds * 1000,
      };

      const quiet = Boolean(options.quiet);
      const json = Boolean(options.json);
      const status = (message: string): void => {
        if (!quiet) process.stderr.write(`${pc.dim('·')} ${pc.dim(message)}\n`);
      };

      const dataset = await analyzeUser({ ...runOptions, onStatus: status });
      const outDir = options.out ?? join('out', dataset.username);
      const displayOutDir = relative(process.cwd(), outDir) || '.';
      const written = await writeDataset(dataset, {
        outDir,
        sort: options.sort,
        topPerList: top,
      });

      let publishReport = null;
      if (publish) {
        const targetLevels = ORDERED_LEVELS.map((meta) => meta.id).filter(
          (level) => !skipLevels?.includes(level),
        );
        const targetCount = dataset.repos.filter((item) => targetLevels.includes(item.level)).length;
        const targetLists = new Set(
          dataset.repos
            .filter((item) => targetLevels.includes(item.level))
            .map((item) => item.level),
        ).size;

        if (targetCount === 0) {
          fail('没有可同步的项目：请检查 --skip-levels。');
        }

        if (!dryRun && !options.yes) {
          const mode = options.replaceLists ? '覆盖已有列表归属' : '保留已有列表并合并';
          const ok = await confirm(
            `即将把 ${targetCount} 个仓库同步到 ${targetLists} 个 GitHub Lists（${mode}），继续？`,
          );
          if (!ok) {
            process.stderr.write('已取消发布。\n');
            if (!quiet && !json) {
              process.stdout.write(
                formatConsoleSummary(dataset, {
                  outDir: displayOutDir,
                  counts: written.counts,
                  reviewCount: written.reviewCount,
                }),
              );
            }
            return;
          }
        }

        const client = new GitHubClient({ token: resolved.token });
        const api = new GitHubListsApi(client);
        publishReport = await publishLists({
          api,
          dataset,
          levels: targetLevels,
          replaceLists: Boolean(options.replaceLists),
          facetGroups,
          dryRun,
          concurrency: 2,
          log: status,
          onProgress: (done, total) => {
            if (done === total || done % 50 === 0) status(`同步 Lists ${done}/${total}…`);
          },
        });
      }

      if (json) {
        process.stdout.write(
          `${JSON.stringify({ ...dataset, outDir: written.outDir, publish: publishReport }, null, 2)}\n`,
        );
      } else if (!quiet) {
        process.stdout.write(
          formatConsoleSummary(dataset, {
            outDir: displayOutDir,
            counts: written.counts,
            reviewCount: written.reviewCount,
          }),
        );
        if (publishReport) {
          process.stdout.write(`${formatPublishReport(publishReport)}\n\n`);
        }
      }

      if (publishReport && publishReport.failed.length > 0) {
        process.exitCode = 1;
      }
    });

  program.showHelpAfterError('（运行 starlists --help 查看完整用法）');
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  printError(error, false);
  process.exitCode = 1;
});
