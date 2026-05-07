/**
 * Tracks Facebook Marketing API rate-limit usage per (app, ad-account, business-use-case).
 *
 * Reads `X-Business-Use-Case-Usage` header after every Graph call, stores the
 * highest of (call_count, total_cputime, total_time) — Meta throttles when ANY
 * one of those hits 100. Surfaces a "should I back off / how long" decision.
 *
 * In-memory only — fine for single-process Express dev. Swap to Redis when
 * we run multiple workers.
 */

export interface BucUsage {
  type: string;
  call_count: number;
  total_cputime: number;
  total_time: number;
  estimated_time_to_regain_access: number;
  ads_api_access_tier?: string;
}

interface AccountState {
  usage: number;            // max of three counters, 0-100
  estimatedRegainAt: number; // epoch ms, 0 if not throttled
  lastUpdate: number;
  tier: string;
}

const state = new Map<string, AccountState>();

/**
 * Parse the X-Business-Use-Case-Usage header and update per-account state.
 * Header shape: { "<account_id>": [ { type, call_count, total_cputime, ... } ] }
 */
export function recordUsageFromHeaders(accountId: string, headers: Record<string, string | string[] | undefined>) {
  const raw = headers['x-business-use-case-usage'] || headers['X-Business-Use-Case-Usage'];
  if (!raw) return;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return;

  let parsed: Record<string, BucUsage[]>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }

  // FB may key by account_id with or without "act_" prefix; normalize lookups.
  const candidates = [accountId, `act_${accountId}`, accountId.replace(/^act_/, '')];
  let bucket: BucUsage[] | undefined;
  for (const k of candidates) {
    if (parsed[k]) { bucket = parsed[k]; break; }
  }
  if (!bucket || bucket.length === 0) {
    // Sometimes the only key is the app id or business id; ignore but record we saw a header.
    return;
  }

  // Pick the most-loaded use case (insights, management) — they're independent
  // but we conservatively gate the account on whichever is hottest.
  const hottest = bucket.reduce((a, b) => {
    const aMax = Math.max(a.call_count, a.total_cputime, a.total_time);
    const bMax = Math.max(b.call_count, b.total_cputime, b.total_time);
    return bMax > aMax ? b : a;
  });

  const max = Math.max(hottest.call_count, hottest.total_cputime, hottest.total_time);
  const regainAt = hottest.estimated_time_to_regain_access > 0
    ? Date.now() + hottest.estimated_time_to_regain_access * 60_000  // FB returns minutes
    : 0;

  state.set(accountId, {
    usage: max,
    estimatedRegainAt: regainAt,
    lastUpdate: Date.now(),
    tier: hottest.ads_api_access_tier || 'unknown'
  });
}

/**
 * Returns ms to wait before the next call, or 0 if safe to proceed immediately.
 * Adaptive based on usage:
 *   <60%  → no wait
 *   60-80 → 1s
 *   80-95 → 5s
 *   ≥95   → wait until estimatedRegainAt (or 5min default)
 */
export function shouldBackoff(accountId: string): number {
  const s = state.get(accountId);
  if (!s) return 0;

  // Hard throttle: respect FB's stated regain time.
  if (s.estimatedRegainAt > Date.now()) {
    return s.estimatedRegainAt - Date.now();
  }

  if (s.usage >= 95) return 300_000;
  if (s.usage >= 80) return 5_000;
  if (s.usage >= 60) return 1_000;
  return 0;
}

export function getAccountUsage(accountId: string): AccountState | null {
  return state.get(accountId) || null;
}

export function getAllUsage(): Record<string, AccountState> {
  return Object.fromEntries(state);
}
