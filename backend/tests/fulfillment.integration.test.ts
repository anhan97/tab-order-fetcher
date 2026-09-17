/**
 * Fulfillment + supplier payments + fee sync, end to end on a real Postgres,
 * through the real HTTP routes.
 *
 * OPT-IN like the other *.integration tests: TEST_DATABASE_URL and
 * DATABASE_URL must both point at the same throwaway, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { request, type Server } from 'http';
import { AddressInfo } from 'net';
import { PrismaClient, Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const db = TEST_DB_URL ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } }) : null;

let live = false;
if (!db) {
  console.warn('[fulfillment] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[fulfillment] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT 1 FROM "SupplierSettlement" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[fulfillment] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `fulfil-${suffix}.myshopify.com`;
const SECRET = process.env.JWT_SECRET || 'default-secret';
const DAY = 86_400_000;

let ownerId = '', viewerId = '', storeId = '';
let server: Server;
let base = '';
const ids: Record<string, string> = {};

const token = (id: string) => jwt.sign({ id, status: 'ACTIVE' }, SECRET);

function call(path: string, method: string, as: string, body?: unknown): Promise<{ status: number; json: any }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token(as)}`,
        'X-Shopify-Store-Domain': DOMAIN,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json: any = data;
        try { json = JSON.parse(data); } catch { /* csv */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function makeOrder(key: string, over: Partial<Prisma.OrderUncheckedCreateInput>, items: Array<Partial<Prisma.OrderLineItemUncheckedCreateInput>>) {
  const o = await db!.order.create({
    data: {
      userId: ownerId, storeId, shopifyOrderId: `${key}-${suffix}`, orderNumber: key,
      totalAmount: 50, currency: 'USD', status: 'paid', fulfillStatus: 'SHIPPED',
      supplier: 'Acme', shippingCompany: 'YT', shippingCountryCode: 'US',
      processedAt: new Date(), ...over,
      lineItems: {
        create: items.map((it, i) => ({
          shopifyLineItemId: `${key}-li${i}-${suffix}`, quantity: 1, price: new Prisma.Decimal(20), ...it
        })) as any
      }
    }
  });
  ids[key] = o.id;
  return o;
}

