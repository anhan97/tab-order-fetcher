import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  todayInTz,
  addDaysToDateString,
  tzDayBoundsUtc,
  getDateRangeFromPreset,
  validateDateRange,
  formatLADateRange,
  formatInTz,
  getShopifyDateRange,
  getFacebookDateRange,
  DEFAULT_TZ
} from './dateUtils';

const LA = 'America/Los_Angeles';
const NYC = 'America/New_York';
const VN = 'Asia/Ho_Chi_Minh';

describe('dateUtils', () => {
  describe('default timezone', () => {
    it('defaults to America/Los_Angeles', () => {
      expect(DEFAULT_TZ).toBe('America/Los_Angeles');
    });
  });

  describe('todayInTz', () => {
    afterEach(() => vi.useRealTimers());

    it('returns May 2 in LA when UTC clock has just rolled past midnight', () => {
      // 2026-05-03 06:00 UTC — that's 2026-05-02 23:00 LA (PDT, UTC-7)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-03T06:00:00Z'));
      expect(todayInTz(LA)).toBe('2026-05-02');
      expect(todayInTz('UTC')).toBe('2026-05-03');
    });

    it('returns May 3 in Vietnam at the same UTC moment', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-03T06:00:00Z'));
      // Vietnam is UTC+7 — 06:00 UTC = 13:00 Vietnam
      expect(todayInTz(VN)).toBe('2026-05-03');
    });
  });

  describe('addDaysToDateString', () => {
    it('subtracts 6 days', () => {
      expect(addDaysToDateString('2026-05-03', -6)).toBe('2026-04-27');
    });
    it('crosses month boundary', () => {
      expect(addDaysToDateString('2026-05-01', -1)).toBe('2026-04-30');
    });
    it('crosses year boundary', () => {
      expect(addDaysToDateString('2026-01-01', -1)).toBe('2025-12-31');
    });
  });

  describe('tzDayBoundsUtc', () => {
    it('returns UTC bounds covering a full LA day during PDT (UTC-7)', () => {
      const { from, to } = tzDayBoundsUtc('2026-05-02', LA);
      // Start of May 2 in LA = 2026-05-02T00:00:00-07:00 = 2026-05-02T07:00:00Z
      expect(from.toISOString()).toBe('2026-05-02T07:00:00.000Z');
      // End of May 2 in LA = 2026-05-02T23:59:59.999-07:00 = 2026-05-03T06:59:59.999Z
      expect(to.toISOString()).toBe('2026-05-03T06:59:59.999Z');
    });

    it('returns UTC bounds covering a full LA day during PST (UTC-8)', () => {
      const { from, to } = tzDayBoundsUtc('2026-01-15', LA);
      // PST is UTC-8 → start = 2026-01-15T08:00:00Z
      expect(from.toISOString()).toBe('2026-01-15T08:00:00.000Z');
      expect(to.toISOString()).toBe('2026-01-16T07:59:59.999Z');
    });
  });

  describe('getDateRangeFromPreset', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Pin to 2026-05-03 06:00 UTC = 2026-05-02 23:00 LA
      vi.setSystemTime(new Date('2026-05-03T06:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('"today" in LA covers May 2 (still May 2 in LA at this UTC moment)', () => {
      const { from, to } = getDateRangeFromPreset('today', LA);
      expect(from.toISOString()).toBe('2026-05-02T07:00:00.000Z');
      expect(to.toISOString()).toBe('2026-05-03T06:59:59.999Z');
    });

    it('"today" in Vietnam covers May 3', () => {
      const { from } = getDateRangeFromPreset('today', VN);
      // Vietnam is UTC+7 → start of May 3 VN = 2026-05-02T17:00:00Z
      expect(from.toISOString()).toBe('2026-05-02T17:00:00.000Z');
    });

    it('"yesterday" in LA covers May 1', () => {
      const { from, to } = getDateRangeFromPreset('yesterday', LA);
      expect(from.toISOString()).toBe('2026-05-01T07:00:00.000Z');
      expect(to.toISOString()).toBe('2026-05-02T06:59:59.999Z');
    });

    it('"7days" in LA spans April 26 → May 2 (7 inclusive days)', () => {
      const { from, to } = getDateRangeFromPreset('7days', LA);
      // start of April 26 LA = 2026-04-26T07:00:00Z
      expect(from.toISOString()).toBe('2026-04-26T07:00:00.000Z');
      expect(to.toISOString()).toBe('2026-05-03T06:59:59.999Z');
    });

    it('"30days" in LA spans April 3 → May 2 (30 days inclusive)', () => {
      const { from } = getDateRangeFromPreset('30days', LA);
      expect(from.toISOString()).toBe('2026-04-03T07:00:00.000Z');
    });

    it('uses LA by default when tz is omitted', () => {
      const { from } = getDateRangeFromPreset('today');
      expect(from.toISOString()).toBe('2026-05-02T07:00:00.000Z');
    });
  });

  describe('validateDateRange', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-03T06:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('clamps a future "to" to end-of-today in tz', () => {
      const future = new Date('2030-01-01T00:00:00Z');
      const past = new Date('2026-04-01T07:00:00Z');
      const { to } = validateDateRange(past, future, LA);
      // End of "today" in LA at the pinned clock is end of May 2
      expect(to.toISOString()).toBe('2026-05-03T06:59:59.999Z');
    });

    it('re-anchors arbitrary input times to local-day bounds', () => {
      // Mid-day timestamps inside LA day boundaries → snap to 00:00 / 23:59:59 LA
      const from = new Date('2026-04-01T15:32:11Z'); // = April 1 08:32 LA
      const to = new Date('2026-04-05T15:32:11Z');
      const r = validateDateRange(from, to, LA);
      expect(r.from.toISOString()).toBe('2026-04-01T07:00:00.000Z');
      expect(r.to.toISOString()).toBe('2026-04-06T06:59:59.999Z');
    });
  });

  describe('formatLADateRange', () => {
    it('renders LA dates regardless of input UTC instant', () => {
      const from = new Date('2026-05-02T07:00:00Z'); // May 2 LA
      const to = new Date('2026-05-03T06:59:59Z');   // still May 2 LA at end-of-day
      const out = formatLADateRange(from, to, LA);
      expect(out).toBe('May 02, 2026 - May 02, 2026');
    });

    it('renders different dates when tz shifts the day', () => {
      const from = new Date('2026-05-02T07:00:00Z'); // May 2 LA, May 2 14:00 VN
      const to = new Date('2026-05-03T03:00:00Z');   // May 2 20:00 LA, May 3 10:00 VN
      expect(formatLADateRange(from, to, VN)).toBe('May 02, 2026 - May 03, 2026');
    });
  });

  describe('formatInTz', () => {
    it('formats an ISO string in LA tz', () => {
      const ts = '2026-05-03T06:00:00Z'; // = May 2 23:00 LA
      expect(formatInTz(ts, LA, 'yyyy-MM-dd HH:mm')).toBe('2026-05-02 23:00');
    });
    it('handles fixed-offset zones', () => {
      const ts = '2026-05-03T06:00:00Z';
      expect(formatInTz(ts, 'Etc/GMT+6', 'yyyy-MM-dd HH:mm')).toBe('2026-05-03 00:00');
    });
  });

  describe('getShopifyDateRange', () => {
    it('serializes UTC instants for Shopify created_at_min/max', () => {
      const from = new Date('2026-05-02T07:00:00Z');
      const to = new Date('2026-05-03T06:59:59.999Z');
      const r = getShopifyDateRange(from, to);
      expect(r.min).toBe('2026-05-02T07:00:00.000Z');
      expect(r.max).toBe('2026-05-03T06:59:59.999Z');
    });
  });

  describe('getFacebookDateRange', () => {
    it('returns since/until as YYYY-MM-DD in LA', () => {
      const from = new Date('2026-05-02T07:00:00Z');
      const to = new Date('2026-05-03T06:59:59.999Z');
      const r = getFacebookDateRange(from, to, LA);
      expect(r.since).toBe('2026-05-02');
      expect(r.until).toBe('2026-05-02'); // still May 2 LA at 23:59
    });
  });
});
