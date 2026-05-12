/**
 * Campaign ↔ Store mapping service.
 *
 * Use case: one FB ad account runs ads for multiple Shopify stores. Each
 * store needs its own ad spend attributed correctly. Admin maps each
 * campaign to a single store; daily P&L for that store sums spend from
 * its mapped campaigns only.
 *
 * Raw SQL because the new model isn't in the generated Prisma client until
 * `npx prisma generate` runs against the new schema.
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as pool from './fb-system-token.service';
import { getAccountData } from './fb-account-data.service';
import * as userToken from './fb-user-token.service';
import { readStoreMetricsForDay, syncAccountDay } from './fb-metrics-store.service';

const prisma = new PrismaClient();
const FB_API = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

export interface CampaignWithMapping {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string | null;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  storeId: string | null;
  storeDomain: string | null;
}

/**
 * List campaigns the user has access to (across all their accounts), each
 * row decorated with its current store mapping (null if unmapped).
 *
 * Pulls live structure from FB (cached in fb-account-data) so the campaign
 * list reflects what's actually in the ad account right now — including
 * just-created campaigns the admin needs to map.
 */
export async function listCampaignsForUser(userId: string): Promise<CampaignWithMapping[]> {
  // 1. Find accounts the user has access to.
  const accounts = await prisma.$queryRaw<Array<{ accountId: string; accountName: string }>>`
    SELECT a."accountId", a."accountName"
    FROM "FacebookAdAccountAccess" x
    JOIN "FacebookAdAccountAssignment" a ON a."accountId" = x."accountId"
    WHERE x."userId" = ${userId}
  `;
  if (accounts.length === 0) return [];

  // 2. For each account, fetch campaign list. Cheap because we only read
  //    structure (no insights), counts as one read per account.
  const out: CampaignWithMapping[] = [];
  for (const acc of accounts) {
    try {
      const token = pool.tokenForAccount(acc.accountId);
      const fields = 'id,name,status,effective_status,objective';
      const url = `${FB_API}/act_${acc.accountId}/campaigns?fields=${fields}&limit=500&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json() as { data?: any[] };
      for (const c of json.data || []) {
        out.push({
          campaignId: c.id,
          campaignName: c.name,
          accountId: acc.accountId,
          accountName: acc.accountName,
          status: c.status || null,
          effectiveStatus: c.effective_status || null,
          objective: c.objective || null,
          storeId: null,           // filled by JOIN below
          storeDomain: null
        });
      }
    } catch (err) {
      console.warn(`[campaign-mapping] failed to list campaigns for ${acc.accountId}:`, (err as Error).message);
    }
  }

  // 3. Decorate with existing mappings.
  if (out.length === 0) return out;
  const ids = out.map(c => c.campaignId);
  const mappings = await prisma.$queryRaw<Array<{ campaignId: string; storeId: string; storeDomain: string }>>`
    SELECT m."campaignId", m."storeId", s."storeDomain"
    FROM "CampaignStoreMapping" m
    JOIN "ShopifyStore" s ON s."id" = m."storeId"
    WHERE m."userId" = ${userId} AND m."campaignId" = ANY(${ids}::text[])
  `;
  const byId = new Map(mappings.map(m => [m.campaignId, { storeId: m.storeId, storeDomain: m.storeDomain }]));
  for (const c of out) {
    const m = byId.get(c.campaignId);
    if (m) { c.storeId = m.storeId; c.storeDomain = m.storeDomain; }
  }
  return out;
}

/** Upsert a single mapping. Pass storeId=null to clear the mapping. */
export async function setMapping(input: {
  userId: string;
  campaignId: string;
  campaignName?: string;
  accountId: string;
  storeId: string | null;
}): Promise<void> {
  if (input.storeId === null) {
    await prisma.$executeRaw`
      DELETE FROM "CampaignStoreMapping"
      WHERE "userId" = ${input.userId} AND "campaignId" = ${input.campaignId}
    `;
    return;
  }

  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "CampaignStoreMapping"
      ("id", "campaignId", "campaignName", "accountId", "userId", "storeId", "updatedAt")
    VALUES
      (${id}, ${input.campaignId}, ${input.campaignName || null}, ${input.accountId}, ${input.userId}, ${input.storeId}, NOW())
    ON CONFLICT ("campaignId") DO UPDATE SET
      "campaignName" = COALESCE(EXCLUDED."campaignName", "CampaignStoreMapping"."campaignName"),
      "accountId"    = EXCLUDED."accountId",
      "userId"       = EXCLUDED."userId",
      "storeId"      = EXCLUDED."storeId",
      "updatedAt"    = NOW()
  `;
}

/** Bulk map every campaign whose name matches a regex/substring. */
export async function bulkAssignByPattern(
  userId: string,
  storeId: string,
  pattern: string,
  patternType: 'contains' | 'regex' = 'contains'
): Promise<{ matched: number; mapped: number; previewNames: string[] }> {
  const campaigns = await listCampaignsForUser(userId);
  let regex: RegExp;
  try {
    regex = patternType === 'regex' ? new RegExp(pattern, 'i') : new RegExp(escapeRegex(pattern), 'i');
  } catch {
    throw new Error('Invalid regex pattern');
  }
  const matched = campaigns.filter(c => regex.test(c.campaignName));
  for (const c of matched) {
    await setMapping({
      userId,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      storeId
    });
  }
  return {
    matched: matched.length,
    mapped: matched.length,
    previewNames: matched.slice(0, 10).map(c => c.campaignName)
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Force-refresh: backfill missing snapshots for a store's mapped campaigns
 * over the date range, then return the per-day spend per store.
 *
 * Used when the user clicks "Recompute" — they want certainty that the
 * numbers reflect the current mapping, not stale snapshots from before
 * a campaign was added/removed.
 */
export async function recomputeStoreSpend(
  userId: string,
  storeId: string,
  since: Date,
  until: Date
): Promise<{
  daysBackfilled: number;
  daysSkipped: number;
  errors: Array<{ date: string; error: string }>;
  daily: Array<{ date: string; spend: number }>;
}> {
  // Import here to avoid circular dep issue at module load time.
  const { snapshotAccountDay } = await import('./fb-snapshot.service');

  const mapped = await prisma.$queryRaw<Array<{ accountId: string }>>`
    SELECT DISTINCT "accountId" FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId} AND "storeId" = ${storeId}
  `;
  const accountIds = mapped.map(m => m.accountId);
  if (accountIds.length === 0) {
    return { daysBackfilled: 0, daysSkipped: 0, errors: [], daily: [] };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const errors: Array<{ date: string; error: string }> = [];
  let daysBackfilled = 0;
  let daysSkipped = 0;

  // Walk each day in range. For past days, snapshot each account so
  // FacebookAdInsightSnapshot is fresh. Today is skipped (it's mutable;
  // computeStoreFbSpendForDay reads live).
  const sinceDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const untilDay = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));
  for (let d = new Date(sinceDay); d.getTime() <= untilDay.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getTime() >= today.getTime()) {
      daysSkipped++;  // today/future — live, no snapshot
      continue;
    }
    for (const acc of accountIds) {
      try {
        await snapshotAccountDay(acc, new Date(d));
      } catch (err: any) {
        errors.push({ date: d.toISOString().slice(0, 10), error: `${acc}: ${err.message || String(err)}` });
      }
    }
    daysBackfilled++;
  }

  // Compute final daily spend (snapshots for past, live for today).
  const daily: Array<{ date: string; spend: number }> = [];
  for (let d = new Date(sinceDay); d.getTime() <= untilDay.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const spend = await computeStoreFbSpendForDay(userId, storeId, new Date(d));
    daily.push({ date: d.toISOString().slice(0, 10), spend });
  }

  return { daysBackfilled, daysSkipped, errors, daily };
}

/**
 * SET-semantics save for one store.
 *
 * Caller passes the COMPLETE list of campaigns that should belong to the
 * store after this call. Backend reconciles:
 *   - Campaigns in list, not currently mapped here → INSERT (or UPDATE if
 *     they were mapped to a different store — campaignId is unique).
 *   - Campaigns currently mapped to this store but NOT in list → DELETE.
 *   - Campaigns mapped to other stores and not in list → untouched.
 *
 * Atomic via a transaction so the store's mapping never sees a partial
 * state mid-save.
 */
export async function saveCampaignsForStore(input: {
  userId: string;
  storeId: string;
  campaigns: Array<{ campaignId: string; campaignName?: string | null; accountId: string }>;
}): Promise<{ added: number; removed: number; transferred: number }> {
  const { userId, storeId, campaigns } = input;
  const incomingIds = campaigns.map(c => c.campaignId);

  return prisma.$transaction(async (tx) => {
    // Snapshot what's currently mapped to this store + what each incoming id
    // currently points to (used to count "transferred from other store").
    const currentForStore = await tx.$queryRaw<Array<{ campaignId: string }>>`
      SELECT "campaignId" FROM "CampaignStoreMapping"
      WHERE "userId" = ${userId} AND "storeId" = ${storeId}
    `;
    const currentSet = new Set(currentForStore.map(r => r.campaignId));

    let prevMappingForIncoming: Array<{ campaignId: string; storeId: string }> = [];
    if (incomingIds.length > 0) {
      prevMappingForIncoming = await tx.$queryRaw<Array<{ campaignId: string; storeId: string }>>`
        SELECT "campaignId", "storeId" FROM "CampaignStoreMapping"
        WHERE "campaignId" = ANY(${incomingIds}::text[])
      `;
    }
    const prevById = new Map(prevMappingForIncoming.map(r => [r.campaignId, r.storeId]));

    // 1. Delete: rows currently in this store but not in incoming list.
    const toDelete = currentForStore.filter(r => !incomingIds.includes(r.campaignId));
    let removed = 0;
    if (toDelete.length > 0) {
      const ids = toDelete.map(r => r.campaignId);
      const result = await tx.$executeRaw`
        DELETE FROM "CampaignStoreMapping"
        WHERE "userId" = ${userId} AND "storeId" = ${storeId}
          AND "campaignId" = ANY(${ids}::text[])
      `;
      removed = Number(result);
    }

    // 2. Upsert: each incoming campaign → store. ON CONFLICT updates so we
    //    can transfer from another store without a separate DELETE.
    let added = 0;
    let transferred = 0;
    for (const c of campaigns) {
      const wasInThisStore = currentSet.has(c.campaignId);
      const wasInOtherStore = prevById.has(c.campaignId) && prevById.get(c.campaignId) !== storeId;

      const id = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO "CampaignStoreMapping"
          ("id", "campaignId", "campaignName", "accountId", "userId", "storeId", "updatedAt")
        VALUES
          (${id}, ${c.campaignId}, ${c.campaignName || null}, ${c.accountId}, ${userId}, ${storeId}, NOW())
        ON CONFLICT ("campaignId") DO UPDATE SET
          "campaignName" = COALESCE(EXCLUDED."campaignName", "CampaignStoreMapping"."campaignName"),
          "accountId"    = EXCLUDED."accountId",
          "userId"       = EXCLUDED."userId",
          "storeId"      = EXCLUDED."storeId",
          "updatedAt"    = NOW()
      `;

      if (wasInOtherStore) transferred++;
      else if (!wasInThisStore) added++;
    }

    return { added, removed, transferred };
  }).then(async (result) => {
    // Fire-and-forget: warm FbCampaignDailyMetric so the dashboard / P&L
    // see real numbers on the very next render (instead of waiting up to
    // 5 min for the next scheduler tick). Errors are logged but don't
    // fail the save — the scheduler will catch up.
    void (async () => {
      try {
        const { syncCampaignMetricsForUser } = await import('./fb-metrics-store.service');
        const r = await syncCampaignMetricsForUser(userId);
        console.log(
          `[campaign-mapping] post-save metrics sync user=${userId} ` +
          `wrote=${r.written} accounts=${r.accounts} errors=${r.errors}`
        );
        // Drop the per-store today cache so getTodayLive recomputes from
        // the freshly-populated rows on next call.
        const { invalidateTodayCache } = await import('./daily-pl.service');
        invalidateTodayCache(userId, storeId);
      } catch (err: any) {
        console.warn('[campaign-mapping] post-save metrics sync failed:', err?.message || err);
      }
    })();
    return result;
  });
}

/**
 * Whether this store has any campaign mappings configured. Used by the P&L
 * pipeline to decide whether to use mapping-based spend or fall back to
 * the legacy account-level FacebookAdSpend table.
 */
export async function storeHasMappings(userId: string, storeId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId} AND "storeId" = ${storeId}
  `;
  return Number(rows[0]?.n || 0) > 0;
}

/**
 * Sum spend for one day across mapped campaigns, reusing the shared FB
 * data cache that fb-account-data.service maintains (5min TTL for today,
 * tiered for older dates). This is the SAME payload the dashboard refresh
 * cycle uses — guarantees the per-store P&L number matches what the user
 * sees in the Ads Manager view.
 *
 * No second round-trip to FB on cache hit. Cache miss = one paginated
 * level=ad call (cached for 5min after).
 */
async function fetchDaySpendFromCache(
  userId: string,
  accountIds: string[],
  campaignIds: string[],
  date: Date
): Promise<number> {
  // Build single-day window matching cache key format.
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // Pool is preferred. If not configured, fall back to the user's FB SDK token
  // — without it, getAccountData would call FB with an empty token and FB
  // would silently 400, the catch below would swallow it, and the result
  // would be a deceptive $0. The fallback ensures legacy single-user accounts
  // also see real numbers.
  // Prefer user's own FB Login token over the Adlux pool. Pool tokens
  // belong to a different BM and cannot query user-owned ad accounts —
  // FB returns code 190/465 if we use the wrong one.
  const fallbackToken = (await userToken.getRawToken(userId)) || '';

  const campaignSet = new Set(campaignIds);
  const dateKey = date.toISOString().slice(0, 10);
  let total = 0;
  for (const acc of accountIds) {
    try {
      const data = await getAccountData(acc, fallbackToken, dayStart, dayEnd);
      // Diagnostics:
      //   matched/total campaigns returned by FB
      //   mapped sum vs account-total sum (helps tell "mapping wrong" apart
      //   from "really $0 today" — if account total > 0 but mapped sum = 0
      //   then the user mapped the wrong campaigns)
      let matched = 0;
      let acctSpend = 0;
      let accountTotalSpend = 0;
      const topUnmapped: Array<{ id: string; name: string; spend: number }> = [];
      for (const c of data.campaigns || []) {
        const sp = c.spend || 0;
        accountTotalSpend += sp;
        if (campaignSet.has(c.id)) {
          matched++;
          acctSpend += sp;
        } else if (sp > 0) {
          topUnmapped.push({ id: c.id, name: c.name || '', spend: sp });
        }
      }
      total += acctSpend;
      const logKey = `${acc}:${dateKey}`;
      if (shouldLogSpendOnce(logKey)) {
        if (matched === 0 && campaignSet.size > 0) {
          console.warn(
            `[store-spend] acct=${acc} day=${dateKey} ${data.campaigns?.length || 0} campaigns returned, ` +
            `0 of ${campaignSet.size} mapped IDs matched. account_total=$${accountTotalSpend.toFixed(2)}. ` +
            `mapped=[${[...campaignSet].slice(0, 3).join(',')}${campaignSet.size > 3 ? ',…' : ''}]`
          );
        } else if (acctSpend === 0 && accountTotalSpend > 0) {
          // Mapped campaigns matched but contributed 0 — meanwhile the
          // account has spend on OTHER campaigns. Strong signal the user
          // mapped the wrong set. Surface the top unmapped earners.
          const top = topUnmapped.sort((a, b) => b.spend - a.spend).slice(0, 3)
            .map(c => `${c.name || c.id}=$${c.spend.toFixed(2)}`).join(', ');
          console.warn(
            `[store-spend] acct=${acc} day=${dateKey} mapped ${matched}/${campaignSet.size} matched but $0; ` +
            `account_total=$${accountTotalSpend.toFixed(2)} on UNMAPPED campaigns. Top: ${top}`
          );
        } else {
          console.log(
            `[store-spend] acct=${acc} day=${dateKey} mapped=$${acctSpend.toFixed(2)} (${matched}/${campaignSet.size} camps), account_total=$${accountTotalSpend.toFixed(2)}`
          );
        }
      }
    } catch (err) {
      console.warn(`[store-spend] cache fetch ${acc} ${dateKey} failed:`, (err as Error).message);
    }
  }
  return total;
}

// Throttle spend logs to once per (account, day) per minute. Multiple callers
// (KPI + P&L + dashboard) hit this fn back-to-back; FB cache absorbs the
// underlying fetch but we don't need 4 identical log lines.
const lastSpendLogAt = new Map<string, number>();
function shouldLogSpendOnce(key: string): boolean {
  const now = Date.now();
  const prev = lastSpendLogAt.get(key) || 0;
  if (now - prev < 60_000) return false;
  lastSpendLogAt.set(key, now);
  return true;
}

/**
 * Mapping-aware ad spend for ONE day in ONE store.
 *
 * Strategy: ALWAYS prefer the shared live cache (same `getAccountData` that
 * the dashboard reads from) so P&L and dashboard show the same number.
 * Snapshots in `FacebookAdInsightSnapshot` are only consulted as FALLBACK
 * when the live call fails or returns nothing for an old day where data
 * wouldn't change anyway.
 *
 * Why this matters: snapshots are written ONCE at EOD. FB updates yesterday
 * for hours/days afterwards (delayed attribution). Reading snapshot keeps
 * P&L stuck at the EOD value while the dashboard shows the latest. Three
 * different numbers across views → confusion. With this strategy, P&L and
 * dashboard share the same 5min/1h/6h cache, so they match.
 *
 * Cache TTL tiers (set in fb-cache.service):
 *   today      → 5min
 *   yesterday  → 1h
 *   last 28d   → 6h
 *   older      → 24h
 *
 * For dates older than the TTL window, snapshots act as a permanent record
 * (data stops changing; no need to keep refetching).
 */
/**
 * Like `computeStoreFbSpendForDay` but returns the full FB metrics bundle
 * (spend + impressions + clicks + link_clicks + purchases + purchase value)
 * summed across the campaigns mapped to (userId, storeId) for the given day.
 *
 * Lives next to `computeStoreFbSpendForDay` because it's the same query
 * pattern; the only difference is what we extract from each campaign row.
 * Frontend uses these to derive CPC / CTR / CVR / ROAS / CPM in the
 * Daily breakdown table.
 *
 * Old days (outside the live cache TTL window) hit `getAccountData` which
 * may still serve from snapshot — but the snapshot row only carries spend,
 * not the rest of the metrics. Caller should treat 0s for impressions etc
 * on very old days as "not available", not as "really zero".
 */
export interface StoreFbMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
}
export async function computeStoreFbMetricsForDay(
  userId: string,
  storeId: string,
  date: Date
): Promise<StoreFbMetrics> {
  const empty: StoreFbMetrics = {
    spend: 0, impressions: 0, clicks: 0, linkClicks: 0, purchases: 0, purchaseValue: 0
  };
  const mapped = await prisma.$queryRaw<Array<{ campaignId: string; accountId: string }>>`
    SELECT "campaignId", "accountId"
    FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId} AND "storeId" = ${storeId}
  `;
  if (mapped.length === 0) return empty;

  // ── Read path: pull aggregated metrics from FbCampaignDailyMetric.
  // The 5-min scheduler + saveCampaignsForStore keep this table fresh, so
  // this is normally the only path the dashboard / P&L touches. No FB
  // call on the request side, no $0 from a transient FB hiccup.
  const persisted = await readStoreMetricsForDay(userId, storeId, date);
  if (persisted.hasData) {
    return {
      spend:         persisted.spend,
      impressions:   persisted.impressions,
      clicks:        persisted.clicks,
      linkClicks:    persisted.linkClicks,
      purchases:     persisted.purchases,
      purchaseValue: persisted.purchaseValue
    };
  }

  // ── Cold-start safety net: nothing in DB for this (store, day). Sync
  // each mapped account for that day on-demand, then re-read. Keeps the
  // first ever request after deploy / migration from showing $0 while
  // the background scheduler hasn't fired yet.
  const accountIds = Array.from(new Set(mapped.map(m => m.accountId)));
  const dateKey = date.toISOString().slice(0, 10);
  const logKey = `cold-start:${userId}:${storeId}:${dateKey}`;
  if (shouldLogSpendOnce(logKey)) {
    console.log(
      `[store-metrics] cold start user=${userId} store=${storeId} day=${dateKey} ` +
      `accounts=${accountIds.length} — fetching from FB and persisting`
    );
  }
  for (const acc of accountIds) {
    await syncAccountDay(userId, acc, date);
  }
  const second = await readStoreMetricsForDay(userId, storeId, date);
  if (second.hasData) {
    return {
      spend:         second.spend,
      impressions:   second.impressions,
      clicks:        second.clicks,
      linkClicks:    second.linkClicks,
      purchases:     second.purchases,
      purchaseValue: second.purchaseValue
    };
  }
  return empty;
}

export async function computeStoreFbSpendForDay(
  userId: string,
  storeId: string,
  date: Date
): Promise<number> {
  const m = await computeStoreFbMetricsForDay(userId, storeId, date);
  if (m.spend > 0) return m.spend;

  // Final fallback: very old days where FbCampaignDailyMetric was never
  // populated (rolling sync window only goes back ~14 days). Read from
  // the EOD snapshot table that historical data was archived into.
  const mapped = await prisma.$queryRaw<Array<{ campaignId: string; accountId: string }>>`
    SELECT "campaignId", "accountId"
    FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId} AND "storeId" = ${storeId}
  `;
  if (mapped.length === 0) return 0;
  const campaignIds = mapped.map(x => x.campaignId);
  const accountIds = Array.from(new Set(mapped.map(x => x.accountId)));
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const rows = await prisma.$queryRaw<Array<{ spend: any }>>`
    SELECT "spend" FROM "FacebookAdInsightSnapshot"
    WHERE "level" = 'campaign'
      AND "accountId" = ANY(${accountIds}::text[])
      AND "entityId" = ANY(${campaignIds}::text[])
      AND "date" = ${day}
  `;
  if (rows.length > 0) {
    return rows.reduce((s, r) => s + parseFloat(String(r.spend) || '0'), 0);
  }
  return 0;
}

/**
 * Compute total ad spend for a store over a date range. Returns a per-day
 * breakdown so the P&L view can chart day-by-day.
 *
 * Strategy: live cache for EVERY day in the range, exactly like
 * `computeStoreFbSpendForDay` (single source of truth with the dashboard).
 * Snapshots are loaded as a backup/fill for any day where live returns 0
 * — so very old days (where data is frozen and may be evicted from cache)
 * still surface from the persisted snapshot.
 *
 * Why not "snapshot for past + live for today"? Snapshots write once at EOD
 * but FB updates yesterday's numbers for hours/days afterwards (delayed
 * attribution). Reading snapshot first leaves P&L stuck at the EOD value
 * while the dashboard shows the latest — that's the divergence the user
 * has been hitting.
 */
export async function getStoreAdSpend(
  userId: string,
  storeId: string,
  since: Date,
  until: Date
): Promise<{
  daily: Array<{ date: string; spend: number; campaignCount: number }>;
  total: number;
  mappedCampaigns: Array<{ campaignId: string; campaignName: string | null; accountId: string }>;
}> {
  const mapped = await prisma.$queryRaw<Array<{ campaignId: string; campaignName: string | null; accountId: string }>>`
    SELECT "campaignId", "campaignName", "accountId"
    FROM "CampaignStoreMapping"
    WHERE "userId" = ${userId} AND "storeId" = ${storeId}
  `;
  if (mapped.length === 0) {
    return { daily: [], total: 0, mappedCampaigns: [] };
  }

  const campaignIds = mapped.map(m => m.campaignId);
  const accountIds = Array.from(new Set(mapped.map(m => m.accountId)));
  const campaignSet = new Set(campaignIds);

  // Walk each calendar day in [since, until] and ask the shared FB cache
  // for that day's account data. fetchDaySpendFromCache filters to mapped
  // campaigns and returns total mapped spend for that day across accounts.
  const sinceDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const untilDay = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));

  const dailyMap = new Map<string, { spend: number; campaigns: Set<string> }>();

  // Read the whole window from FbCampaignDailyMetric in one query — single
  // source of truth for the entire system. The 5-min sync scheduler keeps
  // this fresh; this read never hits FB.
  const persistedRows = await prisma.$queryRaw<Array<{ date: Date; spend: any; campaignId: string }>>`
    SELECT m."date", m."spend", m."campaignId"
    FROM "FbCampaignDailyMetric" m
    WHERE m."userId"     = ${userId}
      AND m."campaignId" = ANY(${campaignIds}::text[])
      AND m."date"       >= ${sinceDay}
      AND m."date"       <= ${untilDay}
  `;
  for (let d = new Date(sinceDay); d.getTime() <= untilDay.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dateKey = new Date(d).toISOString().slice(0, 10);
    dailyMap.set(dateKey, { spend: 0, campaigns: new Set<string>() });
  }
  for (const r of persistedRows) {
    const k = (r.date instanceof Date ? r.date : new Date(r.date as any)).toISOString().slice(0, 10);
    const cur = dailyMap.get(k) || { spend: 0, campaigns: new Set<string>() };
    cur.spend += parseFloat(String(r.spend) || '0');
    cur.campaigns.add(r.campaignId);
    dailyMap.set(k, cur);
  }
  // Suppress "fetchDaySpendFromCache is unused" — `accountIds` no longer
  // drives the per-day pull. Reading from the persisted table makes it
  // unnecessary, but we still need accountIds for the snapshot fallback
  // below.
  void accountIds;

  // Fill in campaign counts (and rescue 0-spend days) from snapshots —
  // useful for very old dates where live cache may have evicted, plus
  // gives us per-day campaign-count breakdown the UI displays.
  const snapshotRows = await prisma.$queryRaw<Array<{ date: Date; spend: any; entityId: string }>>`
    SELECT "date", "spend", "entityId"
    FROM "FacebookAdInsightSnapshot"
    WHERE "level" = 'campaign'
      AND "entityId" = ANY(${campaignIds}::text[])
      AND "date" >= ${sinceDay}
      AND "date" <= ${untilDay}
    ORDER BY "date" ASC
  `;
  for (const r of snapshotRows) {
    if (!campaignSet.has(r.entityId)) continue;
    const dateKey = (r.date instanceof Date ? r.date : new Date(r.date as any)).toISOString().slice(0, 10);
    const cur = dailyMap.get(dateKey) || { spend: 0, campaigns: new Set<string>() };
    cur.campaigns.add(r.entityId);
    if (cur.spend === 0) {
      // Rescue: live returned 0 (cache miss + FB silent fail or genuine zero) —
      // fall back to the snapshot for this day.
      cur.spend += parseFloat(String(r.spend) || '0');
    }
    dailyMap.set(dateKey, cur);
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, spend: v.spend, campaignCount: v.campaigns.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = daily.reduce((s, d) => s + d.spend, 0);

  return { daily, total, mappedCampaigns: mapped };
}