beforeAll(async () => {
  if (!live || !db) return;
  const mk = async (who: string) => (await db.user.create({
    data: { email: `${who}-${suffix}@fulfil.test`, password: 'x', isVerified: true, status: 'ACTIVE' }
  })).id;
  ownerId = await mk('owner');
  viewerId = await mk('viewer');
  storeId = (await db.shopifyStore.create({
    data: { userId: ownerId, storeDomain: DOMAIN, accessToken: 'blob', isActive: true }
  })).id;
  await db.storeMember.create({ data: { userId: viewerId, storeId, role: 'viewer' } });

  const now = Date.now();
  const costed = { variantId: BigInt(111), unitBasecost: new Prisma.Decimal(10), unitProductCost: new Prisma.Decimal(7), unitShippingCost: new Prisma.Decimal(3) };
  await makeOrder('healthy', { shippedAt: new Date(now - 2 * DAY), deliveryStatus: 'in_transit' }, [costed]);
  await makeOrder('stuck', { shippedAt: new Date(now - 20 * DAY), processedAt: new Date(now - 21 * DAY), deliveryStatus: 'in_transit' }, [{ ...costed, quantity: 2 }]);
  await makeOrder('stuckNoShipDate', { shippedAt: null, processedAt: new Date(now - 30 * DAY) }, [costed]);
  await makeOrder('failed', { shippedAt: new Date(now - 3 * DAY), deliveryStatus: 'failure' }, [costed]);
  await makeOrder('paidNotShipped', { fulfillStatus: 'PENDING', processedAt: new Date(now - 9 * DAY) }, [costed]);
  await makeOrder('noCost', { shippedAt: new Date(now - 1 * DAY) }, [{ variantId: BigInt(222) }]);
  await makeOrder('otherSupplier', { supplier: 'Globex', shippedAt: new Date(now - 1 * DAY) }, [costed]);
  await makeOrder('cancelled', { fulfillStatus: 'CANCELLED', deliveryStatus: 'failure' }, [costed]);

  const [{ default: ordersRoutes }, { default: settlementRoutes }] = await Promise.all([
    import('../src/routes/orders.routes'),
    import('../src/routes/supplier-settlements.routes')
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
  app.use('/api/supplier-settlements', settlementRoutes);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (!db) return;
  try {
    if (live) {
      // Sweep every store this test ever created, not just this run's — a run
      // that crashed mid-way leaves rows that would block deleting the users.
      const stores = await db.shopifyStore.findMany({
        where: { storeDomain: { startsWith: 'fulfil-', endsWith: '.myshopify.com' } },
        select: { id: true }
      });
      const storeIds = stores.map(s => s.id);
      await db.order.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.supplierSettlement.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.cogsLine.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.productVariant.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.storeMember.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.shopifyStore.deleteMany({ where: { id: { in: storeIds } } });
      await db.user.deleteMany({ where: { email: { endsWith: '@fulfil.test' } } });
    }
  } finally {
    await db.$disconnect();
  }
});

const numbers = (r: { json: any }) => r.json.orders.map((o: any) => o.orderNumber).sort();

describe('attention views', () => {
  maybe()('STUCK = shipped long ago, not delivered, ship date or order date as fallback', async () => {
    const r = await call('/api/orders?view=STUCK&stuckDays=15', 'GET', ownerId);
    expect(r.status).toBe(200);
    expect(numbers(r)).toEqual(['stuck', 'stuckNoShipDate']);
    const estimated = r.json.orders.find((o: any) => o.orderNumber === 'stuckNoShipDate');
    expect(estimated.shippedAtEstimated).toBe(true);
    expect(r.json.tabs.STUCK).toBe(2);
  });

  maybe()('ISSUES lists every reason and skips cancelled orders', async () => {
    const r = await call('/api/orders?view=ISSUES', 'GET', ownerId);
    expect(numbers(r)).toEqual(['failed', 'noCost', 'paidNotShipped']);
    const reasons = Object.fromEntries(r.json.orders.map((o: any) => [o.orderNumber, o.issues]));
    expect(reasons).toEqual({ failed: ['shipping_error'], noCost: ['missing_cost'], paidNotShipped: ['paid_not_shipped'] });
  });

  maybe()('the search box narrows a view instead of replacing it', async () => {
    const r = await call('/api/orders?view=ISSUES&q=fail', 'GET', ownerId);
    expect(numbers(r)).toEqual(['failed']);
  });

  maybe()('views ignore the date range; status tabs respect it', async () => {
    const from = new Date(Date.now() - 5 * DAY).toISOString();
    const stuck = await call(`/api/orders?view=STUCK&from=${from}`, 'GET', ownerId);
    expect(stuck.json.total).toBe(2);
    const all = await call(`/api/orders?from=${from}`, 'GET', ownerId);
    expect(numbers(all)).not.toContain('stuck');
  });
});

describe('supplier payable and payments', () => {
  maybe()('cost summary totals only what can be paid', async () => {
    const r = await call('/api/orders/cost-summary', 'POST', viewerId, {
      ids: [ids.healthy, ids.stuck, ids.noCost, ids.cancelled]
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ orders: 2, units: 3, product: 21, shipping: 9, total: 30, currency: 'USD' });
    expect(r.json.missingCost.map((o: any) => o.orderNumber)).toEqual(['noCost']);
    expect(r.json.cancelled.map((o: any) => o.orderNumber)).toEqual(['cancelled']);
  });

  maybe()('a viewer can see totals but cannot record a payment', async () => {
    const r = await call('/api/supplier-settlements', 'POST', viewerId, { orderIds: [ids.healthy] });
    expect(r.status).toBe(403);
  });

  maybe()('refuses mixed suppliers and orders without cost', async () => {
    const mixed = await call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [ids.healthy, ids.otherSupplier] });
    expect(mixed.status).toBe(409);
    expect(mixed.json.error).toMatch(/several suppliers/);
    const missing = await call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [ids.healthy, ids.noCost] });
    expect(missing.status).toBe(409);
    expect(missing.json.error).toMatch(/no cost/);
  });

  maybe()('records a payment with server-computed totals and locks the orders', async () => {
    const r = await call('/api/supplier-settlements', 'POST', ownerId, {
      orderIds: [ids.healthy, ids.stuck], paidAt: '2026-09-15T12:00:00.000Z', reference: 'TT-001'
    });
    expect(r.status).toBe(201);
    expect(r.json.settlement).toMatchObject({
      supplier: 'Acme', orderCount: 2, unitCount: 3, productCost: '21', shippingCost: '9', totalCost: '30', reference: 'TT-001'
    });
    ids.payment = r.json.settlement.id;

    const again = await call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [ids.healthy] });
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/already in a supplier payment/);

    const unsettled = await call(`/api/orders?view=STUCK&settlement=unsettled`, 'GET', ownerId);
    expect(numbers(unsettled)).toEqual(['stuckNoShipDate']);
  });

  maybe()('two payments racing for the same order: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [ids.failed] }),
      call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [ids.failed] })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const live = await db!.supplierSettlement.count({ where: { storeId, status: 'PAID', orderCount: 1 } });
    expect(live).toBe(1);
  });

  maybe()('the statement lists the paid orders line by line', async () => {
    const r = await call(`/api/supplier-settlements/${ids.payment}/statement`, 'GET', viewerId);
    expect(r.status).toBe(200);
    const text = String(r.json);
    expect(text).toContain('Total: 30');
    expect(text).toContain('Unit Product Cost');
    expect(text.split('\n').filter(l => l.startsWith('healthy') || l.startsWith('stuck')).length).toBe(2);
  });

  maybe()('voiding releases the orders so they can be paid again', async () => {
    const v = await call(`/api/supplier-settlements/${ids.payment}/void`, 'POST', ownerId);
    expect(v.status).toBe(200);
    expect(v.json.released).toBe(2);
    const order = await db!.order.findUnique({ where: { id: ids.healthy } });
    expect(order!.supplierSettlementId).toBeNull();
    const again = await call(`/api/supplier-settlements/${ids.payment}/void`, 'POST', ownerId);
    expect(again.status).toBe(409);
  });
});

