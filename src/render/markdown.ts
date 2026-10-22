import { LEVELS, ORDERED_LEVELS } from '../levels.js';
import type { ClassifiedRepo, Dataset, Level } from '../types.js';
import {
  escapeTableCell,
  formatCount,
  formatPercent,
  formatStars,
  truncate,
} from '../util.js';

export type SortMode = 'stars' | 'name' | 'starred';

export interface RenderOptions {
  /** 每个清单最多展示多少项；0 表示全部。 */
  topPerList?: number;
  /** README 中每个层级预览多少个。 */
  previewPerLevel?: number;
  sort?: SortMode;
  /** 生成时间，默认当前时间。 */
  generatedAt?: Date;
  /** 是否为每个层级输出独立文件（默认 true）。 */
  splitFiles?: boolean;
}

export interface RenderedFile {
  /** 相对输出目录的路径。 */
  path: string;
  content: string;
}

export interface RenderResult {
  files: RenderedFile[];
  counts: Record<Level, number>;
}

const LIST_DIR = 'lists';

export function groupByLevel(repos: ClassifiedRepo[]): Map<Level, ClassifiedRepo[]> {
  const groups = new Map<Level, ClassifiedRepo[]>();
  for (const meta of ORDERED_LEVELS) groups.set(meta.id, []);
  for (const item of repos) {
    groups.get(item.level)?.push(item);
  }
  return groups;
}

export function sortRepos(repos: ClassifiedRepo[], mode: SortMode = 'stars'): ClassifiedRepo[] {
  const sorted = [...repos];
  if (mode === 'name') {
    sorted.sort((a, b) => a.repo.nameWithOwner.localeCompare(b.repo.nameWithOwner));
    return sorted;
  }
  if (mode === 'starred') {
    sorted.sort((a, b) => {
      const aTime = a.repo.starredAt ? Date.parse(a.repo.starredAt) : 0;
      const bTime = b.repo.starredAt ? Date.parse(b.repo.starredAt) : 0;
      return bTime - aTime || b.repo.stars - a.repo.stars;
    });
    return sorted;
  }
  sorted.sort(
    (a, b) => b.repo.stars - a.repo.stars || a.repo.nameWithOwner.localeCompare(b.repo.nameWithOwner),
  );
  return sorted;
}

function repoLink(repo: ClassifiedRepo['repo']): string {
  return `[\`${repo.nameWithOwner}\`](${repo.url})`;
}

function reasonOf(item: ClassifiedRepo, limit = 62): string {
  const positives = item.evidence
    .filter((e) => e.weight > 0 && (e.level === item.level || item.level === 'unclassified'))
    .slice(0, 2)
    .map((e) => e.reason);
  if (positives.length === 0) return '—';
  return truncate(positives.join(' · '), limit);
}

function overviewRow(level: Level, count: number, total: number): string {
  const meta = LEVELS[level];
  const name = count > 0
    ? `[${meta.emoji} ${meta.zh}](${LIST_DIR}/${meta.fileBase}.md)`
    : `${meta.emoji} ${meta.zh}`;
  return `| ${name} | ${formatCount(count)} | ${formatPercent(count, total)} | ${escapeTableCell(
    meta.description,
  )} |`;
}

function renderOverview(dataset: Dataset, counts: Record<Level, number>): string {
  const total = dataset.totalAnalyzed;
  const rows = ORDERED_LEVELS.map((meta) =>
    overviewRow(meta.id, counts[meta.id] ?? 0, total),
  ).join('\n');
  return [
    '| 层级 | 数量 | 占比 | 说明 |',
    '|:--|--:|--:|:--|',
    rows,
    `| **合计** | **${formatCount(total)}** | **100%** | 本次分析的项目 |`,
  ].join('\n');
}

