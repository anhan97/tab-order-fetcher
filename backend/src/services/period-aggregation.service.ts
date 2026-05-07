import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export type PeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodBucket {
  periodKey: string; // 'YYYY-MM-DD' for day, 'YYYY-Www' for week, 'YYYY-MM', 'YYYY-Qq', 'YYYY'
  periodStart: string; // ISO date for the first day of the period
  periodEnd: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  basecost: number;
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  grossProfit: number;
  netProfit: number;
  orderCount: number;
}

const num = (v: Prisma.Decimal | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : v.toNumber();
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function bucketKey(kind: PeriodKind, date: Date): { key: string; start: Date; end: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (kind) {
    case 'day': {
      const start = new Date(Date.UTC(y, m, d));
      const end = new Date(Date.UTC(y, m, d + 1));
      return { key: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, start, end };
    }
    case 'week': {
      // ISO week: Monday-start. Date.UTC weekday: 0=Sun..6=Sat.
      const dow = (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7; // Mon=0
      const start = new Date(Date.UTC(y, m, d - dow));
      const end = new Date(start.getTime() + 7 * 86400000);
      const isoYear = start.getUTCFullYear();
      const yearStart = new Date(Date.UTC(isoYear, 0, 1));
      const ywdow = (yearStart.getUTCDay() + 6) % 7;
      const week1Mon = new Date(Date.UTC(isoYear, 0, 1 - ywdow + (ywdow > 3 ? 7 : 0)));
      const weekNum = Math.floor((start.getTime() - week1Mon.getTime()) / (7 * 86400000)) + 1;
      return { key: `${isoYear}-W${String(weekNum).padStart(2, '0')}`, start, end };
    }
    case 'month': {
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 1));
      return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start, end };
    }
    case 'quarter': {
      const q = Math.floor(m / 3) + 1;
      const start = new Date(Date.UTC(y, (q - 1) * 3, 1));
      const end = new Date(Date.UTC(y, q * 3, 1));
      return { key: `${y}-Q${q}`, start, end };
    }
    case 'year': {
      const start = new Date(Date.UTC(y, 0, 1));
      const end = new Date(Date.UTC(y + 1, 0, 1));
      return { key: `${y}`, start, end };
    }
  }
}

export async function aggregateByPeriod(
  userId: string,
  storeId: string,
  from: Date,
  to: Date,
  kind: PeriodKind
): Promise<PeriodBucket[]> {
  const snapshots = await prisma.dailyPLSnapshot.findMany({
    where: {
      userId,
      storeId,
      date: {
        gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())),
        lte: new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
      }
    },
    orderBy: { date: 'asc' }
  });

  const buckets = new Map<string, PeriodBucket>();
  for (const s of snapshots) {
    const { key, start, end } = bucketKey(kind, s.date);
    let b = buckets.get(key);
    if (!b) {
      b = {
        periodKey: key,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        grossRevenue: 0, refunds: 0, netRevenue: 0, basecost: 0,
        paymentFees: 0, fbAdSpend: 0, otherAdSpend: 0, appFees: 0, operatingCost: 0,
        grossProfit: 0, netProfit: 0, orderCount: 0
      };
      buckets.set(key, b);
    }
    b.grossRevenue += num(s.grossRevenue);
    b.refunds += num(s.refunds);
    b.netRevenue += num(s.netRevenue);
    b.basecost += num(s.basecost);
    b.paymentFees += num(s.paymentFees);
    b.fbAdSpend += num(s.fbAdSpend);
    b.otherAdSpend += num(s.otherAdSpend);
    b.appFees += num(s.appFees);
    b.operatingCost += num(s.operatingCost);
    b.grossProfit += num(s.grossProfit);
    b.netProfit += num(s.netProfit);
    b.orderCount += s.orderCount;
  }

  return Array.from(buckets.values())
    .map(b => ({
      ...b,
      grossRevenue: r2(b.grossRevenue), refunds: r2(b.refunds), netRevenue: r2(b.netRevenue),
      basecost: r2(b.basecost), paymentFees: r2(b.paymentFees),
      fbAdSpend: r2(b.fbAdSpend), otherAdSpend: r2(b.otherAdSpend), appFees: r2(b.appFees), operatingCost: r2(b.operatingCost),
      grossProfit: r2(b.grossProfit), netProfit: r2(b.netProfit)
    }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/**
 * Compare a current window against the immediately-prior window of equal length.
 * Returns both windows as PeriodBucket arrays plus a totals delta object so the
 * UI can render trend arrows / % changes.
 */
export async function compareTwoPeriods(
  userId: string,
  storeId: string,
  from: Date,
  to: Date,
  kind: PeriodKind
): Promise<{
  current: PeriodBucket[];
  previous: PeriodBucket[];
  totals: {
    current: Omit<PeriodBucket, 'periodKey' | 'periodStart' | 'periodEnd'>;
    previous: Omit<PeriodBucket, 'periodKey' | 'periodStart' | 'periodEnd'>;
    deltaPct: Record<string, number | null>; // null when previous = 0
  };
}> {
  const lengthMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);

  const [current, previous] = await Promise.all([
    aggregateByPeriod(userId, storeId, from, to, kind),
    aggregateByPeriod(userId, storeId, prevFrom, prevTo, kind)
  ]);

  const sumOf = (rows: PeriodBucket[]) => rows.reduce((acc, r) => {
    acc.grossRevenue += r.grossRevenue;
    acc.refunds += r.refunds;
    acc.netRevenue += r.netRevenue;
    acc.basecost += r.basecost;
    acc.paymentFees += r.paymentFees;
    acc.fbAdSpend += r.fbAdSpend;
    acc.otherAdSpend += r.otherAdSpend;
    acc.appFees += r.appFees;
    acc.operatingCost += r.operatingCost;
    acc.grossProfit += r.grossProfit;
    acc.netProfit += r.netProfit;
    acc.orderCount += r.orderCount;
    return acc;
  }, {
    grossRevenue: 0, refunds: 0, netRevenue: 0, basecost: 0,
    paymentFees: 0, fbAdSpend: 0, otherAdSpend: 0, appFees: 0, operatingCost: 0,
    grossProfit: 0, netProfit: 0, orderCount: 0
  });

  const cur = sumOf(current);
  const prev = sumOf(previous);
  const round = (o: any) => {
    const out: any = {};
    for (const k of Object.keys(o)) out[k] = k === 'orderCount' ? o[k] : r2(o[k]);
    return out;
  };

  const deltaPct: Record<string, number | null> = {};
  for (const k of Object.keys(cur) as Array<keyof typeof cur>) {
    const c = cur[k]; const p = prev[k];
    if (p === 0) deltaPct[k] = c === 0 ? 0 : null;
    else deltaPct[k] = r2(((c - p) / Math.abs(p)) * 100);
  }

  return {
    current,
    previous,
    totals: { current: round(cur), previous: round(prev), deltaPct }
  };
}
