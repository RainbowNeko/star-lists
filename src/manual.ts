import { isLevel } from './levels.js';
import { withLevelFacets } from './facets.js';
import type { Dataset, Evidence, Level } from './types.js';

export interface ManualChange {
  nameWithOwner: string;
  level: Level;
  /** true 表示“确认当前层级无误”：保持层级不变，清除待复核标记。 */
  reviewed?: boolean;
}

export interface ManualApplyResult {
  dataset: Dataset;
  changed: number;
  missing: string[];
}

/** 把人工分类应用到 Dataset；保留原仓库、深度信号与已有证据。 */
export function applyManualChanges(
  dataset: Dataset,
  changes: ManualChange[],
): ManualApplyResult {
  const byName = new Map(
    dataset.repos.map((item) => [item.repo.nameWithOwner.toLowerCase(), item]),
  );
  const updates = new Map<string, ManualChange>();
  const missing: string[] = [];

  for (const change of changes) {
    const key = change.nameWithOwner.toLowerCase();
    if (!byName.has(key)) {
      missing.push(change.nameWithOwner);
      continue;
    }
    if (!isLevel(change.level)) continue;
    updates.set(key, change);
  }

  let changed = 0;
  const repos = dataset.repos.map((item) => {
    const change = updates.get(item.repo.nameWithOwner.toLowerCase());
    if (!change) return item;
    const next = change.level;

    if (change.reviewed) {
      // 复核确认：只有当前层级与选择一致、且确实待复核时才产生变更。
      if (next !== item.level || !item.needsReview) return item;
      changed += 1;
      const evidence: Evidence[] = [
        {
          level: next,
          weight: 100,
          reason: '人工复核确认',
          source: 'manual' as const,
        },
        ...item.evidence.filter(
          (entry) => !(entry.source === 'manual' && entry.reason === '人工复核确认'),
        ),
      ].slice(0, 16);
      return {
        ...item,
        confidence: 1,
        needsReview: false,
        evidence,
      };
    }

    if (next === item.level) return item;
    changed += 1;
    const previous = item.level;
    const evidence: Evidence[] = [
      {
        level: next,
        weight: 100,
        reason: '人工手动分类',
        source: 'manual' as const,
      },
      ...item.evidence.filter((entry) => entry.source !== 'manual'),
    ].slice(0, 16);
    return {
      ...item,
      level: next,
      score: Math.max(item.score, 100),
      confidence: 1,
      evidence,
      runnerUp: previous,
      needsReview: false,
      facets: withLevelFacets(item.facets, previous, next),
    };
  });

  return {
    dataset: { ...dataset, repos },
    changed,
    missing,
  };
}
