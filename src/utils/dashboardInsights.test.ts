import { describe, it, expect } from 'vitest';
import { computeDashboardInsights } from './dashboardInsights';
import type { Order } from '@/types/order';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: '1001',
    orderDate: '2026-04-01',
    customerEmail: 'a@example.com',
    customerName: 'A',
    totalPrice: 100,
    currency: 'USD',
    fulfillmentStatus: 'fulfilled',
    financialStatus: 'paid',
    shippingAddress: {
      address1: '1', city: 'X', province: 'X', zip: '0', country: 'US'
    },
    lineItems: [
      { id: 'l1', productId: 'p1', variantId: 'v1', title: 'Widget', quantity: 1, price: 100, sku: 'WID-RED' }
    ],
    shippingCost: 0,
    tags: [],
    note: '',
    productSKU: 'WID-RED',
    variantId: 'v1',
    ...overrides
  };
}

describe('computeDashboardInsights', () => {
  it('returns zeros for empty orders', () => {
    const r = computeDashboardInsights({ orders: [], revenue: 0, netProfit: 0 });
    expect(r.netProfitMargin).toBe(0);
    expect(r.refundRate).toBe(0);
    expect(r.repeatCustomerRate).toBe(0);
    expect(r.uniqueCustomers).toBe(0);
    expect(r.topProducts).toEqual([]);
    expect(r.topCountries).toEqual([]);
  });

  it('computes net profit margin from supplied revenue/profit', () => {
    const r = computeDashboardInsights({ orders: [makeOrder()], revenue: 200, netProfit: 50 });
    expect(r.netProfitMargin).toBeCloseTo(25, 5);
  });

  it('counts refunded orders as refund rate', () => {
    const orders = [
      makeOrder({ id: '1', financialStatus: 'paid' }),
      makeOrder({ id: '2', financialStatus: 'refunded' }),
      makeOrder({ id: '3', financialStatus: 'partially_refunded' }),
      makeOrder({ id: '4', financialStatus: 'paid' })
    ];
    const r = computeDashboardInsights({ orders, revenue: 400, netProfit: 100 });
    expect(r.refundRate).toBeCloseTo(50, 5); // 2 of 4
  });

  it('computes repeat customer rate by email', () => {
    const orders = [
      makeOrder({ id: '1', customerEmail: 'a@x.com' }),
      makeOrder({ id: '2', customerEmail: 'a@x.com' }),  // returning
      makeOrder({ id: '3', customerEmail: 'b@x.com' }),  // new
      makeOrder({ id: '4', customerEmail: 'C@x.com' }),  // upper case — should match next row
      makeOrder({ id: '5', customerEmail: 'c@x.com' })   // returning (case-insensitive)
    ];
    const r = computeDashboardInsights({ orders, revenue: 0, netProfit: 0 });
    expect(r.uniqueCustomers).toBe(3);
    expect(r.returningCustomers).toBe(2); // a@x.com and c@x.com
    expect(r.newCustomers).toBe(1);
    expect(r.repeatCustomerRate).toBeCloseTo(66.667, 1);
  });

  it('groups SKU by prefix into top products and ranks by revenue', () => {
    const orders = [
      makeOrder({ id: '1', lineItems: [
        { id: 'a', productId: 'p1', variantId: 'v1', title: 'Widget Red', quantity: 2, price: 50, sku: 'WID-RED' }
      ] }),
      makeOrder({ id: '2', lineItems: [
        { id: 'b', productId: 'p1', variantId: 'v2', title: 'Widget Blue', quantity: 1, price: 50, sku: 'WID-BLUE' }
      ] }),
      makeOrder({ id: '3', lineItems: [
        { id: 'c', productId: 'p2', variantId: 'v3', title: 'Gadget', quantity: 1, price: 30, sku: 'GAD-X' }
      ] })
    ];
    const r = computeDashboardInsights({ orders, revenue: 0, netProfit: 0 });
    expect(r.topProducts.length).toBe(2);
    expect(r.topProducts[0].sku).toBe('WID');     // grouped
    expect(r.topProducts[0].units).toBe(3);       // 2 + 1
    expect(r.topProducts[0].revenue).toBe(150);   // 100 + 50
    expect(r.topProducts[1].sku).toBe('GAD');
  });

  it('ranks countries by order count and normalizes case', () => {
    const orders = [
      makeOrder({ id: '1', shippingAddress: { address1: '', city: '', province: '', zip: '', country: 'us' } }),
      makeOrder({ id: '2', shippingAddress: { address1: '', city: '', province: '', zip: '', country: 'US' } }),
      makeOrder({ id: '3', shippingAddress: { address1: '', city: '', province: '', zip: '', country: 'GB' } })
    ];
    const r = computeDashboardInsights({ orders, revenue: 0, netProfit: 0 });
    expect(r.topCountries[0].countryCode).toBe('US');
    expect(r.topCountries[0].orders).toBe(2);
    expect(r.topCountries[0].countryName).toBe('United States');
    expect(r.topCountries[1].countryCode).toBe('GB');
  });

  it('computes fulfillment rate over paid orders only', () => {
    const orders = [
      makeOrder({ id: '1', financialStatus: 'paid', fulfillmentStatus: 'fulfilled' }),
      makeOrder({ id: '2', financialStatus: 'paid', fulfillmentStatus: 'unfulfilled' }),
      makeOrder({ id: '3', financialStatus: 'pending', fulfillmentStatus: 'unfulfilled' })  // excluded
    ];
    const r = computeDashboardInsights({ orders, revenue: 0, netProfit: 0 });
    expect(r.fulfillmentRate).toBeCloseTo(50, 5);
  });

  it('computes effective fee rate from totalFees over revenue', () => {
    const r = computeDashboardInsights({ orders: [makeOrder()], revenue: 1000, netProfit: 0, totalFees: 35 });
    expect(r.effectiveFeeRate).toBeCloseTo(3.5, 5);
  });
});
