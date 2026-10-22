import pc from 'picocolors';
import { ORDERED_LEVELS } from '../levels.js';
import type { Dataset, Level } from '../types.js';
import { formatCount, formatPercent } from '../util.js';

function width(text: string): number {
  let result = 0;
  for (const char of text) {
    result += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(
      char,
    )
      ? 2
      : 1;
  }
  return result;
}

function padEndDisplay(text: string, target: number): string {
  const padding = Math.max(0, target - width(text));
  return `${text}${' '.repeat(padding)}`;
}

export interface SummaryOptions {
  outDir: string;
  reviewCount: number;
  counts: Record<Level, number>;
  color?: boolean;
}

export function formatConsoleSummary(dataset: Dataset, options: SummaryOptions): string {
  const color = options.color !== false;
  const bold = color ? pc.bold : (text: string) => text;
  const dim = color ? pc.dim : (text: string) => text;
  const cyan = color ? pc.cyan : (text: string) => text;
  const yellow = color ? pc.yellow : (text: string) => text;
  const green = color ? pc.green : (text: string) => text;

  const total = dataset.totalAnalyzed;
  const classified = total - (options.counts.unclassified ?? 0);
  const deepCount = dataset.repos.filter((item) => item.deepAnalyzed).length;

  const lines: string[] = [];
  lines.push('');
  lines.push(
    `${bold(`⭐ @${dataset.username}`)} ${dim('·')} 共 ${formatCount(
      dataset.totalStarred,
    )} 个 Star ${dim('·')} 本次分析 ${formatCount(total)} 个`,
  );
  lines.push('');

  const widthName = Math.max(
    ...ORDERED_LEVELS.map((meta) => width(`${meta.emoji} ${meta.zh}`)),
  );
  for (const meta of ORDERED_LEVELS) {
    const count = options.counts[meta.id] ?? 0;
    if (count === 0) continue;
    const name = `${meta.emoji} ${meta.zh}`;
    lines.push(
      `  ${padEndDisplay(name, widthName)}  ${bold(
        String(count).padStart(4, ' '),
      )}  ${dim(formatPercent(count, total).padStart(5, ' '))}`,
    );
  }
  lines.push('');
  lines.push(
    `  ${green('✔')} 已归类 ${formatCount(classified)} / ${formatCount(total)}（${formatPercent(
      classified,
      total,
    )}）`,
  );
  if (deepCount > 0) {
    lines.push(`  ${cyan('◆')} 深度分析 ${formatCount(deepCount)} 个仓库`);
  }
  if (options.reviewCount > 0) {
    lines.push(
      `  ${yellow('!')} ${options.reviewCount} 个项目置信度较低，见 ${cyan(
        'review.md',
      )}`,
    );
  }
  for (const warning of dataset.warnings) {
    lines.push(`  ${yellow('!')} ${warning}`);
  }
  if (dataset.engine && dataset.engine !== 'rules') {
    const label = dataset.engine === 'edge' ? '端侧小模型' : '大模型';
    lines.push(`  ${dim('引擎')}: ${cyan(label)}`);
  }
  lines.push('');
  lines.push(
    `  输出目录：${cyan(options.outDir)} ${dim('（README.md / lists/ / data.json）')}`,
  );
  lines.push('');
  return lines.join('\n');
}
