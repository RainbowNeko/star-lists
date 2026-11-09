import { ORDERED_LEVELS } from './levels.js';
import { DOMAIN_FACETS, FORM_FACETS, LAYER_FACETS, LEVEL_IDS, ROLE_FACETS } from './types.js';
import type {
  ClassifiedRepo,
  DeepSignals,
  EngineName,
  Evidence,
  Level,
  RepoFacets,
} from './types.js';
import { mergeFacets, sanitizeFacets } from './facets.js';
import { mapLimit, sleep } from './util.js';

/** 模型引擎：rules 以外的两种实现。 */
export type ModelEngineName = Exclude<EngineName, 'rules'>;

export interface EngineConfig {
  engine: ModelEngineName;
  baseUrl: string;
  model: string;
  apiKey?: string;
  batchSize: number;
  concurrency: number;
  timeoutMs: number;
}

export interface EngineClassification {
  nameWithOwner: string;
  level: Level;
  confidence: number;
  reason: string;
  facets?: RepoFacets;
}

export interface EngineOutcome {
  results: Map<string, EngineClassification>;
  errors: string[];
}

export interface EngineOptions {
  engine: ModelEngineName;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  batchSize?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** 测试注入；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 进度日志。 */
  onStatus?: (message: string) => void;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 解析引擎默认配置；显式参数优先于环境变量。 */
export function resolveEngineConfig(options: EngineOptions): EngineConfig {
  const commonBase = env('STARLISTS_ENGINE_BASE_URL');
  const commonModel = env('STARLISTS_ENGINE_MODEL');
  const commonKey = env('STARLISTS_ENGINE_API_KEY');

  let baseUrl: string | undefined;
  let model: string | undefined;
  let apiKey: string | undefined;

  if (options.engine === 'edge') {
    baseUrl =
      options.baseUrl ??
      env('STARLISTS_EDGE_BASE_URL') ??
      commonBase ??
      'http://127.0.0.1:11434/v1';
    model =
      options.model ?? env('STARLISTS_EDGE_MODEL') ?? commonModel ?? 'qwen2.5:3b';
    apiKey =
      options.apiKey ?? env('STARLISTS_EDGE_API_KEY') ?? commonKey ?? 'ollama';
  } else {
    baseUrl = options.baseUrl ?? env('STARLISTS_LARGE_BASE_URL') ?? commonBase;
    model = options.model ?? env('STARLISTS_LARGE_MODEL') ?? commonModel;
    apiKey =
      options.apiKey ??
      env('STARLISTS_LARGE_API_KEY') ??
      commonKey ??
      env('OPENAI_API_KEY');
    if (!baseUrl) {
      throw new Error(
        '大模型引擎需要 OpenAI 兼容接口地址：--engine-base-url 或 STARLISTS_LARGE_BASE_URL（例如 https://api.deepseek.com/v1）',
      );
    }
    if (!model) {
      throw new Error(
        '大模型引擎需要模型名：--engine-model 或 STARLISTS_LARGE_MODEL（例如 deepseek-chat）',
      );
    }
  }

  return {
    engine: options.engine,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    apiKey,
    batchSize: Math.max(1, options.batchSize ?? 20),
    concurrency: Math.max(1, Math.min(8, options.concurrency ?? (options.engine === 'edge' ? 1 : 2))),
    timeoutMs: Math.max(1000, options.timeoutMs ?? 120_000),
  };
}

function endpoint(baseUrl: string): string {
  if (/\/chat\/completions\/?$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function summarizeSignals(signals?: DeepSignals): string[] {
  if (!signals) return [];
  const flags: Array<[string, boolean | undefined]> = [
    ['dockerfile', signals.hasDockerfile],
    ['compose', signals.hasCompose],
    ['tauri', signals.hasTauri],
    ['electron-builder', signals.hasElectronBuilder],
    ['android', signals.hasAndroidManifest],
    ['xcode', signals.hasXcodeProject],
    ['web-index', signals.hasWebIndex],
    ['frontend-framework', signals.hasFrontendFramework],
    ['main-entry', signals.hasMainEntry],
    ['gguf', signals.hasGguf],
    ['safetensors', signals.hasSafetensors],
    ['model-index', signals.hasModelIndex],
    ['tokenizer', signals.hasTokenizer],
    ['model-config', signals.hasModelConfig],
    ['onnx', signals.hasOnnx],
    ['tflite', signals.hasTflite],
    ['coreml', signals.hasCoreml],
    ['lora', signals.hasLora],
    ['training-script', signals.hasTrainingScript],
  ];
  return flags.filter(([, value]) => value === true).map(([name]) => name);
}

export function buildSystemPrompt(): string {
  const levels = ORDERED_LEVELS.map(
    (meta) => `- ${meta.id}: ${meta.emoji} ${meta.zh} — ${meta.description}`,
  ).join('\n');
  return [
    '你是 GitHub 仓库分类器。请把每个仓库归入下面 8 个层级之一：',
    levels,
    '',
    '要求：',
    '1. 只返回 JSON 数组，不要 Markdown 代码块、不要解释。',
    '2. 每个对象格式：{"name":"owner/repo","level":"kernel|foundation|dependency|cli|server|app|resource|unclassified","confidence":0.0,"reason":"简短原因","facets":{"form":[],"layer":[],"role":[],"domain":[]}}',
    '3. confidence 是 0~1 的数字；不确定时降低 confidence 或使用 unclassified。',
    '4. 必须覆盖输入中的每个仓库，name 必须与输入完全一致。',
    '5. 框架/库优先 dependency；可部署服务优先 server；awesome/教程/dotfiles 优先 resource。',
    `6. facets 是可选的附加标签，只能使用这些值：form=[${FORM_FACETS.join(',')}]；layer=[${LAYER_FACETS.join(',')}]；role=[${ROLE_FACETS.join(',')}]；domain=[${DOMAIN_FACETS.join(',')}]。`,
  ].join('\n');
}

export function buildUserPrompt(items: ClassifiedRepo[]): string {
  const payload = items.map((item) => {
    const repo = item.repo;
    const row: Record<string, unknown> = {
      name: repo.nameWithOwner,
      description: repo.description ? truncate(repo.description, 320) : null,
      topics: repo.topics.slice(0, 12),
      language: repo.language,
      stars: repo.stars,
    };
    if (repo.homepage) row.homepage = repo.homepage;
    const signals = summarizeSignals(item.signals);
    if (signals.length) row.deepSignals = signals;
    return row;
  });
  return `请分类以下 ${payload.length} 个仓库：\n${JSON.stringify(payload)}`;
}

function extractJson(content: string): unknown {
  let text = content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstArray = text.indexOf('[');
  const firstObject = text.indexOf('{');
  let start = -1;
  if (firstArray !== -1 && (firstObject === -1 || firstArray < firstObject)) start = firstArray;
  else if (firstObject !== -1) start = firstObject;
  if (start === -1) throw new Error('模型响应中没有 JSON');
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  if (end <= start) throw new Error('模型响应 JSON 不完整');
  return JSON.parse(text.slice(start, end + 1));
}

function parseClassifications(
  raw: unknown,
  batch: ClassifiedRepo[],
): EngineClassification[] {
  const container = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(container?.results)
      ? (container.results as unknown[])
      : Array.isArray(container?.repos)
        ? (container.repos as unknown[])
        : [];
  const byName = new Map(batch.map((item) => [item.repo.nameWithOwner.toLowerCase(), item]));
  const output: EngineClassification[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = String(record.name ?? record.nameWithOwner ?? '').trim();
    const target = byName.get(name.toLowerCase());
    if (!target) continue;
    const level = String(record.level ?? '').trim() as Level;
    if (!(LEVEL_IDS as readonly string[]).includes(level)) continue;
    const confidenceRaw = Number(record.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? clamp(confidenceRaw, 0, 1) : 0.6;
    const reason = String(record.reason ?? '模型分类').trim().slice(0, 240);
    output.push({
      nameWithOwner: target.repo.nameWithOwner,
      level,
      confidence,
      reason,
      facets: sanitizeFacets(record.facets),
    });
  }
  return output;
}

export class OpenAICompatibleEngine {
  readonly config: EngineConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly onStatus?: (message: string) => void;

  constructor(config: EngineConfig, options: { fetchImpl?: typeof fetch; onStatus?: (message: string) => void } = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onStatus = options.onStatus;
  }

  async classifyBatch(batch: ClassifiedRepo[]): Promise<EngineClassification[]> {
    const url = endpoint(this.config.baseUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: buildSystemPrompt() },
              { role: 'user', content: buildUserPrompt(batch) },
            ],
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          const httpError = new Error(
            `模型接口返回 ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`,
          ) as Error & { noRetry?: boolean };
          httpError.noRetry = response.status < 500 && response.status !== 429;
          throw httpError;
        }
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('模型响应为空');
        }
        return parseClassifications(extractJson(content), batch);
      } catch (error) {
        lastError = error;
        if (error instanceof Error && (error as Error & { noRetry?: boolean }).noRetry) {
          throw error;
        }
        if (error instanceof Error && error.name === 'TimeoutError') break;
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async classify(items: ClassifiedRepo[]): Promise<EngineOutcome> {
    const batches: ClassifiedRepo[][] = [];
    for (let i = 0; i < items.length; i += this.config.batchSize) {
      batches.push(items.slice(i, i + this.config.batchSize));
    }
    const results = new Map<string, EngineClassification>();
    const errors: string[] = [];
    let done = 0;
    await mapLimit(batches, this.config.concurrency, async (batch) => {
      try {
        const rows = await this.classifyBatch(batch);
        for (const row of rows) results.set(row.nameWithOwner.toLowerCase(), row);
        if (rows.length < batch.length) {
          errors.push(
            `模型只返回 ${rows.length}/${batch.length} 个结果（批次起始：${batch[0]?.repo.nameWithOwner ?? '?'}）`,
          );
        }
      } catch (error) {
        errors.push(
          `批次 ${batch[0]?.repo.nameWithOwner ?? '?'} 分类失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      done += 1;
      this.onStatus?.(`模型分类 ${done}/${batches.length} 批…`);
    });
    return { results, errors };
  }
}

export function createEngine(
  options: EngineOptions,
): OpenAICompatibleEngine {
  return new OpenAICompatibleEngine(resolveEngineConfig(options), {
    fetchImpl: options.fetchImpl,
    onStatus: options.onStatus,
  });
}

/** 用模型结果覆盖规则结果；缺失/失败的项目保留规则引擎结果。 */
export function mergeEngineResults(
  ruleResults: ClassifiedRepo[],
  outcome: EngineOutcome,
  engine: ModelEngineName,
): { repos: ClassifiedRepo[]; applied: number; fallback: number } {
  const label = engine === 'edge' ? '端侧小模型' : '大模型';
  let applied = 0;
  let fallback = 0;
  const repos = ruleResults.map((item) => {
    const model = outcome.results.get(item.repo.nameWithOwner.toLowerCase());
    if (!model) {
      fallback += 1;
      return item;
    }
    applied += 1;
    const evidence: Evidence[] = [
      {
        level: model.level,
        weight: 10,
        reason: `${label}：${model.reason || '模型分类'}`,
        source: 'model' as const,
      },
      ...item.evidence,
    ].slice(0, 16);
    return {
      ...item,
      level: model.level,
      confidence: model.confidence,
      evidence,
      runnerUp: model.level !== item.level ? item.level : item.runnerUp,
      needsReview: model.level === 'unclassified' || model.confidence < 0.5,
      facets: mergeFacets(item.facets, model.facets),
    };
  });
  return { repos, applied, fallback };
}
