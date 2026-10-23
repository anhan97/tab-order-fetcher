/**
 * Relative date ranges (Today, 7d, MTD…) as store-timezone calendar days.
 * Shared by the dashboard picker and AppContext, which remembers the last
 * one picked and re-anchors it when the day or the timezone changes.
 */
import { addDaysToDateString, formatInTz, todayInTz, tzDayBoundsUtc } from '@/utils/dateUtils';

export type QuickRange = 'today' | 'yesterday' | '7d' | '14d' | '30d' | '90d' | 'mtd' | 'ytd';

export const QUICK_RANGES: Array<{ key: QuickRange; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7d' },
  { key: '14d', label: '14d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' }
];

export function isQuickRange(v: unknown): v is QuickRange {
  return typeof v === 'string' && QUICK_RANGES.some(r => r.key === v);
}

/** Calendar-day bounds (YYYY-MM-DD, store tz) for a quick range. */
export function quickRangeDays(key: QuickRange, tz: string): { from: string; to: string } {
  const today = todayInTz(tz);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDaysToDateString(today, -1); return { from: y, to: y }; }
    case '7d': return { from: addDaysToDateString(today, -6), to: today };
    case '14d': return { from: addDaysToDateString(today, -13), to: today };
    case '30d': return { from: addDaysToDateString(today, -29), to: today };
    case '90d': return { from: addDaysToDateString(today, -89), to: today };
    case 'mtd': return { from: today.slice(0, 7) + '-01', to: today };
    case 'ytd': return { from: today.slice(0, 4) + '-01-01', to: today };
  }
}

/** UTC instants spanning whole store-tz days. */
export function daysToRange(fromDay: string, toDay: string, tz: string): { from: Date; to: Date } {
  return { from: tzDayBoundsUtc(fromDay, tz).from, to: tzDayBoundsUtc(toDay, tz).to };
}

export function quickRangeBounds(key: QuickRange, tz: string): { from: Date; to: Date } {
  const d = quickRangeDays(key, tz);
  return daysToRange(d.from, d.to, tz);
}

/** Which quick range a range is, if any (first match: Today before MTD on the 1st). */
export function matchQuickRange(range: { from: Date; to: Date }, tz: string): QuickRange | null {
  const from = formatInTz(range.from, tz, 'yyyy-MM-dd');
  const to = formatInTz(range.to, tz, 'yyyy-MM-dd');
  return QUICK_RANGES.find(r => {
    const d = quickRangeDays(r.key, tz);
    return d.from === from && d.to === to;
  })?.key ?? null;
}

const STORAGE_KEY = 'dashboard_quick_range';

/**
 * The quick range picked last on this browser; today by default. A custom
 * range is not remembered: dates picked by hand go stale.
 */
export function readRememberedQuickRange(): QuickRange {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isQuickRange(v) ? v : 'today';
  } catch {
    return 'today';
  }
}

export function rememberQuickRange(key: QuickRange | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — remembering is a convenience only */
  }
}
