/**
 * What is owed to the supplier for a set of orders — pure, no database.
 *
 * Source: each line item's FROZEN cost (unitBasecost, with its product /
 * shipping split), captured when the order was costed. Using the frozen value
 * rather than today's price matrix means a statement sent to the supplier
 * still adds up the same next month, and it matches P&L COGS.
 *
 * Line items without a variant (custom items such as "Shipping protection")
 * have nothing to buy from a supplier and are ignored. A variant line with no
 * cost is MISSING: the order can't be settled until it is priced, otherwise
 * the payment silently comes out short.
 */

export interface CostLineItem {
  variantId: bigint | string | null;
  quantity: number;
  unitBasecost: unknown;      // Prisma.Decimal | number | string | null
  unitProductCost: unknown;
  unitShippingCost: unknown;
  title?: string | null;
  sku?: string | null;
  variantTitle?: string | null;
}

export interface CostOrder {
  id: string;
  orderNumber: string;
  supplier: string | null;
  shippingCompany: string | null;
  shippingCountryCode: string | null;
  fulfillStatus: string;
  supplierSettlementId: string | null;
  lineItems: CostLineItem[];
}

export interface OrderCost {
  product: number;
  shipping: number;
  total: number;
  units: number;
  /** Some variant line has no frozen cost — the order is not settleable. */
  missing: boolean;
  /** Some costed line predates the product/shipping split: its whole cost is
   *  counted as product. The total is still exact. */
  unsplit: boolean;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

export const supplierLabel = (o: { supplier: string | null }) => (o.supplier?.trim() || 'Default');

export function orderCost(o: { lineItems: CostLineItem[] }): OrderCost {
  let product = 0, shipping = 0, total = 0, units = 0;
  let missing = false, unsplit = false;
  for (const li of o.lineItems) {
    if (li.variantId === null || li.variantId === undefined) continue;
    const qty = li.quantity > 0 ? li.quantity : 0;
    units += qty;
    const unit = n(li.unitBasecost);
    if (unit === null) { missing = true; continue; }
    const p = n(li.unitProductCost);
    const s = n(li.unitShippingCost);
    if (p === null || s === null) {
      unsplit = true;
      product += unit * qty;
    } else {
      product += p * qty;
      shipping += s * qty;
    }
    total += unit * qty;
  }
  return { product: r2(product), shipping: r2(shipping), total: r2(total), units, missing, unsplit };
}

interface Bucket { key: string; orders: number; units: number; product: number; shipping: number; total: number; }

export interface CostSummary {
  orders: number;
  units: number;
  product: number;
  shipping: number;
  total: number;
  /** Orders that cannot be settled, and why. */
  missingCost: Array<{ id: string; orderNumber: string }>;
  alreadySettled: Array<{ id: string; orderNumber: string }>;
  cancelled: Array<{ id: string; orderNumber: string }>;
  unsplitOrders: number;
  suppliers: string[];
  bySupplier: Bucket[];
  byCarrier: Bucket[];
  byCountry: Bucket[];
}

/**
 * Totals over the orders that CAN be paid. Orders missing a cost, already
 * settled, or cancelled are excluded from the money and listed separately —
 * mixing them in would let a short or double payment look correct.
 */
export function summarize(orders: CostOrder[]): CostSummary {
  const out: CostSummary = {
    orders: 0, units: 0, product: 0, shipping: 0, total: 0,
    missingCost: [], alreadySettled: [], cancelled: [],
    unsplitOrders: 0, suppliers: [], bySupplier: [], byCarrier: [], byCountry: []
  };
  const maps = { s: new Map<string, Bucket>(), c: new Map<string, Bucket>(), k: new Map<string, Bucket>() };
  const add = (m: Map<string, Bucket>, key: string, c: OrderCost) => {
    const b = m.get(key) ?? { key, orders: 0, units: 0, product: 0, shipping: 0, total: 0 };
    b.orders += 1; b.units += c.units;
    b.product = r2(b.product + c.product); b.shipping = r2(b.shipping + c.shipping); b.total = r2(b.total + c.total);
    m.set(key, b);
  };

  for (const o of orders) {
    const ref = { id: o.id, orderNumber: o.orderNumber };
    if (o.supplierSettlementId) { out.alreadySettled.push(ref); continue; }
    if (o.fulfillStatus === 'CANCELLED') { out.cancelled.push(ref); continue; }
    const c = orderCost(o);
    if (c.missing) { out.missingCost.push(ref); continue; }

    out.orders += 1;
    out.units += c.units;
    out.product = r2(out.product + c.product);
    out.shipping = r2(out.shipping + c.shipping);
    out.total = r2(out.total + c.total);
    if (c.unsplit) out.unsplitOrders += 1;
    add(maps.s, supplierLabel(o), c);
    add(maps.c, o.shippingCompany?.trim() || 'Unknown', c);
    add(maps.k, o.shippingCountryCode?.trim().toUpperCase() || '??', c);
  }

  const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.total - a.total);
  out.bySupplier = sorted(maps.s);
  out.byCarrier = sorted(maps.c);
  out.byCountry = sorted(maps.k);
  out.suppliers = out.bySupplier.map(b => b.key);
  return out;
}

/**
 * Why a selection cannot become one settlement, or null when it can.
 * Specific reasons come first: "already paid" tells you what to do,
 * "nothing payable" does not.
 */
export function settlementBlocker(summary: CostSummary): string | null {
  if (summary.missingCost.length) {
    return `${summary.missingCost.length} order(s) have products with no cost — price them in COGS and hit "Apply to P&L" first`;
  }
  if (summary.alreadySettled.length) return `${summary.alreadySettled.length} order(s) are already in a supplier payment`;
  if (summary.cancelled.length) return `${summary.cancelled.length} cancelled order(s) are selected — remove them first`;
  if (summary.suppliers.length > 1) {
    return `The selection spans several suppliers (${summary.suppliers.join(', ')}) — pay one supplier at a time`;
  }
  if (summary.orders === 0) return 'No payable orders in the selection';
  return null;
}

/** One CSV row per line item — the statement sent to the supplier. */
export const STATEMENT_HEADER = [
  'Order Number', 'Order Date', 'Shipped Date', 'Tracking Number', 'Carrier', 'Country',
  'Product', 'SKU', 'Variant', 'Quantity', 'Unit Product Cost', 'Unit Shipping Cost',
  'Unit Total Cost', 'Line Total'
];

export function statementRows(
  orders: Array<CostOrder & { processedAt: Date | null; shippedAt: Date | null; trackingNumber: string | null }>
): string[][] {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
  const money = (v: unknown) => { const x = n(v); return x === null ? '' : x.toFixed(2); };
  const rows: string[][] = [];
  for (const o of orders) {
    for (const li of o.lineItems) {
      if (li.variantId === null || li.variantId === undefined) continue;
      const unit = n(li.unitBasecost);
      rows.push([
        o.orderNumber, day(o.processedAt), day(o.shippedAt), o.trackingNumber ?? '',
        o.shippingCompany ?? '', o.shippingCountryCode ?? '',
        li.title ?? '', li.sku ?? '', li.variantTitle ?? '', String(li.quantity),
        money(li.unitProductCost ?? li.unitBasecost), money(li.unitProductCost === null || li.unitProductCost === undefined ? 0 : li.unitShippingCost),
        money(li.unitBasecost), unit === null ? '' : (unit * li.quantity).toFixed(2)
      ]);
    }
  }
  return rows;
}
