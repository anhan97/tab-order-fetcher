import { PrismaClient, Prisma } from '@prisma/client';
import { storeHasMappings, computeStoreFbSpendForDay, computeStoreFbMetricsForDay } from './campaign-mapping.service';

const prisma = new PrismaClient();

export interface PLBreakdown {
  // revenue (Shopify Order.total includes shipping charged to customer)
  grossRevenue: number;
  refunds: number;
  discounts: number;
  taxCollected: number;
  netRevenue: number;
  // costs — Basecost = sum(line.unitBasecost * qty); supplier shipping baked in.
  basecost: number;
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  // profit
  grossProfit: number;
  netProfit: number;
  // counts
  orderCount: number;
  refundedOrderCount: number;
  // ── FB ad metrics (live cache only — historical snapshot rows leave these
  // null/0 because DailyPLSnapshot doesn't persist them; frontend renders
  // dashes for older days). Driven by computeStoreFbMetricsForDay → sums
  // the mapped campaigns from the live FB cache for the given day.
  fbImpressions?: number;
  fbClicks?: number;
  fbLinkClicks?: number;
  fbPurchases?: number;
  fbPurchaseValue?: number;
}

/**
 * Returns the [start, end) UTC instants that bracket a single calendar day in
 * the store's local timezone. tzOffsetMinutes follows the convention "minutes
 * BEHIND UTC" — GMT-6 (CST) is 360, GMT+7 (ICT) is -420. Defaults to 0 (UTC).
 *
 * The input `date` is treated as a CALENDAR DATE (Y/M/D extracted via UTC
 * fields). The time portion is ignored. Callers that want to address "today
 * in store-local tz" must pass a Date whose UTC Y/M/D match that local day —
 * use `localCalendarDateUTC(now, tz)` for that.
 */
function dayBoundsUTC(date: Date, tzOffsetMinutes: number = 0): { start: Date; end: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  // Local midnight in tz = UTC midnight + tzOffsetMinutes (e.g. GMT-6 → +360 min)
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) + tzOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Convert an arbitrary instant into a "calendar date marker" in the store's
 * local timezone — a Date whose UTC Y/M/D match the local Y/M/D of that
 * instant. This is what aggregateForDate / recomputeRange expect.
 */
export function localCalendarDateUTC(instant: Date, tzOffsetMinutes: number = 0): Date {
  // local time = instant - tzOffsetMinutes (since offset is "behind UTC")
  const local = new Date(instant.getTime() - tzOffsetMinutes * 60_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Parse a timezone string into "minutes west of UTC" — the convention used
 * everywhere in the P&L pipeline.
 *
 * Convention: positive = west of UTC. America/Los_Angeles (UTC-8 in PST) → 480.
 * Asia/Saigon (UTC+7) → -420.
 *
 * Accepts:
 *   - numeric string ('360', '-420')
 *   - POSIX 'Etc/GMT±N' (note: POSIX inverts sign: 'Etc/GMT+6' = UTC-6 → 360)
 *   - 'UTC±N' / 'GMT±N' (display convention: 'GMT-6' = UTC-6 → 360)
 *   - IANA names ('Asia/Saigon', 'America/Los_Angeles', 'Europe/London') —
 *     resolved via Intl.DateTimeFormat so DST is handled per the date.
 *   - undefined / unknown → 0 (UTC)
 *
 * IANA support is critical so day-bound queries align with the Shopify store
 * timezone (Shopify orders carry processed_at in UTC but the merchant thinks
 * in store-local days). Without it, a VN store sees order timestamps shifted
 * by 7 hours.
 */
export function parseTzOffsetMinutes(tz?: string | null): number {
  if (!tz) return 0;
  if (typeof tz === 'number' || /^-?\d+$/.test(tz)) return parseInt(String(tz), 10);
  // POSIX 'Etc/GMT+N' is actually UTC-N. So +6 means west, returns 360.
  const m = tz.match(/^Etc\/GMT([+-]?\d+)$/);
  if (m) return parseInt(m[1], 10) * 60;
  // Plain 'GMT-6' / 'UTC+7' style
  const m2 = tz.match(/^(?:UTC|GMT)([+-]\d+)$/i);
  if (m2) return -parseInt(m2[1], 10) * 60; // GMT-6 means west, returns 360

  // IANA tz: ask Intl what offset it's currently producing. Catches DST.
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = dtf.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
    // Format like 'GMT+7', 'GMT-08:00', 'GMT'.
    if (tzPart === 'GMT' || tzPart === 'UTC') return 0;
    const ianaMatch = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (ianaMatch) {
      const sign = ianaMatch[1] === '-' ? 1 : -1; // GMT+7 means UTC+7 → returns -420
      const hours = parseInt(ianaMatch[2], 10);
      const mins = ianaMatch[3] ? parseInt(ianaMatch[3], 10) : 0;
      return sign * (hours * 60 + mins);
    }
  } catch {
    // Unknown IANA name → fall through to 0.
  }
  return 0;
}

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: Prisma.Decimal | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : v.toNumber();
};

