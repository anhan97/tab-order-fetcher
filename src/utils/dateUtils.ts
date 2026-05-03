import { format } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

// Standardized date presets for the entire app
export type DatePreset = 'today' | 'yesterday' | '7days' | '30days' | '90days' | 'custom';

// Default timezone is the merchant's Shopify store timezone (Caryona is in
// America/Los_Angeles). Honor DST automatically — never hardcode an offset.
export const DEFAULT_TZ = 'America/Los_Angeles';

/**
 * Returns the YYYY-MM-DD calendar date "today" looks like in the given
 * timezone — independent of the browser's locale. Source of truth for any
 * "today / yesterday / N days ago" arithmetic in this app.
 */
export function todayInTz(tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

/**
 * Add N days to a YYYY-MM-DD calendar date and return the resulting date
 * string. Works at the calendar-date level so it's DST-safe — we never cross
 * UTC boundaries here.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * For a calendar date in `tz`, return the inclusive UTC bounds [from, to]
 * that cover that whole local day. Used wherever we hand a date to an API
 * that wants UTC instants (Shopify, Facebook, our own DB queries).
 */
export function tzDayBoundsUtc(dateStr: string, tz: string = DEFAULT_TZ): { from: Date; to: Date } {
  const from = fromZonedTime(`${dateStr}T00:00:00`, tz);
  const to = fromZonedTime(`${dateStr}T23:59:59.999`, tz);
  return { from, to };
}

/**
 * Get standardized date range from preset, computed in the user's tz.
 * Returns UTC `Date` objects whose ISO timestamps mark the local-day bounds.
 */
export function getDateRangeFromPreset(preset: DatePreset, tz: string = DEFAULT_TZ): { from: Date; to: Date } {
  const today = todayInTz(tz);

  switch (preset) {
    case 'today':
      return tzDayBoundsUtc(today, tz);
    case 'yesterday': {
      const y = addDaysToDateString(today, -1);
      return tzDayBoundsUtc(y, tz);
    }
    case '7days': {
      const start = addDaysToDateString(today, -6);
      return {
        from: fromZonedTime(`${start}T00:00:00`, tz),
        to: fromZonedTime(`${today}T23:59:59.999`, tz)
      };
    }
    case '30days': {
      const start = addDaysToDateString(today, -29);
      return {
        from: fromZonedTime(`${start}T00:00:00`, tz),
        to: fromZonedTime(`${today}T23:59:59.999`, tz)
      };
    }
    case '90days': {
      const start = addDaysToDateString(today, -89);
      return {
        from: fromZonedTime(`${start}T00:00:00`, tz),
        to: fromZonedTime(`${today}T23:59:59.999`, tz)
      };
    }
    case 'custom':
    default: {
      const start = addDaysToDateString(today, -29);
      return {
        from: fromZonedTime(`${start}T00:00:00`, tz),
        to: fromZonedTime(`${today}T23:59:59.999`, tz)
      };
    }
  }
}

// Format date range for display (browser local — only used in non-tz contexts)
export function formatDateRange(from: Date, to: Date): string {
  return `${format(from, "LLL dd, yyyy")} - ${format(to, "LLL dd, yyyy")}`;
}

/**
 * Format a date range for display in the user's tz. Replaces the old
 * `formatLADateRange` — the name is kept for back-compat but the body now
 * honors any IANA timezone.
 */
export function formatLADateRange(from: Date, to: Date, tz: string = DEFAULT_TZ): string {
  return `${formatInTimeZone(from, tz, 'LLL dd, yyyy')} - ${formatInTimeZone(to, tz, 'LLL dd, yyyy')}`;
}

/** Format a single timestamp in the given timezone. */
export function formatInTz(date: Date | string, tz: string = DEFAULT_TZ, fmt: string = 'yyyy-MM-dd HH:mm'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(d, tz, fmt);
}

/**
 * Clamp a `to` boundary so it doesn't extend past the end of "today" in tz,
 * and ensure `from <= to`. Returns UTC Dates anchored to local-day bounds.
 */
export function validateDateRange(from: Date, to: Date, tz: string = DEFAULT_TZ): { from: Date; to: Date } {
  const todayStr = todayInTz(tz);
  const eod = fromZonedTime(`${todayStr}T23:59:59.999`, tz);

  // Clamp future "to"
  const clampedTo = to > eod ? eod : to;

  // Compute the calendar-date string for from / to in tz, then re-anchor to
  // local-day boundaries so we always pass clean day windows downstream.
  const fromDateStr = formatInTimeZone(from, tz, 'yyyy-MM-dd');
  const toDateStr = formatInTimeZone(clampedTo, tz, 'yyyy-MM-dd');

  // Guard: if from > to (after clamp), collapse from to start of to-day.
  const finalFromStr = fromDateStr > toDateStr ? toDateStr : fromDateStr;

  return {
    from: fromZonedTime(`${finalFromStr}T00:00:00`, tz),
    to: fromZonedTime(`${toDateStr}T23:59:59.999`, tz)
  };
}

// Get date preset options for UI
export function getDatePresetOptions(): { value: DatePreset; label: string }[] {
  return [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: '7days', label: 'Last 7 days' },
    { value: '30days', label: 'Last 30 days' },
    { value: '90days', label: 'Last 90 days' },
    { value: 'custom', label: 'Custom range' }
  ];
}

/**
 * Convert a date range to Shopify's `created_at_min` / `created_at_max`
 * format. The dates are expected to already be UTC instants (returned by
 * `getDateRangeFromPreset` / `validateDateRange`); this just serialises them.
 */
export function getShopifyDateRange(from: Date, to: Date): { min: string; max: string } {
  return {
    min: from.toISOString(),
    max: to.toISOString()
  };
}

/** Convert a date range to Facebook Marketing API's `since`/`until` format. */
export function getFacebookDateRange(from: Date, to: Date, tz: string = DEFAULT_TZ): { since: string; until: string } {
  return {
    since: formatInTimeZone(from, tz, 'yyyy-MM-dd'),
    until: formatInTimeZone(to, tz, 'yyyy-MM-dd')
  };
}

// --- Legacy helpers retained for back-compat. They now route through
// proper tz-aware logic instead of the buggy hardcoded -8h shift. ---

/** @deprecated prefer `todayInTz()` + `tzDayBoundsUtc()` directly. */
export function getLACurrentTime(tz: string = DEFAULT_TZ): Date {
  // Returns the wall-clock representation of "now in tz" as a Date object.
  // Don't use the result for arithmetic — it's only useful for display.
  return toZonedTime(new Date(), tz);
}

/** @deprecated prefer `formatInTz()` directly. */
export function toLATime(date: Date, tz: string = DEFAULT_TZ): Date {
  return toZonedTime(date, tz);
}

/** @deprecated this function was conceptually broken — kept as an identity. */
export function fromLATime(date: Date, _tz: string = DEFAULT_TZ): Date {
  return date;
}