function renderPreview(dataset: Dataset, groups: Map<Level, ClassifiedRepo[]>, perLevel: number): string {
  const blocks: string[] = [];
  for (const meta of ORDERED_LEVELS) {
    const items = groups.get(meta.id) ?? [];
    if (items.length === 0) continue;
    const preview = sortRepos(items, 'stars').slice(0, perLevel);
    const lines = preview.map((item) => {
      const description = item.repo.description
        ? ` — ${truncate(item.repo.description, 82)}`
        : '';
      return `- ${repoLink(item.repo)} · ⭐ ${formatStars(item.repo.stars)}${
        item.repo.language ? ` · ${item.repo.language}` : ''
      }${description}`;
    });
    const more =
      items.length > preview.length
        ? `\n\n[查看全部 ${formatCount(items.length)} 个项目 →](${LIST_DIR}/${meta.fileBase}.md)`
        : '';
    blocks.push(
      `### [${meta.emoji} ${meta.zh}](${LIST_DIR}/${meta.fileBase}.md)\n\n${meta.description}\n\n${lines.join(
        '\n',
      )}${more}`,
    );
  }
  return blocks.join('\n\n');
}

function renderReadme(dataset: Dataset, groups: Map<Level, ClassifiedRepo[]>, counts: Record<Level, number>, options: Required<Pick<RenderOptions, 'previewPerLevel'>> & RenderOptions): string {
  const display = dataset.profile?.name ? `**${dataset.profile.name}**` : '';
  const login = dataset.profile?.login ?? dataset.username;
  const total = dataset.totalAnalyzed;
  const classified = total - (counts.unclassified ?? 0);
  const generatedAt = options.generatedAt ?? new Date();

  const warnings = dataset.warnings.length
    ? `>\n${dataset.warnings.map((w) => `> ⚠️ ${escapeTableCell(w)}`).join('\n')}`
    : '';

  return [
    `# ⭐ @${login} 的 Star 分层清单`,
    '',
    `> 共 **${formatCount(dataset.totalStarred)}** 个 Star · 本次分析 **${formatCount(total)}** 个 · 已归类 **${formatCount(
      classified,
    )}**（${formatPercent(classified, total)}）`,
    `>`,
    `> 数据截至 ${dataset.fetchedAt.slice(0, 10)} · 生成于 ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')}${display ? ` · ${display}` : ''}`,
    warnings,
    '',
    '## 总览',
    '',
    renderOverview(dataset, counts),
    '',
    '## 各层级速览',
    '',
    renderPreview(dataset, groups, options.previewPerLevel),
    '',
    '---',
    '',
    '## 怎么用',
    '',
    '- 每个层级对应 `lists/` 下的一个 Markdown 清单，可直接浏览、检索或粘贴到笔记里。',
    '- `data.json` 保存完整分类结果与判定依据；`lists.json` 是精简的层级 → 仓库映射。',
    '- 想同步到 GitHub 的 Stars → Lists：`starlists <username> --publish --publish-dry-run`，确认后再去掉 `--publish-dry-run`。',
    '- 置信度较低的项目汇总在 `review.md`，建议人工复核。',
    '',
    '<sub>分类基于 topics、仓库描述、manifest 与 README 的启发式规则；锚点仅用于兜底。结果不保证完全准确。</sub>',
    '',
  ].join('\n');
}

function renderListFile(
  level: Level,
  items: ClassifiedRepo[],
  dataset: Dataset,
  options: RenderOptions,
): string {
  const meta = LEVELS[level];
  const sorted = sortRepos(items, options.sort ?? 'stars');
  const limited =
    options.topPerList && options.topPerList > 0 ? sorted.slice(0, options.topPerList) : sorted;

  const rows = limited.map((item, index) => {
    const repo = item.repo;
    return `| ${index + 1} | ${repoLink(repo)} | ${formatStars(repo.stars)} | ${
      repo.language ?? '—'
    } | ${repo.description ? escapeTableCell(truncate(repo.description, 120)) : '—'} | ${escapeTableCell(
      reasonOf(item),
    )} |`;
  });

  const truncatedNote =
    limited.length < sorted.length
      ? `\n> 仅展示前 ${formatCount(limited.length)} 个，共 ${formatCount(sorted.length)} 个。\n`
      : '';

  return [
    `# ${meta.emoji} ${meta.zh}`,
    '',
    `> ${meta.description}`,
    '>',
    `> **${formatCount(items.length)}** 个项目 · 按${
      options.sort === 'name' ? '名称' : options.sort === 'starred' ? ' Star 时间' : ' Star 数'
    }排序 · 数据截至 ${dataset.fetchedAt.slice(0, 10)}`,
    truncatedNote,
    `[← 返回总览](../README.md)`,
    '',
    '| # | 项目 | ⭐ | 语言 | 简介 | 判定依据 |',
    '|--:|:--|--:|:--|:--|:--|',
    ...rows,
    '',
    '<sub>判定依据取置信度最高的前两条；完整证据见 `data.json`。</sub>',
    '',
  ].join('\n');
}

