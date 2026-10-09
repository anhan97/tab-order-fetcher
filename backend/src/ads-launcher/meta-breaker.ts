/**
 * Circuit breaker per Facebook token (≈ per user × Meta app).
 *
 * When Meta says the token is dead, the app is blocked or we are rate
 * limited, every further call only digs the hole deeper (Meta extends blocks
 * for apps that keep hammering). So we stop calling for a while and answer
 * 502 "try again in a few minutes" instead (§8.1, §17).
 *
 * In-memory: the backend runs as a single process (ecosystem.config.js).
 */
import { createHash } from 'crypto';

interface OpenState {
  until: number;
  reason: string;
}

const open = new Map<string, OpenState>();

export const breakerKey = (token: string) => createHash('sha1').update(token).digest('hex').slice(0, 16);

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

/** Rate limits are counted per ad account / business, not per token. */
export const isRateLimit = (code: number | undefined) => code !== undefined && RATE_LIMIT_CODES.has(code);

/** How long to stay open for a Graph error code, or 0 = not a breaker error. */
export function tripDurationMs(code: number | undefined, subcode?: number): number {
  if (code === undefined) return 0;
  if (code === 190 || code === 102) return 10 * 60_000; // token expired / invalid session
  if (code === 368) return 30 * 60_000; // temporarily blocked for policy
  if (code === 200 && subcode === 1815694) return 30 * 60_000; // app restricted
  if (RATE_LIMIT_CODES.has(code)) return 5 * 60_000;
  return 0;
}

export function check(key: string): OpenState | null {
  const s = open.get(key);
  if (!s) return null;
  if (s.until <= Date.now()) {
    open.delete(key);
    return null;
  }
  return s;
}

export function trip(key: string, reason: string, ms: number): void {
  const prev = open.get(key);
  const until = Date.now() + ms;
  if (!prev || prev.until < until) open.set(key, { until, reason });
}

export function reset(key?: string): void {
  if (key) open.delete(key);
  else open.clear();
}