/**
 * Aggregate raw P&L numbers for a single (userId, storeId, date).
 * Pure function over already-synced DB data — does not call Shopify/FB.
 */
export async function aggregateForDate(userId: string, storeId: string, date: Date, tzOffsetMinutes: number = 0): Promise<PLBreakdown> {
  const { start, end } = dayBoundsUTC(date, tzOffsetMinutes);

  // Orders processed this day (excluding ones cancelled before processing — kept simple: include if processedAt is within day)
  const orders = await prisma.order.findMany({
    where: {
      userId,
      storeId,
      processedAt: { gte: start, lt: end }
    },
    select: {
      id: true,
      totalAmount: true,
      subtotalPrice: true,
      totalDiscounts: true,
      totalTax: true,
      cancelledAt: true,
      lineItems: {
        select: { quantity: true, unitBasecost: true }
      }
    }
  });

  let grossRevenue = 0;
  let discounts = 0;
  let taxCollected = 0;
  let basecost = 0;
  let orderCount = 0;

  for (const o of orders) {
    if (o.cancelledAt && o.cancelledAt >= start && o.cancelledAt < end) continue; // cancelled same day, exclude
    grossRevenue += num(o.totalAmount); // already includes shipping charged to customer
    discounts += num(o.totalDiscounts);
    taxCollected += num(o.totalTax);
    orderCount++;
    for (const li of o.lineItems) {
      if (li.unitBasecost !== null && li.unitBasecost !== undefined) {
        basecost += num(li.unitBasecost) * (li.quantity || 0);
      }
    }
  }

  // Refunds attributed to the day they were processed (not original order day).
  const refundTxs = await prisma.orderTransaction.findMany({
    where: {
      userId,
      storeId,
      kind: 'refund',
      status: 'success',
      processedAt: { gte: start, lt: end }
    },
    select: { amount: true, orderId: true }
  });
  const refunds = refundTxs.reduce((s, t) => s + num(t.amount), 0);
  const refundedOrderCount = new Set(refundTxs.map(t => t.orderId)).size;

  // Payment fees: sum fee from ALL successful transactions on this day (sale fee on sale day, refund-fee adjustment on refund day).
  const feeTxs = await prisma.orderTransaction.findMany({
    where: {
      userId,
      storeId,
      status: 'success',
      processedAt: { gte: start, lt: end }
    },
    select: { fee: true, kind: true }
  });
  const paymentFees = feeTxs.reduce((s, t) => {
    const sign = t.kind === 'refund' ? -1 : 1;
    return s + sign * num(t.fee);
  }, 0);

  // Facebook ad spend — always mapping-based now. Sums spend across the
  // CampaignStoreMapping rows for this (userId, storeId), reading from the
  // shared 5min FB cache for today and FacebookAdInsightSnapshot for past
  // days. Stores with NO mappings → 0 (legitimate state for stores that
  // don't run ads). The legacy account-level FacebookAdSpend table has
  // been dropped.
  let fbAdSpend = 0;
  // Optional FB-side metrics (impressions / clicks / link-clicks / pixel
  // purchases / pixel revenue). Populated from the live cache only — DB
  // snapshots don't carry these yet. Frontend uses them to render CPC,
  // CTR, CVR, ROAS, CPM in the Daily breakdown.
  let fbImpressions = 0;
  let fbClicks = 0;
  let fbLinkClicks = 0;
  let fbPurchases = 0;
  let fbPurchaseValue = 0;
  if (await storeHasMappings(userId, storeId)) {
    const m = await computeStoreFbMetricsForDay(userId, storeId, date);
    fbAdSpend = m.spend;
    fbImpressions = m.impressions;
    fbClicks = m.clicks;
    fbLinkClicks = m.linkClicks;
    fbPurchases = m.purchases;
    fbPurchaseValue = m.purchaseValue;
    // Fallback: if metrics call returned 0 spend (cache miss + snapshot fallback
    // doesn't carry full metrics), still surface the spend via the legacy path
    // so historical days remain accurate.
    if (fbAdSpend === 0) {
      fbAdSpend = await computeStoreFbSpendForDay(userId, storeId, date);
    }
  }

  // Operating cost — split categories so the UI can show them separately:
  //   other_ads → otherAdSpend (Google/TikTok/etc)
  //   app_fee   → appFees      (Shopify/SaaS app subscriptions)
  //   else      → operatingCost (salary, domain, misc)
  //
  // OperatingCost rows are calendar-day records (the UI inputs them as
  // "April 15", saved as UTC-midnight of that calendar day). Query them by
  // calendar bounds, NOT the tz-shifted instant bounds — otherwise op_costs
  // for the same calendar day fall outside the bucket when tz is shifted.
  const calStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const calEnd = new Date(calStart.getTime() + 24 * 60 * 60 * 1000);
  const opCosts = await prisma.operatingCost.findMany({
    where: { userId, storeId, date: { gte: calStart, lt: calEnd } },
    select: { amount: true, category: true }
  });
  let otherAdSpend = 0;
  let appFees = 0;
  let operatingCost = 0;
  for (const c of opCosts) {
    const amt = num(c.amount);
    if (c.category === 'other_ads') otherAdSpend += amt;
    else if (c.category === 'app_fee') appFees += amt;
    else operatingCost += amt;
  }

  const netRevenue = grossRevenue - refunds - taxCollected;
  const grossProfit = netRevenue - basecost - paymentFees;
  const netProfit = grossProfit - fbAdSpend - otherAdSpend - appFees - operatingCost;

  return {
    grossRevenue: round(grossRevenue),
    refunds: round(refunds),
    discounts: round(discounts),
    taxCollected: round(taxCollected),
    netRevenue: round(netRevenue),
    basecost: round(basecost),
    paymentFees: round(paymentFees),
    fbAdSpend: round(fbAdSpend),
    otherAdSpend: round(otherAdSpend),
    appFees: round(appFees),
    operatingCost: round(operatingCost),
    grossProfit: round(grossProfit),
    netProfit: round(netProfit),
    orderCount,
    refundedOrderCount,
    fbImpressions,
    fbClicks,
    fbLinkClicks,
    fbPurchases,
    fbPurchaseValue: round(fbPurchaseValue)
  };
}

