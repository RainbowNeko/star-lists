/** 并发受限的 map，保持结果顺序。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index] as T;
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 201234 → 201k，1234 → 1.2k。 */
export function formatStars(stars: number): string {
  if (stars >= 1_000_000) {
    return `${(stars / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (stars >= 10_000) {
    return `${Math.round(stars / 1000)}k`;
  }
  if (stars >= 1000) {
    return `${(stars / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(stars);
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  const percent = (part / total) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function truncate(text: string, max: number): string {
  const clean = oneLine(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 避免描述中的 `|` 破坏 Markdown 表格。 */
export function escapeTableCell(text: string): string {
  return oneLine(text).replace(/\|/g, '\\|');
}

export function formatDate(iso: string | null): string {
  if (!iso) return '未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}
