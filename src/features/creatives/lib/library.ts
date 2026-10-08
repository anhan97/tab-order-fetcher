/**
 * Pure helpers for the creative library and the Posts tab: ordered
 * selection, one-product rule, creative renaming, number formatting.
 */
import { creativeName } from '@contract/ads-launcher';

// ─── Ordered selection ──────────────────────────────────────────────────────

/** Add the item at the end, or remove it — the rest keep their order. */
export function toggleInOrder<T>(list: readonly T[], item: T, key: (t: T) => string): T[] {
  const k = key(item);
  return list.some(x => key(x) === k) ? list.filter(x => key(x) !== k) : [...list, item];
}

/** Append every item not selected yet, in the order shown. */
export function addAllInOrder<T>(list: readonly T[], items: readonly T[], key: (t: T) => string): T[] {
  const have = new Set(list.map(key));
  const out = [...list];
  for (const it of items) {
    const k = key(it);
    if (!have.has(k)) {
      have.add(k);
      out.push(it);
    }
  }
  return out;
}

/** 1-based position in the selection, 0 when not selected. */
export function selectionOrder<T>(list: readonly T[], id: string, key: (t: T) => string): number {
  return list.findIndex(x => key(x) === id) + 1;
}

/** Replace selected entries with fresher copies (after an edit/refetch), keeping order. */
export function refreshSelection<T>(list: readonly T[], fresh: readonly T[] | undefined, key: (t: T) => string): T[] {
  if (!fresh?.length) return [...list];
  const byId = new Map(fresh.map(f => [key(f), f]));
  return list.map(x => byId.get(key(x)) ?? x);
}

/** Distinct product ids in first-seen order (null/empty ignored). */
export function distinctProducts(ids: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) if (id && !out.includes(id)) out.push(id);
  return out;
}

// ─── Names ──────────────────────────────────────────────────────────────────

export const normalizeAngle = (angle: string) => angle.replace(/\|/g, '/');

/**
 * Preview of a creative's name after its angle changes. The server keeps the
 * creator, code and created date, so swap only the angle part of
 * `<creator> | <angle> | <code> - <dd/MM/yyyy>`; names that do not have that
 * shape are rebuilt from the creative's fields.
 */
export function renameWithAngle(
  current: string,
  angle: string,
  fallback: { creator: string; code: string; createdAt: string | Date }
): string {
  const clean = normalizeAngle(angle).replace(/\s+/g, ' ').trim();
  const parts = current.split(' | ');
  if (parts.length === 3) return [parts[0], clean, parts[2]].join(' | ').slice(0, 500);
  return creativeName(fallback.creator, clean, fallback.code, new Date(fallback.createdAt));
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** "$1,234.50" with a currency, "1,234.50" without one, "—" for null. */
export function formatMoney(value: string | number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    }
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatRoas(roas: number | null | undefined): string {
  return roas === null || roas === undefined || !Number.isFinite(roas) ? '—' : roas.toFixed(2);
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US');
}

/** Readable message from anything thrown. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Network error — check your connection and retry.';
  return msg || 'Something went wrong.';
}