export async function computeAndSaveForDate(
  userId: string,
  storeId: string,
  date: Date,
  tzOffsetMinutes: number = 0,
  options: { finalize?: boolean } = {}
): Promise<PLBreakdown> {
  const breakdown = await aggregateForDate(userId, storeId, date, tzOffsetMinutes);

  // Store snapshot keyed by local CALENDAR DATE (UTC midnight of Y/M/D, no
  // tz offset baked in). This way the unique constraint `(userId, storeId, date)`
  // prevents duplicates when the user recomputes with a different tz.
  const calendarKey = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

  await prisma.dailyPLSnapshot.upsert({
    where: {
      userId_storeId_date: { userId, storeId, date: calendarKey }
    },
    create: {
      userId,
      storeId,
      date: calendarKey,
      currency: 'USD',
      isFinalized: !!options.finalize,
      ...toDecimals(breakdown)
    },
    update: {
      ...toDecimals(breakdown),
      ...(options.finalize ? { isFinalized: true } : {}),
      computedAt: new Date()
    }
  });

  return breakdown;
}

// --- Today live (no DB write) -----------------------------------------------

interface TodayCacheEntry {
  computedAt: number;
  breakdown: PLBreakdown;
  date: string;       // YYYY-MM-DD local calendar marker
  tzOffsetMinutes: number;
}
const TODAY_TTL_MS = 5 * 60 * 1000;
const todayCache = new Map<string, TodayCacheEntry>();
const todayCacheKey = (userId: string, storeId: string) => `${userId}:${storeId}`;

/**
 * Compute today's P&L live, on the fly. Memoised per (user, store) for 5min.
 * NEVER writes to DailyPLSnapshot — today's row is owned by the EOD finalize
 * cron tomorrow. This is called by GET /api/pl/today and merged into the
 * snapshot list when the requested range includes today.
 */
