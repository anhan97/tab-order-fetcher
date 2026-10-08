/**
 * The supplier payable. A wrong total here is a wrong payment, so every rule
 * — what counts, what is excluded, when a payment is refused — is pinned.
 */
import { describe, it, expect } from 'vitest';
import { orderCost, summarize, settlementBlocker, statementRows, type CostOrder } from '../src/lib/supplier-cost';
import { issueReasons, daysSinceShipped, parseStuckDays } from '../src/lib/fulfillment-views';

const li = (over: Partial<CostOrder['lineItems'][number]> = {}) => ({
  variantId: '1', quantity: 1, unitBasecost: '10.00', unitProductCost: '7.00', unitShippingCost: '3.00',
  title: 'Shirt', sku: 'S', variantTitle: 'Red', ...over
});
const order = (over: Partial<CostOrder> = {}): CostOrder => ({
  id: 'o1', orderNumber: '1001', supplier: 'Acme', shippingCompany: 'YT', shippingCountryCode: 'US',
  fulfillStatus: 'SHIPPED', supplierSettlementId: null, lineItems: [li()], ...over
});

describe('orderCost', () => {
  it('multiplies frozen unit costs by quantity and keeps the split', () => {
    expect(orderCost(order({ lineItems: [li({ quantity: 2 })] }))).toEqual({
      product: 14, shipping: 6, total: 20, units: 2, missing: false, unsplit: false
    });
  });

  it('ignores custom items with no variant (nothing to buy from the supplier)', () => {
    const c = orderCost(order({ lineItems: [li(), li({ variantId: null, unitBasecost: null, unitProductCost: null, unitShippingCost: null })] }));
    expect(c.total).toBe(10);
    expect(c.missing).toBe(false);
  });

  it('flags a variant line with no cost as missing', () => {
    expect(orderCost(order({ lineItems: [li({ unitBasecost: null })] })).missing).toBe(true);
  });

  it('counts a pre-split line as product but keeps the total exact', () => {
    const c = orderCost(order({ lineItems: [li({ unitProductCost: null, unitShippingCost: null })] }));
    expect(c).toMatchObject({ product: 10, shipping: 0, total: 10, unsplit: true });
  });
});

describe('summarize', () => {
  it('totals payable orders and sets the rest aside with a reason', () => {
    const s = summarize([
      order({ id: 'a', orderNumber: '1' }),
      order({ id: 'b', orderNumber: '2', lineItems: [li({ quantity: 3 })] }),
      order({ id: 'c', orderNumber: '3', lineItems: [li({ unitBasecost: null })] }),
      order({ id: 'd', orderNumber: '4', supplierSettlementId: 'paid' }),
      order({ id: 'e', orderNumber: '5', fulfillStatus: 'CANCELLED' })
    ]);
    expect(s).toMatchObject({ orders: 2, units: 4, product: 28, shipping: 12, total: 40 });
    expect(s.missingCost.map(o => o.id)).toEqual(['c']);
    expect(s.alreadySettled.map(o => o.id)).toEqual(['d']);
    expect(s.cancelled.map(o => o.id)).toEqual(['e']);
  });

  it('breaks down by supplier, carrier and country, largest first', () => {
    const s = summarize([
      order({ id: 'a', supplier: null, shippingCompany: 'LP', shippingCountryCode: 'au' }),
      order({ id: 'b', lineItems: [li({ quantity: 5 })] })
    ]);
    expect(s.suppliers).toEqual(['Acme', 'Default']);
    expect(s.byCarrier.map(b => b.key)).toEqual(['YT', 'LP']);
    expect(s.byCountry.map(b => b.key)).toEqual(['US', 'AU']);
  });

  it('avoids float drift across many orders', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      order({ id: String(i), lineItems: [li({ unitBasecost: '0.10', unitProductCost: '0.07', unitShippingCost: '0.03' })] }));
    expect(summarize(many).total).toBe(30);
  });
});

