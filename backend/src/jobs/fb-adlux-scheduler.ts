/**
 * Cron-style schedulers for the Adlux multi-tenant FB pipeline.
 *
 * Two jobs run on different cadences:
 *
 *   1. BM sync — every 60s. Polls Adlux BM /client_ad_accounts to detect
 *      newly-shared accounts and auto-assign them to system-user pool slots.
 *      60s cadence so a user clicking "share" sees their accounts appear
 *      in the dashboard within ~1 minute.
 *
 *   2. End-of-day snapshot — once daily at 00:15 UTC. Pulls yesterday's
 *      level=ad insights for every assigned account, persists to the
 *      FacebookAdInsightSnapshot table. Frozen historical record.
 *
 * Disabled by default unless FB_ADLUX_BM_ID is set. Lets the existing app
 * keep running before BM is configured.
 */

import { syncAndPersist } from '../services/fb-adlux-orchestrator.service';
import { snapshotAllAccounts } from '../services/fb-snapshot.service';
import * as pool from '../services/fb-system-token.service';
import { getConfig } from '../services/adlux-config.service';

const SYNC_INTERVAL_MS = 60_000;       // 1 minute
const SNAPSHOT_HOUR_UTC = 0;           // 00:00 UTC
const SNAPSHOT_MINUTE = 15;            // 00:15 — give FB time to settle yesterday's data

let syncTimer: NodeJS.Timeout | null = null;
let snapshotTimer: NodeJS.Timeout | null = null;
let syncInProgress = false;
let lastSyncReport: any = null;
let lastSnapshotReport: any = null;

// Resolves BM id from DB (preferred) or env (legacy fallback). Async because
// DB lookup is async; the scheduler is fine with that since it runs on a
// timer, not a hot path.
async function adluxBmId(): Promise<string | null> {
  const cfg = await getConfig();
  return cfg.adluxBmId;
}

async function runBmSync() {
  if (syncInProgress) return;            // skip if previous still running
  const bmId = await adluxBmId();
  if (!bmId) return;                     // nothing to do until configured
  await pool.ensureLoaded();
  if (!pool.isPoolConfigured()) return;  // can't run without tokens

  syncInProgress = true;
  try {
    lastSyncReport = await syncAndPersist(bmId);
    if (lastSyncReport.failed > 0) {
      console.warn(`[adlux-bm-sync] ${lastSyncReport.failed} assignment failures:`, lastSyncReport.errors.slice(0, 3));
    }
  } catch (err: any) {
    console.error('[adlux-bm-sync] error:', err.message);
    lastSyncReport = { error: err.message, at: new Date().toISOString() };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Compute ms until next SNAPSHOT_HOUR_UTC:SNAPSHOT_MINUTE in UTC, accounting
 * for clock drift. Always returns a positive value.
 */
function msUntilNextSnapshotRun(): number {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    SNAPSHOT_HOUR_UTC,
    SNAPSHOT_MINUTE,
    0, 0
  ));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runSnapshot() {
  const bmId = await adluxBmId();
  await pool.ensureLoaded();
  if (!bmId || !pool.isPoolConfigured()) {
    scheduleNextSnapshot();
    return;
  }

  // Snapshot YESTERDAY's data — today is still mutable.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  console.log(`[adlux-snapshot] starting for ${yesterday.toISOString().slice(0, 10)}`);
  try {
    lastSnapshotReport = await snapshotAllAccounts(yesterday);
    console.log(`[adlux-snapshot] done: ${lastSnapshotReport.accountsDone}/${lastSnapshotReport.totalAccounts} accounts, ${lastSnapshotReport.totalRows} rows`);
  } catch (err: any) {
    console.error('[adlux-snapshot] error:', err.message);
    lastSnapshotReport = { error: err.message, at: new Date().toISOString() };
  }

  scheduleNextSnapshot();
}

function scheduleNextSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(runSnapshot, msUntilNextSnapshotRun());
}

export function startAdluxScheduler(): void {
  if (process.env.FB_ADLUX_SCHEDULER_DISABLED === '1') {
    console.log('[adlux] scheduler disabled via env');
    return;
  }

  console.log('[adlux] scheduler starting (will idle until BM id + tokens configured via Settings UI)');

  // BM sync runs every minute starting now (with a 5s grace so app boot
  // finishes). The first call resolves config from DB, and re-checks every
  // minute — so adding config via UI activates the scheduler within 60s
  // without a server restart.
  setTimeout(runBmSync, 5_000);
  syncTimer = setInterval(runBmSync, SYNC_INTERVAL_MS);

  // Snapshot scheduled for next 00:15 UTC. The check inside runSnapshot
  // re-validates config before doing real work.
  scheduleNextSnapshot();
}

export function stopAdluxScheduler(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
}

export async function getSchedulerStatus() {
  return {
    bmId: await adluxBmId(),
    poolSize: pool.poolSize(),
    syncIntervalSec: SYNC_INTERVAL_MS / 1000,
    syncInProgress,
    lastSyncReport,
    lastSnapshotReport,
    nextSnapshotInMs: snapshotTimer ? msUntilNextSnapshotRun() : null
  };
}