export async function getTodayLive(userId: string, storeId: string, tzOffsetMinutes: number = 0): Promise<{
  breakdown: PLBreakdown;
  date: string;
  computedAt: string;
  ageSeconds: number;
}> {
  const today = localCalendarDateUTC(new Date(), tzOffsetMinutes);
  const dateKey = today.toISOString().slice(0, 10);
  const k = todayCacheKey(userId, storeId);
  const cached = todayCache.get(k);
  const now = Date.now();
  if (cached && cached.date === dateKey && now - cached.computedAt < TODAY_TTL_MS) {
    return {
      breakdown: cached.breakdown,
      date: cached.date,
      computedAt: new Date(cached.computedAt).toISOString(),
      ageSeconds: Math.round((now - cached.computedAt) / 1000)
    };
  }
  const breakdown = await aggregateForDate(userId, storeId, today, tzOffsetMinutes);
  todayCache.set(k, { computedAt: now, breakdown, date: dateKey, tzOffsetMinutes });
  return { breakdown, date: dateKey, computedAt: new Date(now).toISOString(), ageSeconds: 0 };
}

/** Invalidate the today cache for a store (e.g. after manual recompute). */
export function invalidateTodayCache(userId: string, storeId: string): void {
  todayCache.delete(todayCacheKey(userId, storeId));
}

/**
 * EOD finalize for ONE store: compute & save the previous local day's snapshot
 * with isFinalized=true. Called by the EOD scheduler tick when a store crosses
 * midnight in its local TZ.
 */
export async function finalizeYesterday(
  userId: string,
  storeId: string,
  tzOffsetMinutes: number = 0
): Promise<PLBreakdown> {
  const today = localCalendarDateUTC(new Date(), tzOffsetMinutes);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  invalidateTodayCache(userId, storeId);
  return computeAndSaveForDate(userId, storeId, yesterday, tzOffsetMinutes, { finalize: true });
}

function toDecimals(b: PLBreakdown) {
  return {
    grossRevenue: new Prisma.Decimal(b.grossRevenue),
    refunds: new Prisma.Decimal(b.refunds),
    discounts: new Prisma.Decimal(b.discounts),
    taxCollected: new Prisma.Decimal(b.taxCollected),
    netRevenue: new Prisma.Decimal(b.netRevenue),
    basecost: new Prisma.Decimal(b.basecost),
    paymentFees: new Prisma.Decimal(b.paymentFees),
    fbAdSpend: new Prisma.Decimal(b.fbAdSpend),
    otherAdSpend: new Prisma.Decimal(b.otherAdSpend),
    appFees: new Prisma.Decimal(b.appFees),
    operatingCost: new Prisma.Decimal(b.operatingCost),
    grossProfit: new Prisma.Decimal(b.grossProfit),
    netProfit: new Prisma.Decimal(b.netProfit),
    orderCount: b.orderCount,
    refundedOrderCount: b.refundedOrderCount
  };
}

/**
 * Recompute P&L snapshots for a date range.
 * Used by daily cron (rolling 7-day window) and manual rebuild.
 */
/**
 * Iterate calendar days [fromDate, toDate] in store-local tz and recompute each.
 * Inputs are interpreted as CALENDAR DATES via UTC Y/M/D (matches the date-picker
 * format `2026-05-01T00:00:00Z`). For "now"-style instants from cron, callers
 * must pre-convert with `localCalendarDateUTC(new Date(), tz)`.
 */
export async function recomputeRange(userId: string, storeId: string, fromDate: Date, toDate: Date, tzOffsetMinutes: number = 0): Promise<{ days: number }> {
  // Build calendar markers from UTC fields directly — no shifting.
  const fromCal = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0, 0));
  const toCal = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 0, 0, 0, 0));
  let cursor = fromCal;
  let days = 0;
  while (cursor.getTime() <= toCal.getTime()) {
    await computeAndSaveForDate(userId, storeId, cursor, tzOffsetMinutes);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    days++;
  }
  return { days };
}

export async function listSnapshots(userId: string, storeId: string, from: Date, to: Date, _tzOffsetMinutes: number = 0) {
  // Snapshot.date is now a calendar marker (UTC midnight of local Y/M/D).
  // tz offset is no longer baked into the stored date, so just match on the
  // calendar markers directly.
  const fromCal = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0));
  const toCal = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 0, 0, 0, 0));
  return prisma.dailyPLSnapshot.findMany({
    where: { userId, storeId, date: { gte: fromCal, lte: toCal } },
    orderBy: { date: 'asc' }
  });
}

/**
 * Recompute snapshots for ALL active stores belonging to a user — used by cron.
 */
export async function recomputeRecentForUser(userId: string, daysBack: number = 7): Promise<{ stores: number; days: number }> {
  const stores = await prisma.shopifyStore.findMany({
    where: { userId, isActive: true },
    select: { id: true }
  });
  const today = new Date();
  const from = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
  let totalDays = 0;
  for (const s of stores) {
    const r = await recomputeRange(userId, s.id, from, today);
    totalDays += r.days;
  }
  return { stores: stores.length, days: totalDays };
}