describe('cost snapshots', () => {
  maybe()('freeze the product/shipping split, and never touch a paid order', async () => {
    const { recomputeOrderCostSnapshots } = await import('../src/services/order-sync.service');
    const VID = BigInt(`8${Date.now()}`.slice(0, 15));
    await db!.productVariant.create({ data: { variantId: VID, productId: VID, userId: ownerId, storeId, title: 'Cap', basecost: new Prisma.Decimal(0) } });
    const line = await db!.cogsLine.create({ data: { userId: ownerId, storeId, carrier: 'YT', countryCode: 'US', setSizes: [1, 2] } });
    await db!.cogsPrice.create({ data: { lineId: line.id, variantId: VID, setQty: 2, productCost: new Prisma.Decimal(12), shippingCost: new Prisma.Decimal(5), cost: new Prisma.Decimal(17) } });

    const o = await makeOrder('snap', {}, [{ variantId: VID, quantity: 2 }]);
    await recomputeOrderCostSnapshots(ownerId, storeId, o.id);
    let [item] = await db!.orderLineItem.findMany({ where: { orderId: o.id } });
    expect([Number(item.unitBasecost), Number(item.unitProductCost), Number(item.unitShippingCost)]).toEqual([8.5, 6, 2.5]);

    // Pay it, change the price, recompute: the paid order keeps what was paid.
    const paid = await call('/api/supplier-settlements', 'POST', ownerId, { orderIds: [o.id] });
    expect(paid.status).toBe(201);
    await db!.cogsPrice.updateMany({ where: { lineId: line.id }, data: { productCost: new Prisma.Decimal(99), cost: new Prisma.Decimal(104) } });
    await recomputeOrderCostSnapshots(ownerId, storeId, o.id);
    [item] = await db!.orderLineItem.findMany({ where: { orderId: o.id } });
    expect(Number(item.unitBasecost)).toBe(8.5);
  });

  maybe()('an unpriced variant (basecost 0) stays missing instead of costing 0', async () => {
    const { recomputeOrderCostSnapshots } = await import('../src/services/order-sync.service');
    const VID = BigInt(`7${Date.now()}`.slice(0, 15));
    await db!.productVariant.create({ data: { variantId: VID, productId: VID, userId: ownerId, storeId, title: 'New', basecost: new Prisma.Decimal(0) } });
    const o = await makeOrder('unpriced', { shippingCountryCode: 'ZZ' }, [{ variantId: VID }]);
    await recomputeOrderCostSnapshots(ownerId, storeId, o.id);
    const [item] = await db!.orderLineItem.findMany({ where: { orderId: o.id } });
    expect(item.unitBasecost).toBeNull();
  });
});

