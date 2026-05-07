/**
 * P&L margin health checks. Pure functions over a totals snapshot — no
 * fetches, no side effects. Used by ProfitView to flag windows where the
 * store is leaking money before it's a quarterly surprise.
 *
 * Definitions used here:
 *   GPM (gross profit margin)        = grossProfit / netRevenue
 *   CM  (contribution margin)        = (netRevenue - COGS - shipping - fees - ads) / netRevenue
 *   NPM (net profit margin)          = netProfit / netRevenue
 *
 * GPM measures whether the unit economics work *before* paid acquisition.
 * CM measures whether the unit economics work *with* paid acquisition.
 * NPM is the bottom line after fixed OpEx.
 */

export interface PLTotals {
  netRevenue: number;
  grossProfit: number;
  netProfit: number;
  basecost: number;          // product + supplier shipping (per-unit landed cost × qty)
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  refunds: number;
  orderCount: number;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface MarginAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  actions: string[];
  metric: string;          // formatted value, e.g. "12.4%"
  metricNumeric: number;   // raw value (decimal, e.g. 0.124)
}

export interface ComputedMargins {
  gpm: number | null;        // null when netRevenue = 0
  cm: number | null;
  npm: number | null;
  variableCosts: number;     // basecost + fees + ads
  fixedCosts: number;        // appFees + operatingCost
  refundRate: number | null; // refunds / grossRevenue (if grossRevenue tracked) — fallback to refunds/netRevenue
}

/**
 * Compute the headline margin metrics. Returns null for any ratio whose
 * denominator is zero so callers can render "—" instead of NaN.
 */
export function computeMargins(t: PLTotals): ComputedMargins {
  const variableCosts = t.basecost + t.paymentFees + t.fbAdSpend + t.otherAdSpend;
  const fixedCosts = t.appFees + t.operatingCost;
  const gpm = t.netRevenue > 0 ? t.grossProfit / t.netRevenue : null;
  const cm = t.netRevenue > 0 ? (t.netRevenue - variableCosts) / t.netRevenue : null;
  const npm = t.netRevenue > 0 ? t.netProfit / t.netRevenue : null;
  const refundRate = t.netRevenue > 0 ? t.refunds / t.netRevenue : null;
  return { gpm, cm, npm, variableCosts, fixedCosts, refundRate };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Translate margin metrics into human-readable alerts with suggested
 * follow-up actions. Order of returned alerts is severity-first, then
 * by metric (so the user sees the worst issue first).
 */
export function detectMarginAlerts(t: PLTotals, margins: ComputedMargins = computeMargins(t)): MarginAlert[] {
  const out: MarginAlert[] = [];

  // No data — surface gently as info so the user doesn't think the alert
  // engine is broken.
  if (t.orderCount === 0 || t.netRevenue <= 0) {
    out.push({
      id: 'no-data',
      severity: 'info',
      title: 'No revenue in this window',
      detail: 'No orders have been recorded yet. If you expect data here, run "Sync orders + recompute" from the menu.',
      actions: ['Run Sync orders + recompute', 'Verify the date range matches your store timezone'],
      metric: '—',
      metricNumeric: 0
    });
    return out;
  }

  // Net profit < 0 is the most urgent — money is being burned.
  if (t.netProfit < 0) {
    out.push({
      id: 'net-loss',
      severity: 'critical',
      title: `Net loss ${pct(margins.npm ?? 0)}`,
      detail: `You are paying ${formatUsdAbs(-t.netProfit)} more than the store is earning. Top variable cost: ${biggestVariable(t)}.`,
      actions: [
        'Pause the worst-ROAS Facebook campaigns',
        'Check shipping cost — is the carrier auto-detect right?',
        'Confirm COGS pricebook is up-to-date with current supplier prices'
      ],
      metric: pct(margins.npm ?? 0),
      metricNumeric: margins.npm ?? 0
    });
  }

  // Contribution margin < 10% — paid traffic is eating most of the gross profit.
  if (margins.cm !== null && margins.cm < 0.10) {
    out.push({
      id: 'cm-critical',
      severity: 'critical',
      title: `Contribution margin ${pct(margins.cm)}`,
      detail: `Variable costs (COGS + shipping + fees + ads) consume ${pct(1 - margins.cm)} of revenue, leaving almost nothing for fixed costs.`,
      actions: [
        'Audit Facebook Ads Manager — kill ad sets with ROAS < 2',
        'Test a price increase on the bestseller and watch CVR',
        'Negotiate shipping rates or switch to a cheaper carrier on US/CA orders'
      ],
      metric: pct(margins.cm),
      metricNumeric: margins.cm
    });
  } else if (margins.cm !== null && margins.cm < 0.20) {
    out.push({
      id: 'cm-warning',
      severity: 'warning',
      title: `Contribution margin ${pct(margins.cm)} — running thin`,
      detail: 'Below 20% means a small ad-spend bump or supplier price hike will flip you into a loss.',
      actions: [
        'Review per-product net profit — drop products with margin < $5',
        'Check effective payment fee % for any unexpected refunds'
      ],
      metric: pct(margins.cm),
      metricNumeric: margins.cm
    });
  }

  // Gross profit margin tells you if the unit economics work *before* ads.
  // < 30% means even with free traffic you can barely cover fixed costs.
  if (margins.gpm !== null && margins.gpm < 0.30) {
    out.push({
      id: 'gpm-critical',
      severity: 'critical',
      title: `Gross margin ${pct(margins.gpm)}`,
      detail: 'COGS + shipping + payment fees are eating more than 70% of revenue. Unit economics are broken.',
      actions: [
        'Re-import the latest cost CSV — supplier prices may have moved',
        'Check the COGS column on the Dashboard — variants showing $0 baseCost?',
        'Run "Backfill carriers" so shipping pricebooks pick the right tier'
      ],
      metric: pct(margins.gpm),
      metricNumeric: margins.gpm
    });
  } else if (margins.gpm !== null && margins.gpm < 0.45) {
    out.push({
      id: 'gpm-warning',
      severity: 'warning',
      title: `Gross margin ${pct(margins.gpm)}`,
      detail: 'Healthy dropshipping is 50-65% gross margin. Below 45% leaves little room for ads and OpEx.',
      actions: [
        'Verify supplier overrides in pricebooks are still accurate',
        'Look at whether discounts/coupon abuse is shaving off revenue'
      ],
      metric: pct(margins.gpm),
      metricNumeric: margins.gpm
    });
  }

  // Refund rate watch
  if (margins.refundRate !== null && margins.refundRate > 0.05) {
    out.push({
      id: 'refund-rate',
      severity: margins.refundRate > 0.10 ? 'critical' : 'warning',
      title: `Refund rate ${pct(margins.refundRate)}`,
      detail: 'Refunds reduce both revenue and payment-fee recovery. Above 5% is unusual for dropshipping outside the Q4 holiday window.',
      actions: [
        'Pull the refund reasons from Shopify Admin — quality issue or shipping delay?',
        'Check if a specific SKU drives the refunds'
      ],
      metric: pct(margins.refundRate),
      metricNumeric: margins.refundRate
    });
  }

  // Sort: critical first, warning next, info last
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}

function biggestVariable(t: PLTotals): string {
  const items = [
    { name: 'Basecost', v: t.basecost },
    { name: 'Payment fees', v: t.paymentFees },
    { name: 'FB ads', v: t.fbAdSpend },
    { name: 'Other ads', v: t.otherAdSpend }
  ];
  const top = items.sort((a, b) => b.v - a.v)[0];
  return `${top.name} (${formatUsdAbs(top.v)})`;
}

function formatUsdAbs(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
}
