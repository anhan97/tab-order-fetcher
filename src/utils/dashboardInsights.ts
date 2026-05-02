import { Order } from '@/types/order';

export interface DashboardInsights {
  // Headline rates
  netProfitMargin: number;          // (netProfit / revenue) * 100
  refundRate: number;                // share of orders flagged refunded / partially refunded
  cancelRate: number;                // share of orders cancelled
  repeatCustomerRate: number;        // share of customers placing >1 order in window
  effectiveFeeRate: number;          // payment fees / revenue * 100
  fulfillmentRate: number;           // share of paid orders that are fulfilled
  averageItemsPerOrder: number;      // total qty / orders

  // Volume / value
  uniqueCustomers: number;
  newCustomers: number;
  returningCustomers: number;

  // Lists
  topProducts: ProductInsight[];     // ranked by revenue
  topCountries: CountryInsight[];    // ranked by order count
  topVariants: VariantInsight[];     // ranked by units sold
}

export interface ProductInsight {
  sku: string;
  name: string;
  units: number;
  revenue: number;
  orders: number;
}

export interface CountryInsight {
  countryCode: string;
  countryName: string;
  orders: number;
  revenue: number;
}

export interface VariantInsight {
  variantId: string;
  sku: string;
  productName: string;
  style: string;
  units: number;
  revenue: number;
}

export interface InsightInput {
  orders: Order[];
  revenue: number;
  netProfit: number;
  totalFees?: number;
}

const REFUND_STATUSES = new Set(['refunded', 'partially_refunded']);
const CANCEL_STATUSES = new Set(['voided', 'cancelled', 'canceled']);

/**
 * Compute the "Tier 1" insight pack for the Dashboard.
 *
 * Pure function — given a slice of orders + already-computed revenue/profit,
 * returns rates and ranked lists. Use one window's orders at a time; do not
 * pass a multi-window mix because repeatCustomerRate is window-scoped.
 */
export function computeDashboardInsights(input: InsightInput): DashboardInsights {
  const { orders, revenue, netProfit, totalFees = 0 } = input;
  const orderCount = orders.length;

  // Margin & fees
  const netProfitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const effectiveFeeRate = revenue > 0 ? (totalFees / revenue) * 100 : 0;

  // Per-order status rates
  let refunded = 0;
  let cancelled = 0;
  let fulfilledPaid = 0;
  let totalPaid = 0;
  let totalUnits = 0;

  // Aggregations
  const customerOrderCount = new Map<string, number>();
  const productAgg = new Map<string, ProductInsight>();
  const variantAgg = new Map<string, VariantInsight>();
  const countryAgg = new Map<string, CountryInsight>();

  for (const order of orders) {
    const fin = (order.financialStatus || '').toLowerCase();
    const ful = (order.fulfillmentStatus || '').toLowerCase();
    if (REFUND_STATUSES.has(fin)) refunded += 1;
    if (CANCEL_STATUSES.has(fin)) cancelled += 1;
    if (fin === 'paid') {
      totalPaid += 1;
      if (ful === 'fulfilled') fulfilledPaid += 1;
    }

    // Customer tally — prefer email, fallback to "name|phone" so anonymous
    // checkouts still group per shopper instead of all collapsing to "".
    const custKey = (order.customerEmail || `${order.customerName || ''}|${order.shippingAddress?.phone || ''}`).toLowerCase();
    if (custKey.trim()) {
      customerOrderCount.set(custKey, (customerOrderCount.get(custKey) || 0) + 1);
    }

    // Country bucket
    const cc = (order.shippingAddress?.country || 'Unknown').toUpperCase();
    if (!countryAgg.has(cc)) {
      countryAgg.set(cc, {
        countryCode: cc,
        countryName: countryDisplayName(cc),
        orders: 0,
        revenue: 0
      });
    }
    const cBucket = countryAgg.get(cc)!;
    cBucket.orders += 1;
    cBucket.revenue += order.totalPrice || 0;

    // Line item rollups
    for (const li of order.lineItems || []) {
      const lineRev = (li.price || 0) * (li.quantity || 0);
      totalUnits += li.quantity || 0;

      // Product roll-up by SKU prefix (PB-RED & PB-BLACK both group under "PB")
      // — falls back to title when SKU missing. We still surface the most
      // common variant title so the bar isn't blank.
      const productKey = (li.sku || li.title || 'unknown').split('-')[0] || 'unknown';
      if (!productAgg.has(productKey)) {
        productAgg.set(productKey, {
          sku: productKey,
          name: li.title || productKey,
          units: 0,
          revenue: 0,
          orders: 0
        });
      }
      const pBucket = productAgg.get(productKey)!;
      pBucket.units += li.quantity || 0;
      pBucket.revenue += lineRev;
      pBucket.orders += 1;

      // Variant roll-up — keyed on variantId so PB-RED/M and PB-RED/L don't merge
      const vKey = li.variantId || `${li.sku}|${li.title}`;
      if (!variantAgg.has(vKey)) {
        variantAgg.set(vKey, {
          variantId: li.variantId || '',
          sku: li.sku || '',
          productName: li.title || '',
          style: order.style || '',
          units: 0,
          revenue: 0
        });
      }
      const vBucket = variantAgg.get(vKey)!;
      vBucket.units += li.quantity || 0;
      vBucket.revenue += lineRev;
    }
  }

  const refundRate = orderCount > 0 ? (refunded / orderCount) * 100 : 0;
  const cancelRate = orderCount > 0 ? (cancelled / orderCount) * 100 : 0;
  const fulfillmentRate = totalPaid > 0 ? (fulfilledPaid / totalPaid) * 100 : 0;
  const averageItemsPerOrder = orderCount > 0 ? totalUnits / orderCount : 0;

  const uniqueCustomers = customerOrderCount.size;
  let returningCustomers = 0;
  for (const v of customerOrderCount.values()) if (v > 1) returningCustomers += 1;
  const newCustomers = uniqueCustomers - returningCustomers;
  const repeatCustomerRate = uniqueCustomers > 0 ? (returningCustomers / uniqueCustomers) * 100 : 0;

  return {
    netProfitMargin,
    refundRate,
    cancelRate,
    repeatCustomerRate,
    effectiveFeeRate,
    fulfillmentRate,
    averageItemsPerOrder,
    uniqueCustomers,
    newCustomers,
    returningCustomers,
    topProducts: Array.from(productAgg.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    topCountries: Array.from(countryAgg.values())
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5),
    topVariants: Array.from(variantAgg.values())
      .sort((a, b) => b.units - a.units)
      .slice(0, 5)
  };
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  USA: 'United States',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  IE: 'Ireland',
  NL: 'Netherlands',
  BE: 'Belgium',
  SE: 'Sweden',
  DK: 'Denmark',
  NO: 'Norway',
  FI: 'Finland',
  CH: 'Switzerland',
  AT: 'Austria',
  PT: 'Portugal',
  PL: 'Poland',
  JP: 'Japan',
  SG: 'Singapore',
  HK: 'Hong Kong',
  MY: 'Malaysia',
  PH: 'Philippines',
  VN: 'Vietnam',
  TH: 'Thailand',
  ID: 'Indonesia',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico'
};

function countryDisplayName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}