describe('settlementBlocker', () => {
  it('allows one clean supplier', () => {
    expect(settlementBlocker(summarize([order()]))).toBeNull();
  });
  it.each([
    ['a selection that is only already-paid orders, with the specific reason', [order({ supplierSettlementId: 'x' })], /already in a supplier payment/],
    ['missing cost', [order(), order({ id: 'b', lineItems: [li({ unitBasecost: null })] })], /no cost/],
    ['already paid', [order(), order({ id: 'b', supplierSettlementId: 'x' })], /already in a supplier payment/],
    ['cancelled', [order(), order({ id: 'b', fulfillStatus: 'CANCELLED' })], /cancelled/],
    ['two suppliers', [order(), order({ id: 'b', supplier: 'Other' })], /several suppliers/]
  ])('refuses %s', (_label, orders, re) => {
    expect(settlementBlocker(summarize(orders as CostOrder[]))).toMatch(re as RegExp);
  });
});

describe('statementRows', () => {
  it('one row per costed variant line, with line totals', () => {
    const rows = statementRows([{ ...order({ lineItems: [li({ quantity: 2 }), li({ variantId: null })] }),
      processedAt: new Date('2026-09-01T10:00:00Z'), shippedAt: null, trackingNumber: 'YT1' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['1001', '2026-09-01', '', 'YT1', 'YT', 'US', 'Shirt', 'S', 'Red', '2', '7.00', '3.00', '10.00', '20.00']);
  });
});

describe('issueReasons', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const base = { status: 'paid', fulfillStatus: 'SHIPPED', deliveryStatus: 'in_transit', processedAt: new Date('2026-09-10'), shippedAt: new Date('2026-09-11'), lineItems: [{ variantId: '1', unitBasecost: '5' }] };

  it('nothing for a healthy order', () => expect(issueReasons(base, now)).toEqual([]));
  it('carrier failure, case-insensitive', () => {
    expect(issueReasons({ ...base, deliveryStatus: 'FAILURE' }, now)).toEqual(['shipping_error']);
    expect(issueReasons({ ...base, deliveryStatus: 'Exception' }, now)).toEqual(['shipping_error']);
  });
  it('tracking not found only once 7 days have passed', () => {
    expect(issueReasons({ ...base, deliveryStatus: 'NotFound', shippedAt: new Date('2026-09-14') }, now)).toEqual([]);
    expect(issueReasons({ ...base, deliveryStatus: 'NotFound', shippedAt: new Date('2026-09-05') }, now)).toEqual(['tracking_missing']);
  });
  it('paid but not shipped after 5 days', () => {
    expect(issueReasons({ ...base, fulfillStatus: 'PENDING', processedAt: new Date('2026-09-14') }, now)).toEqual([]);
    expect(issueReasons({ ...base, fulfillStatus: 'PENDING', processedAt: new Date('2026-09-01') }, now)).toEqual(['paid_not_shipped']);
  });
  it('missing cost, but not for custom items', () => {
    expect(issueReasons({ ...base, lineItems: [{ variantId: '1', unitBasecost: null }] }, now)).toEqual(['missing_cost']);
    expect(issueReasons({ ...base, lineItems: [{ variantId: null, unitBasecost: null }] }, now)).toEqual([]);
  });
  it('cancelled orders are never issues', () => {
    expect(issueReasons({ ...base, fulfillStatus: 'CANCELLED', deliveryStatus: 'failure' }, now)).toEqual([]);
  });
});

describe('ship age', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  it('uses the ship date, or estimates from the order date', () => {
    expect(daysSinceShipped({ shippedAt: new Date('2026-09-01T00:00:00Z'), processedAt: null }, now)).toEqual({ days: 16, estimated: false });
    expect(daysSinceShipped({ shippedAt: null, processedAt: new Date('2026-09-07T00:00:00Z') }, now)).toEqual({ days: 10, estimated: true });
  });
  it('stuckDays falls back to 15 on junk', () => {
    expect(parseStuckDays('30')).toBe(30);
    expect(parseStuckDays('0')).toBe(15);
    expect(parseStuckDays('abc')).toBe(15);
  });
});
