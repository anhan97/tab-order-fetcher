/**
 * Ecommerce KPIs from daily P&L rows (/api/pl/daily). Pure, so the KPI cards,
 * the daily table and its total row all agree.
 *
 * Ratios are computed from SUMS, never averaged across days (the average of
 * daily MERs is not the MER of the period). A ratio whose denominator is zero
 * is null — shown as "—", never as 0 or Infinity.
 */

export interface DayPL {
  /** YYYY-MM-DD, store timezone. */
  date: string;
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
  /** Facebook-reported purchase value; null for days Meta data is not kept. */
  fbPurchaseValue: number | null;
  fbPurchases: number | null;
}

export interface EcomMetrics {
  revenue: number;
  orders: number;
  /** Average order value. */
  aov: number | null;
  /** Facebook + other ads. */
  adSpend: number;
  /** Marketing efficiency ratio: revenue / all ad spend. */
  mer: number | null;
  /**
   * MER at which net profit is zero: revenue / (net profit + ad spend). Above
   * it the period makes money. Null when even zero ad spend would lose money.
   */
  breakEvenMer: number | null;
  /** Facebook-reported ROAS (purchase value / FB spend), only over days that carry it. */
  roas: number | null;
  /** Blended cost per order: all ad spend / orders. */
  cpa: number | null;
  cogs: number;
  cogsPct: number | null;
  /** Payment fees + app fees + operating costs. */
  otherCosts: number;
  grossProfit: number;
  grossMargin: number | null;
  netProfit: number;
  /** Net profit / revenue. */
  profitPct: number | null;
  profitPerOrder: number | null;
  /** Refunds / gross revenue. */
  refundRate: number | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function metricsOf(days: readonly DayPL[]): EcomMetrics {
  const sum = (pick: (d: DayPL) => number) => days.reduce((s, d) => s + pick(d), 0);
  const revenue = sum(d => d.netRevenue);
  const grossRevenue = sum(d => d.grossRevenue);
  const orders = sum(d => d.orderCount);
  const fbSpend = sum(d => d.fbAdSpend);
  const adSpend = fbSpend + sum(d => d.otherAdSpend);
  const cogs = sum(d => d.basecost);
  const netProfit = sum(d => d.netProfit);
  const grossProfit = sum(d => d.grossProfit);
  const withRoas = days.filter(d => d.fbPurchaseValue != null);
  const roasSpend = withRoas.reduce((s, d) => s + d.fbAdSpend, 0);
  const beforeAds = netProfit + adSpend;
  return {
    revenue,
    orders,
    aov: ratio(revenue, orders),
    adSpend,
    mer: ratio(revenue, adSpend),
    breakEvenMer: ratio(revenue, beforeAds),
    roas: withRoas.length ? ratio(withRoas.reduce((s, d) => s + (d.fbPurchaseValue ?? 0), 0), roasSpend) : null,
    cpa: ratio(adSpend, orders),
    cogs,
    cogsPct: ratio(cogs, revenue),
    otherCosts: sum(d => d.paymentFees + d.appFees + d.operatingCost),
    grossProfit,
    grossMargin: ratio(grossProfit, revenue),
    netProfit,
    profitPct: ratio(netProfit, revenue),
    profitPerOrder: ratio(netProfit, orders),
    refundRate: ratio(sum(d => d.refunds), grossRevenue)
  };
}

/** Is the period making money on its ads? null when it cannot tell. */
export function merHealth(m: Pick<EcomMetrics, 'mer' | 'breakEvenMer' | 'adSpend'>): 'good' | 'bad' | null {
  if (m.adSpend <= 0 || m.mer == null) return null;
  if (m.breakEvenMer == null) return 'bad';
  return m.mer >= m.breakEvenMer ? 'good' : 'bad';
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));

/** One /api/pl/daily snapshot (Decimals arrive as strings) → DayPL. */
export function toDayPL(s: Record<string, unknown>): DayPL {
  const date = typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date as string).toISOString().slice(0, 10);
  return {
    date,
    grossRevenue: num(s.grossRevenue),
    refunds: num(s.refunds),
    netRevenue: num(s.netRevenue),
    basecost: num(s.basecost),
    paymentFees: num(s.paymentFees),
    fbAdSpend: num(s.fbAdSpend),
    otherAdSpend: num(s.otherAdSpend),
    appFees: num(s.appFees),
    operatingCost: num(s.operatingCost),
    grossProfit: num(s.grossProfit),
    netProfit: num(s.netProfit),
    orderCount: num(s.orderCount),
    fbPurchaseValue: numOrNull(s.fbPurchaseValue),
    fbPurchases: numOrNull(s.fbPurchases)
  };
}
