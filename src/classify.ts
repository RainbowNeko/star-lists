import { findAnchor } from './anchors.js';
import { LEVEL_IDS } from './types.js';
import type {
  ClassifiedRepo,
  DeepSignals,
  Evidence,
  Level,
  StarredRepo,
} from './types.js';
import { LEVEL_PRIORITY } from './levels.js';
import { DESCRIPTION_RULES, NAME_RULES, TOPIC_RULES } from './rules.js';
import { signalsFromDeep } from './manifests.js';

const ANCHOR_WEIGHT = 12;
const MAX_EVIDENCE = 16;

export interface ClassifyOptions {
  /** 关闭锚点（测试或自定义分类时使用）。 */
  useAnchors?: boolean;
}

function emptyScores(): Record<Level, number> {
  return Object.fromEntries(LEVEL_IDS.map((id) => [id, 0])) as Record<Level, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/_/g, '-');
}

function chooseLevel(scores: Record<Level, number>): {
  level: Level;
  score: number;
  runnerUp: Level | null;
  secondScore: number;
} {
  const ranked = LEVEL_IDS.map((level) => ({ level, score: scores[level] }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || LEVEL_PRIORITY[a.level] - LEVEL_PRIORITY[b.level],
    );

  const top = ranked[0];
  if (!top) {
    return { level: 'unclassified', score: 0, runnerUp: null, secondScore: 0 };
  }
  return {
    level: top.level,
    score: top.score,
    runnerUp: ranked[1]?.level ?? null,
    secondScore: ranked[1]?.score ?? 0,
  };
}

/**
 * 规则 + 锚点 +（可选）深度信号，对单个仓库分层。
 * 纯函数，不发起网络请求。
 */
export function classifyRepo(
  repo: StarredRepo,
  deep?: DeepSignals,
  options: ClassifyOptions = {},
): ClassifiedRepo {
  const scores = emptyScores();
  const evidence: Evidence[] = [];

  const add = (
    level: Level,
    weight: number,
    reason: string,
    source: Evidence['source'],
  ): void => {
    if (weight === 0) return;
    scores[level] = Math.max(0, scores[level] + weight);
    evidence.push({ level, weight, reason, source });
  };

  // 1. 知名仓库锚点
  let anchorHit = false;
  if (options.useAnchors !== false) {
    const anchor = findAnchor(repo.nameWithOwner);
    if (anchor) {
      anchorHit = true;
      add(anchor.level, ANCHOR_WEIGHT, `锚点：${anchor.reason}`, 'anchor');
    }
  }

  // 2. topics
  const topics = new Set(repo.topics.map(normalizeTopic));
  for (const rule of TOPIC_RULES) {
    for (const topic of rule.topics) {
      if (topics.has(topic)) {
        add(rule.level, rule.weight, `${rule.reason}（${topic}）`, 'topic');
        break;
      }
    }
  }

  // 3. 仓库名
  for (const rule of NAME_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(repo.name))) {
      add(rule.level, rule.weight, rule.reason, 'name');
    }
  }

  // 4. 描述
  const description = repo.description ?? '';
  for (const rule of DESCRIPTION_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(description);
      if (match) {
        const hit = match[0].trim();
        const suffix = hit && hit.length <= 30 ? `「${hit}」` : '';
        add(rule.level, rule.weight, `${rule.reason}${suffix}`, 'description');
        break;
      }
    }
  }

  // 5. 元信息
  const homepage = repo.homepage ?? '';
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(homepage)) {
    add('app', 3, '主页指向浏览器扩展商店', 'meta');
  }
  if (/apps\.apple\.com|play\.google\.com\/store/i.test(homepage)) {
    add('app', 3, '主页指向移动应用商店', 'meta');
  }
  if (repo.language === 'Jupyter Notebook') {
    add('resource', 1, 'Jupyter Notebook 项目多为教程或实验', 'language');
  }
  if (repo.language === 'Dart' && topics.has('flutter')) {
    add('app', 1, 'Dart + Flutter 项目通常是应用', 'language');
  }
  if (repo.size > 0 && repo.size < 20 && !repo.description && repo.topics.length === 0) {
    add('unclassified', 1, '仓库信息极少（体积小、无描述、无 topics）', 'meta');
  }

  // 6. 深度信号
  if (deep) {
    for (const item of signalsFromDeep(deep)) {
      add(item.level, item.weight, item.reason, item.source);
    }
  }

  // 7. 汇总
  let { level, score, runnerUp, secondScore } = chooseLevel(scores);
  const margin = score - secondScore;

  if (level === 'unclassified' || score < 3) {
    if (level !== 'unclassified' && !runnerUp) runnerUp = level;
    level = 'unclassified';
    score = Math.max(score, 0);
  }

  let confidence: number;
  if (level === 'unclassified') {
    confidence = 0.15;
  } else if (anchorHit) {
    confidence = Math.max(0.92, clamp((score + 1 - secondScore) / (score + 2), 0, 1));
  } else {
    confidence = clamp((score + 1 - secondScore) / (score + 2), 0, 1);
  }

  const needsReview =
    level === 'unclassified' || confidence < 0.5 || margin < 2 || score < 4;

  evidence.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return {
    repo,
    level,
    score,
    confidence: Number(confidence.toFixed(2)),
    evidence: evidence.slice(0, MAX_EVIDENCE),
    runnerUp,
    needsReview,
    deepAnalyzed: Boolean(deep),
    signals: deep,
  };
}

/** 批量分类。`deepSignals` 的键为小写 `owner/name`。 */
export function classifyAll(
  repos: StarredRepo[],
  deepSignals?: Map<string, DeepSignals>,
  options: ClassifyOptions = {},
): ClassifiedRepo[] {
  return repos.map((repo) =>
    classifyRepo(repo, deepSignals?.get(repo.nameWithOwner.toLowerCase()), options),
  );
}

/**
 * 挑选值得做深度分析的仓库：待归类 > 需要复核 > 置信度低。
 * 已经是锚点的仓库跳过，避免浪费请求。
 */
export function selectDeepCandidates(
  classified: ClassifiedRepo[],
  max: number,
): ClassifiedRepo[] {
  return classified
    .filter((item) => !item.evidence.some((e) => e.source === 'anchor'))
    .filter((item) => item.level === 'unclassified' || item.needsReview || item.confidence < 0.8)
    .sort((a, b) => {
      const rank = (item: ClassifiedRepo): number =>
        item.level === 'unclassified' ? 0 : item.needsReview ? 1 : 2;
      return rank(a) - rank(b) || a.confidence - b.confidence || b.repo.stars - a.repo.stars;
    })
    .slice(0, Math.max(0, max));
}
