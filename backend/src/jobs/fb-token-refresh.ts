/**
 * Daily refresh of per-user long-lived FB tokens.
 *
 * Why: a long-lived user token lasts ~60 days. If a merchant logs in and
 * connects FB once, we want their session to keep working without surprise
 * "reconnect" prompts months later. As long as someone's actively using the
 * app at least every ~50 days, this cron will silently extend their token
 * by re-running fb_exchange_token before the 60-day clock runs out.
 *
 * Scope: only touches UserFacebookConnection rows (per-user FB SDK login).
 * Adlux system-user tokens never expire and are handled by their own
 * scheduler.
 */

import * as fbToken from '../services/fb-user-token.service';

const DAY = 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_DAYS = parseInt(process.env.FB_TOKEN_REFRESH_WINDOW_DAYS || '14', 10);
// Run once at boot (giving the rest of the app time to settle), then every 24h.
const BOOT_DELAY_MS = 5 * 60 * 1000;       // 5 min after server start
const INTERVAL_MS = 24 * 60 * 60 * 1000;   // every 24h

let timer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;
let lastReport: { ranAt: string; checked: number; refreshed: number; failed: number; errors: string[] } | null = null;

export async function runOnce(): Promise<void> {
  const ranAt = new Date().toISOString();
  let checked = 0, refreshed = 0, failed = 0;
  const errors: string[] = [];

  try {
    const candidates = await fbToken.listExpiringSoon(REFRESH_WINDOW_DAYS);
    checked = candidates.length;
    for (const row of candidates) {
      try {
        // Scope by fbAppId: without it, extend() resolves the user's
        // DEFAULT app, so a user with several connections had the same
        // default row extended repeatedly while the others lapsed.
        const r = await fbToken.extend(row.userId, row.fbAppId);
        if (r) {
          refreshed++;
          console.log(`[fb-token-refresh] user=${row.userId} app=${row.fbAppId} extended → ${r.expiresAt?.toISOString() || 'no-expiry'}`);
        }
      } catch (e: any) {
        failed++;
        const msg = e?.message || String(e);
        errors.push(`${row.userId}/${row.fbAppId}: ${msg.slice(0, 200)}`);
        // Persist the error against the row so the user can see it in the
        // FB connect UI ("token expired — please reconnect").
        try { await fbToken.markError(row.userId, row.fbAppId, msg); } catch { /* ignore */ }
        console.warn(`[fb-token-refresh] user=${row.userId} app=${row.fbAppId} failed: ${msg.slice(0, 200)}`);
      }
    }
  } catch (e: any) {
    console.error('[fb-token-refresh] fatal scan error:', e?.message || e);
    errors.push(`scan: ${e?.message || String(e)}`);
  }

  lastReport = { ranAt, checked, refreshed, failed, errors };
  console.log(`[fb-token-refresh] cycle complete — checked ${checked}, refreshed ${refreshed}, failed ${failed}`);
}

export function startFbTokenRefreshScheduler(): void {
  if (timer || bootTimer) return; // already running
  if (process.env.FB_TOKEN_REFRESH_DISABLED === '1') {
    console.log('[fb-token-refresh] disabled via env');
    return;
  }
  console.log(`[fb-token-refresh] scheduler starting — window=${REFRESH_WINDOW_DAYS}d, interval=${INTERVAL_MS / DAY}d`);
  bootTimer = setTimeout(() => { runOnce(); bootTimer = null; }, BOOT_DELAY_MS);
  timer = setInterval(runOnce, INTERVAL_MS);
}

export function stopFbTokenRefreshScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
}

export function getStatus() {
  return {
    enabled: process.env.FB_TOKEN_REFRESH_DISABLED !== '1',
    windowDays: REFRESH_WINDOW_DAYS,
    intervalDays: INTERVAL_MS / DAY,
    lastReport
  };
}
