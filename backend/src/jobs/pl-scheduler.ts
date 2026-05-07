import { PrismaClient } from '@prisma/client';
import { recomputeRange, finalizeYesterday, parseTzOffsetMinutes, localCalendarDateUTC } from '../services/daily-pl.service';
import { syncOrders, syncBalanceTransactions } from '../services/order-sync.service';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Re-sync orders + recompute P&L every 30 minutes by default. Override via env.
const INTERVAL_MS = (() => {
  const m = parseInt(process.env.PL_SCHEDULER_INTERVAL_MIN || '30', 10);
  return Math.max(5, m) * 60 * 1000;
})();
const ROLLING_WINDOW_DAYS = parseInt(process.env.PL_ROLLING_WINDOW_DAYS || '7', 10);
// EOD finalize fires when local store time is within this many minutes after
// midnight. The 30min sync cycle naturally catches each store within its
// window; storing isFinalized prevents double-firing.
const EOD_FINALIZE_WINDOW_MIN = 90;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Returns true if `now` is within EOD_FINALIZE_WINDOW_MIN minutes after local
 * midnight in the given tz (offset in "minutes behind UTC", e.g. GMT-6 = 360).
 * The intent: cover the previous day after it ends, with a wide enough window
 * that the 30min cron always catches it once.
 */
function isInEodWindow(now: Date, tzOffsetMinutes: number): boolean {
  const local = new Date(now.getTime() - tzOffsetMinutes * 60_000);
  const minutesIntoDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutesIntoDay < EOD_FINALIZE_WINDOW_MIN;
}

export async function runOnce(): Promise<void> {
  if (running) {
    console.log('[PL-Scheduler] previous run still in flight, skipping');
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const stores = await prisma.shopifyStore.findMany({
      where: { isActive: true },
      select: { id: true, userId: true, storeDomain: true }
    });

    const tz = parseTzOffsetMinutes(process.env.PL_DEFAULT_TZ || 'Etc/GMT+6');
    for (const s of stores) {
      const to = new Date();
      const from = new Date(to.getTime() - ROLLING_WINDOW_DAYS * DAY);
      try {
        await syncOrders(s.id, { since: from, until: to, pullTransactions: true });
      } catch (e: any) {
        const msg = e?.message || String(e);
        // Auto-deactivate stores that no longer exist on Shopify (404 / "Not Found").
        // The token may have been revoked or the test domain was removed. Either
        // way, retrying every 30min just spams logs and burns nothing useful.
        if (/Not Found|404/i.test(msg)) {
          await prisma.shopifyStore.update({
            where: { id: s.id },
            data: { isActive: false }
          });
          console.warn(`[PL-Scheduler] store ${s.storeDomain} returned 404 — marked isActive=false. Re-enable manually if intentional.`);
        } else {
          console.error(`[PL-Scheduler] sync failed for store ${s.storeDomain}:`, msg);
        }
        continue;
      }
      try {
        await syncBalanceTransactions(s.id, from, to);
      } catch (e: any) {
        console.error(`[PL-Scheduler] balance sync failed for store ${s.storeDomain}:`, e?.message || e);
      }
      try {
        // Convert "now" instants into local-calendar markers so recomputeRange
        // iterates the correct local days (e.g. don't recompute "tomorrow" when
        // it's already May 1 UTC but still April 30 local).
        const fromCal = localCalendarDateUTC(from, tz);
        const toCal = localCalendarDateUTC(to, tz);
        await recomputeRange(s.userId, s.id, fromCal, toCal, tz);
      } catch (e: any) {
        console.error(`[PL-Scheduler] recompute failed for store ${s.storeDomain}:`, e?.message || e);
      }
      // EOD finalize: if it's within 90min of local midnight, finalize the
      // previous local day (computeAndSaveForDate with isFinalized=true).
      // Idempotent — re-firing during the same window just re-stamps the row.
      if (isInEodWindow(new Date(), tz)) {
        try {
          await finalizeYesterday(s.userId, s.id, tz);
          console.log(`[PL-Scheduler] EOD finalize done for ${s.storeDomain}`);
        } catch (e: any) {
          console.error(`[PL-Scheduler] EOD finalize failed for ${s.storeDomain}:`, e?.message || e);
        }
      }
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[PL-Scheduler] cycle complete in ${elapsed}s for ${stores.length} stores`);
  } catch (e: any) {
    console.error('[PL-Scheduler] fatal error:', e?.message || e);
  } finally {
    running = false;
  }
}

export function startPLScheduler(): void {
  if (timer) return;
  console.log(`[PL-Scheduler] starting, interval=${INTERVAL_MS / 60000}min, window=${ROLLING_WINDOW_DAYS}d`);
  // Run once shortly after boot, then on interval
  setTimeout(() => { runOnce(); }, 30 * 1000);
  timer = setInterval(() => { runOnce(); }, INTERVAL_MS);
}

export function stopPLScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
