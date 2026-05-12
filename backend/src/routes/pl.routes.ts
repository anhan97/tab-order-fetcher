import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  aggregateForDate,
  computeAndSaveForDate,
  recomputeRange,
  listSnapshots,
  parseTzOffsetMinutes,
  localCalendarDateUTC,
  getTodayLive,
  invalidateTodayCache,
  finalizeYesterday
} from '../services/daily-pl.service';
import { syncOrders, syncBalanceTransactions, recomputeOrderCostSnapshots } from '../services/order-sync.service';
import { backfillShippingCompaniesFromTracking } from '../services/carrier-backfill.service';
import { seedDefaultPricebooks } from '../services/pricebook-seed.service';
import { aggregateByPeriod, compareTwoPeriods, PeriodKind } from '../services/period-aggregation.service';
import { importCostCsv } from '../services/cost-csv-import.service';
import { resolveStore } from '../middleware/resolve-store';

const router = Router();
const prisma = new PrismaClient();

router.use(resolveStore);

function parseDate(s: any, fallback?: Date): Date {
  if (!s) return fallback ?? new Date();
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d;
}

function readTz(req: any): number {
  return parseTzOffsetMinutes(req.query?.tz ?? req.body?.tz ?? req.headers['x-tz']);
}

// GET /api/pl/whoami → returns { userId, storeId, storeDomain } resolved from headers
router.get('/whoami', (req, res) => {
  res.json(req.resolved);
});

