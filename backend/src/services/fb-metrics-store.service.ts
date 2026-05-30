/**
 * Persisted, per-campaign-per-day FB metrics — the single source of truth
 * Dashboard + P&L + Daily breakdown read from.
 *
 * Why: previously every read called the FB live cache directly, so any
 * cache miss / FB hiccup / rate-limit surfaced as $0 to the user. Now FB
 * is called by a writer (5min scheduler + on-demand on mapping save) that
 * upserts rows into FbCampaignDailyMetric. Reads are pure SQL, so the
 * dashboard never blocks on FB and never sees $0 because of a transient
 * upstream failure.
 *
 * Coverage:
 *   - One row per (userId, accountId, campaignId, date)
 *   - Today is rewritten every 5 min (mutable until EOD)
 *   - Past days are also rewritten on each cycle for the rolling window so
 *     FB's late-attribution updates flow in
 *   - Old rows persist forever; only the rolling window gets refreshed
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { getAccountData } from './fb-account-data.service';
import * as pool from './fb-system-token.service';
import * as userToken from './fb-user-token.service';

const prisma = new PrismaClient();

/** Default rolling window the scheduler keeps fresh. Today + 13 prior days. */
export const DEFAULT_SYNC_DAYS_BACK = 14;

export interface CampaignDayUpsert {
  userId: string;
  accountId: string;
  campaignId: string;
  campaignName: string | null;
  date: Date;            // UTC midnight of the day represented
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  uniqueClicks: number;
  reach: number;
  purchases: number;
  purchaseValue: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  roas: number | null;
  currency?: string;
}

