/**
 * FB metrics sync scheduler.
 *
 * Every 5 min: for every user with at least one CampaignStoreMapping row,
 * pull fresh insights for today + a rolling 14-day window and upsert into
 * FbCampaignDailyMetric. Dashboard and P&L read from that table — they
 * never call FB directly anymore — so this is the *only* loop responsible
 * for keeping the numbers fresh.
 *
 * Why 5 min: matches the "today" tier of the underlying FB cache. Anything
 * faster wastes API quota; slower lets users see stale numbers.
 *
 * Why a separate scheduler from pl-scheduler: pl-scheduler runs every
 * 30 min and does heavy work (Shopify order sync, daily P&L recompute).
 * Coupling this to it would either (a) starve FB syncs to 30 min, or
 * (b) run heavy Shopify pulls every 5 min. Splitting them keeps each
 * cycle short and tunable.
 *
 * After each user is synced we invalidate every store's today P&L cache
 * so the next /api/pl/today call re-aggregates with the fresh ad spend
 * instead of returning cached numbers from before the sync.
 */
import { PrismaClient } from '@prisma/client';
import { syncTodayForUser, syncCampaignMetricsForUser, DEFAULT_SYNC_DAYS_BACK } from '../services/fb-metrics-store.service';
import { invalidateTodayCache } from '../services/daily-pl.service';

const prisma = new PrismaClient();

const INTERVAL_MS = (() => {
  const m = parseInt(process.env.FB_METRICS_INTERVAL_MIN || '5', 10);
  return Math.max(1, m) * 60 * 1000;
})();

/**
 * Heavier rolling-window sync runs less often. Today is refreshed every
 * cycle; the rest of the window is refreshed every Nth cycle so we still
 * pick up FB's late attribution updates without burning quota on
 * already-stable past days every 5 min.
 */
const ROLLING_EVERY_N_CYCLES = parseInt(process.env.FB_METRICS_ROLLING_EVERY || '6', 10); // 6 × 5min = 30min
const ROLLING_DAYS_BACK = parseInt(process.env.FB_METRICS_ROLLING_DAYS || String(DEFAULT_SYNC_DAYS_BACK), 10);

let timer: NodeJS.Timeout | null = null;
let running = false;
let cycleCount = 0;

async function invalidateTodayForUser(userId: string): Promise<void> {
  const stores = await prisma.shopifyStore.findMany({
    where: { userId, isActive: true },
    select: { id: true }
  });
  for (const s of stores) invalidateTodayCache(userId, s.id);
}

export async function runOnce(): Promise<void> {
  if (running) {
    console.log('[FB-Metrics-Scheduler] previous run still in flight, skipping');
    return;
  }
  running = true;
  cycleCount++;
  const startedAt = Date.now();
  try {
    const users = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT DISTINCT "userId" FROM "CampaignStoreMapping"
    `;
    if (users.length === 0) {
      // Quiet: most installs start with zero mappings. Don't spam logs.
      return;
    }

    const doRolling = cycleCount % ROLLING_EVERY_N_CYCLES === 1;
    let totalWritten = 0;
    let totalErrors = 0;
    for (const u of users) {
      try {
        const r = doRolling
          ? await syncCampaignMetricsForUser(u.userId, ROLLING_DAYS_BACK)
          : await syncTodayForUser(u.userId);
        totalWritten += r.written;
        totalErrors += r.errors;
        await invalidateTodayForUser(u.userId);
      } catch (e: any) {
        console.error(`[FB-Metrics-Scheduler] sync failed for user ${u.userId}:`, e?.message || e);
        totalErrors++;
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[FB-Metrics-Scheduler] cycle=${cycleCount} mode=${doRolling ? 'rolling' : 'today-only'} ` +
      `users=${users.length} wrote=${totalWritten} errors=${totalErrors} elapsed=${elapsed}s`
    );
  } catch (e: any) {
    console.error('[FB-Metrics-Scheduler] fatal error:', e?.message || e);
  } finally {
    running = false;
  }
}

export function startFbMetricsScheduler(): void {
  if (timer) return;
  console.log(
    `[FB-Metrics-Scheduler] starting, interval=${INTERVAL_MS / 60000}min, ` +
    `rolling-every=${ROLLING_EVERY_N_CYCLES} cycles, rolling-days=${ROLLING_DAYS_BACK}`
  );
  // Kick off shortly after boot so the first dashboard load already has data.
  setTimeout(() => { runOnce(); }, 15 * 1000);
  timer = setInterval(() => { runOnce(); }, INTERVAL_MS);
}

export function stopFbMetricsScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