describe('payment fee sync', () => {
  const realFetch = globalThis.fetch;
  const reply = (status: number, body: unknown, link?: string) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(link ? [['link', link]] : []) as any,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });

  maybe()('a 403 is recorded as a missing scope, not swallowed', async () => {
    const { syncBalanceTransactions } = await import('../src/services/order-sync.service');
    globalThis.fetch = vi.fn(reply(403, { errors: '[API] This action requires merchant approval for read_shopify_payments_payouts scope.' })) as any;
    try {
      const r = await syncBalanceTransactions(storeId, new Date(Date.now() - 7 * DAY), new Date());
      expect(r.errors[0]).toMatch(/^missing_scope/);
      const store = await db!.shopifyStore.findUnique({ where: { id: storeId } });
      expect(store!.feeSyncError).toMatch(/^missing_scope/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  maybe()('balance rows become fees on orders that never pulled transactions, and the error clears', async () => {
    const { syncBalanceTransactions } = await import('../src/services/order-sync.service');
    const target = await db!.order.findUnique({ where: { id: ids.otherSupplier } });
    const recent = new Date(Date.now() - DAY).toISOString();
    const old = new Date(Date.now() - 40 * DAY).toISOString();
    globalThis.fetch = vi.fn(reply(200, {
      transactions: [
        { id: 1, type: 'charge', amount: '50.00', fee: '1.75', net: '48.25', currency: 'USD', source_order_id: Number(target!.shopifyOrderId.split('-')[0]) || 0, source_order_transaction_id: 9001, processed_at: recent },
        // Past the window: must stop here, not page on through history.
        { id: 2, type: 'charge', amount: '10.00', fee: '0.59', net: '9.41', currency: 'USD', source_order_id: 1, source_order_transaction_id: 9002, processed_at: old }
      ]
    }, '<https://x/next?page_info=abc>; rel="next"')) as any;
    // source_order_id must equal the order's Shopify id — point it at ours.
    await db!.order.update({ where: { id: target!.id }, data: { shopifyOrderId: '555000111' } });
    (globalThis.fetch as any).mockImplementation(reply(200, {
      transactions: [
        { id: 1, type: 'charge', amount: '50.00', fee: '1.75', net: '48.25', currency: 'USD', source_order_id: 555000111, source_order_transaction_id: 9001, processed_at: recent },
        { id: 2, type: 'charge', amount: '10.00', fee: '0.59', net: '9.41', currency: 'USD', source_order_id: 1, source_order_transaction_id: 9002, processed_at: old }
      ]
    }, '<https://x/next?page_info=abc>; rel="next"'));
    try {
      const r = await syncBalanceTransactions(storeId, new Date(Date.now() - 7 * DAY), new Date());
      expect(r.errors).toEqual([]);
      expect(r.created).toBe(1);
      expect((globalThis.fetch as any).mock.calls.length).toBe(1);

      const order = await db!.order.findUnique({ where: { id: target!.id } });
      expect(Number(order!.paymentFee)).toBe(1.75);
      const tx = await db!.orderTransaction.findFirst({ where: { orderId: target!.id } });
      expect(tx).toMatchObject({ shopifyTransactionId: '9001', kind: 'sale', status: 'success' });
      const store = await db!.shopifyStore.findUnique({ where: { id: storeId } });
      expect(store!.feeSyncError).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