/** UTC midnight of a date, regardless of input time. */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Pick the token to send to FB for this user.
 *
 * ALWAYS prefer the user's own long-lived FB Login token when one exists.
 * The Adlux pool is a fallback only for legacy assignments where the user
 * doesn't have their own connection — never the primary.
 *
 * Why: the system rolled back to "single FB Login flow" — each user owns
 * the ad account through their personal FB token. Pool tokens belong to
 * the Adlux BM, so querying a USER's ad account with a POOL token throws
 * code 190 / subcode 465 ("application does not belong to system user's
 * business"). That's exactly the error you'll see in logs if this is wrong.
 */
async function pickFallbackToken(userId: string): Promise<string> {
  const t = await userToken.getRawToken(userId);
  if (t) return t;
  // No user connection — let resolveToken in fb-account-data fall through
  // to the pool (returns '' here so the downstream code picks pool path).
  return '';
}

/**
 * Fetch a single (account, day) from FB via the existing live cache and
 * upsert each campaign into FbCampaignDailyMetric. Returns the number of
 * rows written.
 *
 * On FB error we log and return 0 so the caller can keep iterating other
 * accounts/days — partial syncs are fine because each row is independent.
 */
export async function syncAccountDay(
  userId: string,
  accountId: string,
  date: Date
): Promise<{ written: number; campaigns: number; error?: string }> {
  const day = utcMidnight(date);
  const dayStart = new Date(day);
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);
  const dateKey = day.toISOString().slice(0, 10);

  const fallbackToken = await pickFallbackToken(userId);
  let data;
  try {
    data = await getAccountData(accountId, fallbackToken, dayStart, dayEnd);
  } catch (err: any) {
    const msg = (err?.message || String(err)).slice(0, 200);
    console.warn(
      `[fb-metrics-sync] FB call failed user=${userId} acct=${accountId} day=${dateKey} ` +
      `code=${err?.fbCode} subcode=${err?.fbSubcode} msg=${msg}`
    );
    return { written: 0, campaigns: 0, error: msg };
  }

  const campaigns = data.campaigns || [];
  if (campaigns.length === 0) {
    return { written: 0, campaigns: 0 };
  }

  // Upsert in a single transaction so a partial failure doesn't leave the
  // store with mixed-version rows for the same day.
  let written = 0;
  await prisma.$transaction(async (tx) => {
    for (const c of campaigns) {
      const spend = c.spend || 0;
      const impressions = c.impressions || 0;
      const clicks = c.clicks || 0;
      const linkClicks = (c as any).link_clicks || 0;
      const uniqueClicks = c.unique_clicks || 0;
      const reach = c.reach || 0;
      const purchases = c.purchase || 0;
      const purchaseValue = c.purchase_value || 0;
      const ctr = c.ctr ?? null;
      const cpc = c.cpc ?? null;
      const cpm = c.cpm ?? null;
      const roas = c.roas ?? null;

      // Generate UUID in Node, not PG: gen_random_uuid() needs pgcrypto
      // extension (or PG 13+ built-in). On older / freshly-provisioned
      // databases it errors 42883. Node's crypto.randomUUID is universal.
      const rowId = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO "FbCampaignDailyMetric" (
          "id", "userId", "accountId", "campaignId", "campaignName", "date",
          "spend", "impressions", "clicks", "linkClicks", "uniqueClicks", "reach",
          "purchases", "purchaseValue", "ctr", "cpc", "cpm", "roas",
          "currency", "lastSyncedAt", "createdAt", "updatedAt"
        ) VALUES (
          ${rowId}, ${userId}, ${accountId}, ${c.id}, ${c.name || null}, ${day},
          ${new Prisma.Decimal(spend)}, ${impressions}, ${clicks}, ${linkClicks}, ${uniqueClicks}, ${reach},
          ${purchases}, ${new Prisma.Decimal(purchaseValue)}, ${ctr}, ${cpc}, ${cpm}, ${roas},
          'USD', NOW(), NOW(), NOW()
        )
        ON CONFLICT ("userId", "accountId", "campaignId", "date") DO UPDATE SET
          "campaignName"  = COALESCE(EXCLUDED."campaignName", "FbCampaignDailyMetric"."campaignName"),
          "spend"         = EXCLUDED."spend",
          "impressions"   = EXCLUDED."impressions",
          "clicks"        = EXCLUDED."clicks",
          "linkClicks"    = EXCLUDED."linkClicks",
          "uniqueClicks"  = EXCLUDED."uniqueClicks",
          "reach"         = EXCLUDED."reach",
          "purchases"     = EXCLUDED."purchases",
          "purchaseValue" = EXCLUDED."purchaseValue",
          "ctr"           = EXCLUDED."ctr",
          "cpc"           = EXCLUDED."cpc",
          "cpm"           = EXCLUDED."cpm",
          "roas"          = EXCLUDED."roas",
          "lastSyncedAt"  = NOW(),
          "updatedAt"     = NOW()
      `;
      written++;
    }
  });

  return { written, campaigns: campaigns.length };
}

/**
 * Sync the rolling window for one user.
 *
 * 1. Find every distinct accountId the user has mappings for.
 * 2. For each (account, day in [today - daysBack, today]) call syncAccountDay.
 *
 * Sequential per-account so we don't fan out FB calls in parallel for one
 * user (rate limits are per-account and per-app — sequential keeps logs
 * readable and avoids burst throttling).
 */
export async function syncCampaignMetricsForUser(
  userId: string,
  daysBack: number = DEFAULT_SYNC_DAYS_BACK
): Promise<{ accounts: number; days: number; written: number; errors: number }> {
  const accounts = await prisma.$queryRaw<Array<{ accountId: string }>>`
    SELECT DISTINCT "accountId" FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId}
  `;
  if (accounts.length === 0) {
    return { accounts: 0, days: 0, written: 0, errors: 0 };
  }

  const today = utcMidnight(new Date());
  const days: Date[] = [];
  for (let i = 0; i < daysBack; i++) {
    days.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
  }

  let written = 0;
  let errors = 0;
  for (const acc of accounts) {
    for (const d of days) {
      const r = await syncAccountDay(userId, acc.accountId, d);
      written += r.written;
      if (r.error) errors++;
    }
  }
  console.log(
    `[fb-metrics-sync] user=${userId} accounts=${accounts.length} days=${days.length} ` +
    `wrote=${written} errors=${errors}`
  );
  return { accounts: accounts.length, days: days.length, written, errors };
}

/**
 * Sync only "today" for one user — used as the cheap 5min refresh path.
 * Today is the only day that changes minute-to-minute, so the scheduler
 * runs this every cycle while a longer rolling sync runs less often.
 */
export async function syncTodayForUser(userId: string): Promise<{ accounts: number; written: number; errors: number }> {
  const accounts = await prisma.$queryRaw<Array<{ accountId: string }>>`
    SELECT DISTINCT "accountId" FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId}
  `;
  if (accounts.length === 0) return { accounts: 0, written: 0, errors: 0 };

  const today = utcMidnight(new Date());
  let written = 0;
  let errors = 0;
  for (const acc of accounts) {
    const r = await syncAccountDay(userId, acc.accountId, today);
    written += r.written;
    if (r.error) errors++;
  }
  return { accounts: accounts.length, written, errors };
}

/**
 * Sync today + recent days for ALL users with mappings.
 * Called by the metrics scheduler.
 */
export async function syncAllUsers(daysBack: number = DEFAULT_SYNC_DAYS_BACK): Promise<{
  users: number;
  accounts: number;
  written: number;
  errors: number;
}> {
  const users = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT "userId" FROM "CampaignStoreMapping"
  `;
  let totalAccounts = 0;
  let totalWritten = 0;
  let totalErrors = 0;
  for (const u of users) {
    const r = await syncCampaignMetricsForUser(u.userId, daysBack);
    totalAccounts += r.accounts;
    totalWritten += r.written;
    totalErrors += r.errors;
  }
  return { users: users.length, accounts: totalAccounts, written: totalWritten, errors: totalErrors };
}

// ── Read path ──────────────────────────────────────────────────────────────

export interface PersistedStoreMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  campaignsMatched: number;
  hasData: boolean;       // false → no row in DB for that day (cold start)
  lastSyncedAt: Date | null;
}