function renderReview(items: ClassifiedRepo[]): string | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.confidence - b.confidence);
  const rows = sorted.map((item) => {
    const alternative = item.runnerUp ? LEVELS[item.runnerUp].zh : '—';
    return `| ${repoLink(item.repo)} | ${LEVELS[item.level].zh} | ${Math.round(
      item.confidence * 100,
    )}% | ${alternative} | ${escapeTableCell(reasonOf(item, 70))} |`;
  });
  return [
    '# 🔍 待复核项目',
    '',
    '> 置信度低于 50%，或第一、第二候选层级分差过小的项目。建议人工确认，或在 `data.json` 中查看完整证据。',
    '',
    '| 项目 | 当前归类 | 置信度 | 次选 | 主要依据 |',
    '|:--|:--|--:|:--|:--|',
    ...rows,
    '',
    '[← 返回总览](../README.md)',
    '',
  ].join('\n');
}

function renderListsJson(dataset: Dataset, groups: Map<Level, ClassifiedRepo[]>): string {
  const lists = ORDERED_LEVELS.map((meta) => {
    const items = groups.get(meta.id) ?? [];
    return {
      level: meta.id,
      name: meta.listName,
      description: meta.description,
      file: `${LIST_DIR}/${meta.fileBase}.md`,
      count: items.length,
      repos: sortRepos(items, 'stars').map((item) => item.repo.nameWithOwner),
    };
  }).filter((list) => list.count > 0);

  return JSON.stringify(
    {
      schemaVersion: 1,
      username: dataset.username,
      generatedAt: new Date().toISOString(),
      totalStarred: dataset.totalStarred,
      totalAnalyzed: dataset.totalAnalyzed,
      lists,
    },
    null,
    2,
  );
}

/** 生成 README、各层级清单、review.md、data.json、lists.json。 */
export function renderDataset(dataset: Dataset, options: RenderOptions = {}): RenderResult {
  const groups = groupByLevel(dataset.repos);
  const counts = Object.fromEntries(
    ORDERED_LEVELS.map((meta) => [meta.id, groups.get(meta.id)?.length ?? 0]),
  ) as Record<Level, number>;

  const files: RenderedFile[] = [];
  const readme = renderReadme(dataset, groups, counts, {
    ...options,
    previewPerLevel: options.previewPerLevel ?? 5,
  });
  files.push({ path: 'README.md', content: readme });

  if (options.splitFiles !== false) {
    for (const meta of ORDERED_LEVELS) {
      const items = groups.get(meta.id) ?? [];
      if (items.length === 0) continue;
      files.push({
        path: `${LIST_DIR}/${meta.fileBase}.md`,
        content: renderListFile(meta.id, items, dataset, options),
      });
    }
  }

  const review = renderReview(dataset.repos.filter((item) => item.needsReview));
  if (review) files.push({ path: 'review.md', content: review });

  files.push({
    path: 'data.json',
    content: JSON.stringify(
      {
        ...dataset,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  });
  files.push({ path: 'lists.json', content: renderListsJson(dataset, groups) });

  return { files, counts };
}

export function readmePath(): string {
  return 'README.md';
}
