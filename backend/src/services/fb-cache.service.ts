/**
 * Tiered TTL in-memory cache for Facebook Marketing API responses.
 *
 * Cache tiers (from research — Meta refreshes attribution every ~15min, so
 * polling faster is wasted; data older than 28d is immutable):
 *   - today           → 5 min
 *   - yesterday       → 1 hour
 *   - 2-28 days back  → 6 hours
 *   - >28 days        → 24 hours (effectively immutable)
 *   - structural      → 6 hours (campaign/adset metadata rarely changes)
 *
 * Singleton process-wide. Different users hitting the SAME ad account share
 * one cached payload — that's the whole point for our multi-tenant dev tier.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<any>>();

// Cap to prevent unbounded growth in long-running dev server.
const MAX_ENTRIES = 1000;

function evictIfFull() {
  if (store.size < MAX_ENTRIES) return;
  // Evict oldest by expiry — cheap O(n) scan, fine at this size.
  let oldestKey: string | null = null;
  let oldestExp = Infinity;
  for (const [k, v] of store) {
    if (v.expiresAt < oldestExp) {
      oldestExp = v.expiresAt;
      oldestKey = k;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function set<T>(key: string, value: T, ttlMs: number): void {
  evictIfFull();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidate(prefix: string): number {
  let count = 0;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      count++;
    }
  }
  return count;
}

/**
 * Pick the right TTL given the date range being requested.
 * `until` is the most recent date in the range — that's what determines freshness.
 */
export function ttlForRange(until: Date): number {
  const now = Date.now();
  const ageMs = now - until.getTime();
  const ONE_DAY = 86_400_000;

  if (ageMs < ONE_DAY) return 5 * 60_000;          // today / future end → 5 min
  if (ageMs < 2 * ONE_DAY) return 60 * 60_000;     // yesterday          → 1 h
  if (ageMs < 28 * ONE_DAY) return 6 * 60 * 60_000; // last 28 days       → 6 h
  return 24 * 60 * 60_000;                          // older              → 24 h
}

export const STRUCTURE_TTL = 6 * 60 * 60_000; // 6h for campaign/adset metadata

export function stats(): { size: number; entries: Array<{ key: string; expiresInMs: number }> } {
  const now = Date.now();
  return {
    size: store.size,
    entries: Array.from(store.entries()).map(([k, v]) => ({
      key: k,
      expiresInMs: v.expiresAt - now
    }))
  };
}