// GET /api/pl/order-fees?from=...&to=... → { fees: Record<shopifyOrderId, paymentFee> }
// Used by the Orders page to enrich Shopify-sourced rows with the payment-fee
// number we computed from Shopify Payments balance transactions.
router.get('/order-fees', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(to.getTime() - 90 * 86400000));
    const orders = await prisma.order.findMany({
      where: { storeId, processedAt: { gte: from, lt: to } },
      select: { shopifyOrderId: true, paymentFee: true, paymentGateway: true }
    });
    const fees: Record<string, { fee: number; gateway: string | null }> = {};
    for (const o of orders) {
      fees[o.shopifyOrderId] = {
        fee: o.paymentFee ? Number(o.paymentFee) : 0,
        gateway: o.paymentGateway
      };
    }
    res.json({ fees, count: orders.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/daily?from=...&to=...&tz=Etc/GMT+6
//
// Returns one row per local-calendar day in [from, to].
//
//   today           → live recompute (5min memoised via getTodayLive)
//   last 3 days     → live recompute on every call (overrides DailyPLSnapshot)
//                     because FB updates yesterday's spend for hours/days
//                     after EOD due to delayed attribution. Reading the
//                     frozen DailyPLSnapshot row leaves P&L stuck while
//                     the dashboard shows the latest — that's the
//                     divergence users keep hitting.
//   older           → trust the finalized DailyPLSnapshot row (data is
//                     stable; no need to recompute on every page load)
//
// Effective FB-call cost: ~3 cache lookups per /daily call. The shared
// fb-account-data cache (5min/1h/6h tiered) absorbs nearly all of them.
const RECENT_RECOMPUTE_DAYS = 3;

router.get('/daily', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(to.getTime() - 30 * 86400000));

    // Convert the raw ISO timestamps into LOCAL-TZ calendar markers before
    // doing any range/equality comparisons. Without this step a "yesterday"
    // range in GMT+7 — whose UTC bounds straddle two UTC dates — leaks an
    // extra calendar day into recentDays and into the today-inclusion
    // check, so /daily returns one row too many and Dashboard double-counts.
    // Snapshot rows are stored keyed by local-calendar marker too, so this
    // is the right canonical form to compare against.
    const fromCal = localCalendarDateUTC(from, tz);
    const toCal = localCalendarDateUTC(to, tz);
    const todayCal = localCalendarDateUTC(new Date(), tz);
    const fromKey = fromCal.toISOString().slice(0, 10);
    const toKey = toCal.toISOString().slice(0, 10);
    const todayKey = todayCal.toISOString().slice(0, 10);

    // Pass the canonical local-calendar bounds to listSnapshots so it
    // doesn't include rows for adjacent UTC days that fall outside the
    // user's local range.
    const snapshots = await listSnapshots(userId, storeId, fromCal, toCal, tz);

    // Build the set of recent days that need live re-aggregation (excluding
    // today which is handled separately by getTodayLive).
    const recentDays: Date[] = [];
    for (let i = 1; i <= RECENT_RECOMPUTE_DAYS; i++) {
      const d = new Date(todayCal.getTime() - i * 86_400_000);
      const k = d.toISOString().slice(0, 10);
      if (k >= fromKey && k <= toKey) recentDays.push(d);
    }

    // Re-aggregate each recent day in parallel (cache hits make this cheap).
    const recentBreakdowns = await Promise.all(
      recentDays.map(async d => ({
        date: d,
        breakdown: await aggregateForDate(userId, storeId, d, tz)
      }))
    );

    // Index DB snapshots by date string so we can replace selectively.
    let merged = (snapshots as any[]).map(s => ({ ...s }));
    const byDateKey = new Map<string, any>();
    for (const s of merged) {
      const k = s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10);
      byDateKey.set(k, s);
    }

    // Override frozen DailyPLSnapshot rows with live re-aggregation for
    // the recent window. Either upsert-in-place if a row already existed,
    // or push a fresh row if it didn't.
    for (const { date, breakdown } of recentBreakdowns) {
      const k = date.toISOString().slice(0, 10);
      const existing = byDateKey.get(k);
      const fresh = {
        userId,
        storeId,
        date,
        currency: 'USD',
        isFinalized: existing?.isFinalized ?? false,
        computedAt: new Date().toISOString(),
        ...breakdown
      };
      if (existing) {
        Object.assign(existing, fresh);
      } else {
        merged.push(fresh);
        byDateKey.set(k, fresh);
      }
    }

    // Today live (5min memoised) — special-cased separately so the response
    // also surfaces the freshness metadata.
    let liveToday: { breakdown: any; date: string; computedAt: string; ageSeconds: number } | null = null;
    if (todayKey >= fromKey && todayKey <= toKey) {
      liveToday = await getTodayLive(userId, storeId, tz);
      const existingToday = byDateKey.get(liveToday.date);
      const todayRow = {
        userId,
        storeId,
        date: new Date(liveToday.date + 'T00:00:00Z'),
        currency: 'USD',
        isFinalized: false,
        computedAt: liveToday.computedAt,
        ...liveToday.breakdown
      };
      if (existingToday) Object.assign(existingToday, todayRow);
      else merged.push(todayRow);
    }

    merged.sort((a: any, b: any) => {
      const da = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
      const db = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
      return da - db;
    });
    res.json({ snapshots: merged, tzOffsetMinutes: tz, today: liveToday });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/today?tz=...
//
// Live today P&L for the resolved store. Memoised 5min/store. Use this when
// the dashboard polls for fresh today numbers without re-fetching the whole
// snapshot range.
router.get('/today', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const result = await getTodayLive(userId, storeId, tz);
    res.json({ ...result, tzOffsetMinutes: tz });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

/**
 * GET /api/pl/today/debug — diagnose why today's fbAdSpend is $0.
 *
 * Walks the same chain as /today but returns every intermediate result:
 *   - how many CampaignStoreMapping rows exist for this store
 *   - which accountIds those campaigns belong to
 *   - per-account: how many campaigns FB returned, how many matched the
 *     mapped IDs, what their summed spend is, and any FB error encountered
 *   - the final breakdown getTodayLive returns
 *
 * If you're staring at a $0 today on the dashboard with mappings in place,
 * hit this URL in the browser and the response shows exactly which step
 * went wrong (FB call failed, no campaigns matched, account_total > 0 but
 * mapped_total = 0 → wrong campaign IDs mapped, etc.).
 */
router.get('/today/debug', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const { getAccountData } = await import('../services/fb-account-data.service');
    const userTokenSvc = await import('../services/fb-user-token.service');
    const poolSvc = await import('../services/fb-system-token.service');

    const mapped = await prisma.$queryRaw<Array<{ campaignId: string; campaignName: string | null; accountId: string }>>`
      SELECT "campaignId", "campaignName", "accountId"
      FROM "CampaignStoreMapping"
      WHERE "userId" = ${userId} AND "storeId" = ${storeId}
    `;

    if (mapped.length === 0) {
      return res.json({
        userId, storeId, tz,
        mappingCount: 0,
        diagnosis: 'No CampaignStoreMapping rows for this store. Map at least one campaign in the Mapping tab.',
        breakdown: null
      });
    }

    const today = localCalendarDateUTC(new Date(), tz);
    const dayStart = new Date(today);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const accountIds = Array.from(new Set(mapped.map(m => m.accountId)));
    const campaignSet = new Set(mapped.map(m => m.campaignId));

    // Prefer user's own FB Login token. Pool only as last resort — pool
    // belongs to the Adlux BM, not the user's BM, so querying a user's
    // ad account with a pool token returns code 190/465.
    const fallbackToken = (await userTokenSvc.getRawToken(userId)) || '';

    const accounts: any[] = [];
    let totalMappedSpend = 0;
    let totalAccountSpend = 0;

    for (const acc of accountIds) {
      const entry: any = { accountId: acc };
      try {
        const data = await getAccountData(acc, fallbackToken, dayStart, dayEnd);
        entry.cacheHit = data.meta?.cacheHit;
        entry.totalCampaignsReturned = data.campaigns?.length || 0;
        entry.matched = 0;
        entry.mappedSpend = 0;
        entry.accountTotalSpend = 0;
        const topUnmapped: any[] = [];
        for (const c of data.campaigns || []) {
          const sp = c.spend || 0;
          entry.accountTotalSpend += sp;
          if (campaignSet.has(c.id)) {
            entry.matched++;
            entry.mappedSpend += sp;
          } else if (sp > 0) {
            topUnmapped.push({ id: c.id, name: c.name || '', spend: sp });
          }
        }
        entry.mappedSpend = +entry.mappedSpend.toFixed(2);
        entry.accountTotalSpend = +entry.accountTotalSpend.toFixed(2);
        entry.topUnmappedEarners = topUnmapped.sort((a, b) => b.spend - a.spend).slice(0, 5);
        totalMappedSpend += entry.mappedSpend;
        totalAccountSpend += entry.accountTotalSpend;
      } catch (err: any) {
        entry.error = err?.message || String(err);
        entry.fbCode = err?.fbCode;
        entry.fbSubcode = err?.fbSubcode;
      }
      accounts.push(entry);
    }

    // Build a one-line diagnosis the user can act on.
    let diagnosis = 'OK';
    const erroring = accounts.filter(a => a.error);
    if (erroring.length === accountIds.length) {
      diagnosis = `All ${accountIds.length} accounts errored on FB call. First error: ${erroring[0].error}`;
    } else if (totalAccountSpend === 0) {
      diagnosis = 'FB returned $0 spend across all accounts for today. Either accounts truly have no spend yet or the FB cache is stale.';
    } else if (totalMappedSpend === 0 && totalAccountSpend > 0) {
      diagnosis = `Account total = $${totalAccountSpend.toFixed(2)} but mapped sum = $0. Your CampaignStoreMapping rows point to campaign IDs that did NOT return spend — check 'topUnmappedEarners' to see which campaigns actually have spend; map those instead.`;
    }

    res.json({
      userId, storeId, tz,
      todayCalUTC: today.toISOString(),
      windowUTC: { start: dayStart.toISOString(), end: dayEnd.toISOString() },
      mappingCount: mapped.length,
      mappedCampaigns: mapped.slice(0, 50),
      accountIds,
      hasUserToken: !!fallbackToken,
      poolConfigured: poolSvc.isPoolConfigured(),
      accounts,
      totals: {
        mappedSpend: +totalMappedSpend.toFixed(2),
        accountTotalSpend: +totalAccountSpend.toFixed(2)
      },
      diagnosis
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Debug failed' });
  }
});

// POST /api/pl/today/invalidate — drop the today cache for this store. Called
// after data-changing actions that should be reflected immediately (CSV
// import, manual recompute) instead of waiting for the 5min TTL.
router.post('/today/invalidate', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    invalidateTodayCache(userId, storeId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/refresh-fb-metrics — force a fresh sync of FB metrics for
// this user's mapped campaigns and persist into FbCampaignDailyMetric. Use
// when the user wants the dashboard / P&L numbers updated NOW instead of
// waiting for the 5-min scheduler. Returns counts of accounts / rows
// written. Today's P&L cache is also invalidated so the next /today call
// re-aggregates from the freshly-persisted rows.
router.post('/refresh-fb-metrics', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const { syncCampaignMetricsForUser, DEFAULT_SYNC_DAYS_BACK } = await import('../services/fb-metrics-store.service');
    const daysBack = parseInt(req.body?.daysBack ?? String(DEFAULT_SYNC_DAYS_BACK), 10) || DEFAULT_SYNC_DAYS_BACK;
    const result = await syncCampaignMetricsForUser(userId, daysBack);
    invalidateTodayCache(userId, storeId);
    res.json({ ok: true, daysBack, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/finalize-yesterday  body: { tz? }
// Manual trigger for the EOD finalize step (otherwise scheduled by the cron).
router.post('/finalize-yesterday', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const breakdown = await finalizeYesterday(userId, storeId, tz);
    res.json({ ...breakdown, tzOffsetMinutes: tz });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/preview?date=YYYY-MM-DD&tz=...
router.get('/preview', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const date = parseDate(req.query.date, new Date());
    const breakdown = await aggregateForDate(userId, storeId, date, tz);
    res.json({ ...breakdown, tzOffsetMinutes: tz });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/recompute  body: { from, to, tz? }
router.post('/recompute', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const { from, to } = req.body || {};
    const fromDate = parseDate(from, new Date(Date.now() - 7 * 86400000));
    const toDate = parseDate(to, new Date());
    const result = await recomputeRange(userId, storeId, fromDate, toDate, tz);
    invalidateTodayCache(userId, storeId);
    res.json({ ...result, tzOffsetMinutes: tz });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/recompute-day  body: { date, tz? }
router.post('/recompute-day', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const tz = readTz(req);
    const { date } = req.body || {};
    const breakdown = await computeAndSaveForDate(userId, storeId, parseDate(date, new Date()), tz);
    invalidateTodayCache(userId, storeId);
    res.json(breakdown);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/sync-orders  body: { since?, until?, pullTransactions?, syncBalances? }
router.post('/sync-orders', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const { since, until, pullTransactions, syncBalances } = req.body || {};
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    const result = await syncOrders(storeId, {
      since: sinceDate,
      until: untilDate,
      pullTransactions: pullTransactions !== false
    });

    let balance: { updated: number; balanceRows: number; errors: string[] } | undefined;
    if (syncBalances !== false && sinceDate && untilDate) {
      balance = await syncBalanceTransactions(storeId, sinceDate, untilDate);
    }
    res.json({ ...result, balance });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/store-settings — returns store-level config (default shipping company, etc.)
router.get('/store-settings', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const store = await prisma.shopifyStore.findUnique({
      where: { id: storeId },
      select: { defaultShippingCompany: true, name: true, storeDomain: true }
    });
    res.json(store);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// PUT /api/pl/store-settings  body: { defaultShippingCompany? }
router.put('/store-settings', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const { defaultShippingCompany } = req.body || {};
    const updated = await prisma.shopifyStore.update({
      where: { id: storeId },
      data: { defaultShippingCompany: defaultShippingCompany ?? null },
      select: { defaultShippingCompany: true }
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/shipping-companies — list known carriers (auto-discovered + manual)
router.get('/shipping-companies', async (_req, res) => {
  try {
    const list = await prisma.shippingCompany.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' }
    });
    res.json({ items: list });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// PUT /api/pl/shipping-companies/:id  body: { name?, display_name?, tracking_prefixes?, is_active? }
router.put('/shipping-companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, display_name, tracking_prefixes, is_active } = req.body || {};
    const updated = await prisma.shippingCompany.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(display_name !== undefined ? { display_name } : {}),
        ...(tracking_prefixes !== undefined ? { tracking_prefixes } : {}),
        ...(is_active !== undefined ? { is_active } : {})
      }
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/recompute-cogs  body: { from?, to? }
// Re-runs cost snapshot calculation for every order in the window. Use this after
// changing baseCost / pricebook / default supplier.
router.post('/recompute-cogs', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const { from, to } = req.body || {};
    const fromDate = parseDate(from, new Date(Date.now() - 30 * 86400000));
    const toDate = parseDate(to, new Date());
    const orders = await prisma.order.findMany({
      where: { userId, storeId, processedAt: { gte: fromDate, lt: toDate } },
      select: { id: true }
    });
    for (const o of orders) {
      await recomputeOrderCostSnapshots(userId, storeId, o.id);
    }
    res.json({ ordersProcessed: orders.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/import-cost-csv  body: { csv: string, supplier?: string }
// Accepts the supplier-side CSV with shipping cost per order. Extracts per-SKU
// cost from single-item orders and writes it as PricebookVariantCostOverride
// scoped by (country, carrier). Updates ProductVariant.baseCost as fallback.
router.post('/import-cost-csv', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const { csv, supplier } = req.body || {};
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'csv (string) is required in body' });
    }
    const result = await importCostCsv(userId, storeId, csv, { supplier });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/backfill-carriers  body: { windowDays? }
router.post('/backfill-carriers', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const days = parseInt(req.body?.windowDays ?? '30', 10);
    const result = await backfillShippingCompaniesFromTracking(storeId, isNaN(days) ? 30 : days);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/seed-pricebooks  body: { supplier?, shippingCompany?, currency? }
router.post('/seed-pricebooks', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const result = await seedDefaultPricebooks(userId, storeId, req.body || {});
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/by-period?from=...&to=...&period=day|week|month|quarter|year
router.get('/by-period', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const period = (req.query.period as PeriodKind) || 'day';
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(period)) {
      return res.status(400).json({ error: 'period must be day|week|month|quarter|year' });
    }
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(to.getTime() - 90 * 86400000));
    const buckets = await aggregateByPeriod(userId, storeId, from, to, period);
    res.json({ period, buckets });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// GET /api/pl/compare?from=...&to=...&period=day|week|month|quarter|year
router.get('/compare', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const period = (req.query.period as PeriodKind) || 'day';
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(period)) {
      return res.status(400).json({ error: 'period must be day|week|month|quarter|year' });
    }
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(to.getTime() - 30 * 86400000));
    const result = await compareTwoPeriods(userId, storeId, from, to, period);
    res.json({ period, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/sync-balances  body: { since, until }
router.post('/sync-balances', async (req, res) => {
  try {
    const { storeId } = req.resolved!;
    const { since, until } = req.body || {};
    if (!since || !until) return res.status(400).json({ error: 'since and until are required' });
    const result = await syncBalanceTransactions(storeId, new Date(since), new Date(until));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// /sync-fb endpoint removed: legacy FacebookAdAccount + FacebookAdSpend tables
// dropped. Per-store FB spend is now resolved via CampaignStoreMapping → live
// cache (today) or FacebookAdInsightSnapshot (past days). See campaign-mapping
// flow under /api/facebook.

// GET /api/pl/operating-cost?from=...&to=...
router.get('/operating-cost', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const from = parseDate(req.query.from, new Date(Date.now() - 30 * 86400000));
    const to = parseDate(req.query.to, new Date());
    const items = await prisma.operatingCost.findMany({
      where: { userId, storeId, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' }
    });
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// POST /api/pl/operating-cost  body: { date, category, amount, description?, currency? }
router.post('/operating-cost', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const { date, category, amount, description, currency } = req.body || {};
    if (!date || !category || amount === undefined) {
      return res.status(400).json({ error: 'date, category, amount are required' });
    }
    const cost = await prisma.operatingCost.create({
      data: {
        userId,
        storeId,
        date: new Date(date),
        category,
        description: description ?? null,
        amount: new Prisma.Decimal(amount),
        currency: currency ?? 'USD'
      }
    });
    res.json(cost);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// PUT /api/pl/operating-cost/:id
router.put('/operating-cost/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, category, amount, description, currency } = req.body || {};
    const cost = await prisma.operatingCost.update({
      where: { id },
      data: {
        ...(date !== undefined ? { date: new Date(date) } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(amount !== undefined ? { amount: new Prisma.Decimal(amount) } : {}),
        ...(currency !== undefined ? { currency } : {})
      }
    });
    res.json(cost);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// DELETE /api/pl/operating-cost/:id
router.delete('/operating-cost/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.operatingCost.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

export default router;