/**
 * Read aggregated store metrics for one day from FbCampaignDailyMetric,
 * joined to CampaignStoreMapping so only campaigns mapped to (userId, storeId)
 * contribute. Returns hasData=false when the join produced no rows so the
 * caller can fall back to a live FB fetch (cold-start safety net).
 */
export async function readStoreMetricsForDay(
  userId: string,
  storeId: string,
  date: Date
): Promise<PersistedStoreMetrics> {
  const day = utcMidnight(date);
  const rows = await prisma.$queryRaw<Array<{
    spend: any;
    impressions: bigint;
    clicks: bigint;
    linkClicks: bigint;
    purchases: number;
    purchaseValue: any;
    campaignsMatched: bigint;
    lastSyncedAt: Date | null;
  }>>`
    SELECT
      COALESCE(SUM(m."spend"), 0)         AS "spend",
      COALESCE(SUM(m."impressions"), 0)   AS "impressions",
      COALESCE(SUM(m."clicks"), 0)        AS "clicks",
      COALESCE(SUM(m."linkClicks"), 0)    AS "linkClicks",
      COALESCE(SUM(m."purchases"), 0)::int AS "purchases",
      COALESCE(SUM(m."purchaseValue"), 0) AS "purchaseValue",
      COUNT(*)::bigint                    AS "campaignsMatched",
      MAX(m."lastSyncedAt")               AS "lastSyncedAt"
    FROM "FbCampaignDailyMetric" m
    JOIN "CampaignStoreMapping" csm
      ON csm."campaignId" = m."campaignId"
     AND csm."userId"     = m."userId"
    WHERE m."userId"  = ${userId}
      AND csm."storeId" = ${storeId}
      AND m."date"    = ${day}
  `;
  const r = rows[0];
  const matched = Number(r?.campaignsMatched || 0);
  return {
    spend:         Number(r?.spend || 0),
    impressions:   Number(r?.impressions || 0),
    clicks:        Number(r?.clicks || 0),
    linkClicks:    Number(r?.linkClicks || 0),
    purchases:     Number(r?.purchases || 0),
    purchaseValue: Number(r?.purchaseValue || 0),
    campaignsMatched: matched,
    hasData:       matched > 0,
    lastSyncedAt:  r?.lastSyncedAt || null
  };
}
