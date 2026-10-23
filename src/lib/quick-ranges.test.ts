import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchQuickRange, quickRangeBounds, quickRangeDays, readRememberedQuickRange, rememberQuickRange } from './quick-ranges';

const TZ = 'America/Los_Angeles';

describe('quick ranges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-10-23 10:00 in Los Angeles.
    vi.setSystemTime(new Date('2026-10-23T17:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('are store-timezone calendar days, ending today', () => {
    expect(quickRangeDays('7d', TZ)).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    expect(quickRangeDays('30d', TZ)).toEqual({ from: '2026-09-24', to: '2026-10-23' });
    expect(quickRangeDays('yesterday', TZ)).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(quickRangeDays('mtd', TZ)).toEqual({ from: '2026-10-01', to: '2026-10-23' });
  });

  it('a range is recognised as the quick range it equals', () => {
    expect(matchQuickRange(quickRangeBounds('30d', TZ), TZ)).toBe('30d');
    expect(matchQuickRange(quickRangeBounds('today', TZ), TZ)).toBe('today');
    const custom = { from: new Date('2026-10-05T07:00:00Z'), to: new Date('2026-10-09T06:59:59Z') };
    expect(matchQuickRange(custom, TZ)).toBeNull();
  });

  it('remembers the last quick range; a custom one goes back to today', () => {
    rememberQuickRange('30d');
    expect(readRememberedQuickRange()).toBe('30d');
    rememberQuickRange(null);
    expect(readRememberedQuickRange()).toBe('today');
    localStorage.setItem('dashboard_quick_range', 'junk');
    expect(readRememberedQuickRange()).toBe('today');
  });
});
