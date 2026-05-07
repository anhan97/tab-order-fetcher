import { PrismaClient, Prisma } from '@prisma/client';
import { aggregateForDate, computeAndSaveForDate } from '../src/services/daily-pl.service';

const prisma = new PrismaClient();

const DAY = '2026-04-15';
const DAY_DATE = new Date(DAY + 'T00:00:00Z');
const NEXT = new Date(DAY + 'T00:00:00Z'); NEXT.setUTCDate(NEXT.getUTCDate() + 1);

const userId = '00000000-0000-0000-0000-00000000pl01';
const storeId = '00000000-0000-0000-0000-00000000pl01';
const accountId = '00000000-0000-0000-0000-00000000pl01';

async function reset() {
  // Clean only this test's tenant. Order matters because of FKs.
  await prisma.dailyPLSnapshot.deleteMany({ where: { userId } });
  await prisma.operatingCost.deleteMany({ where: { userId } });
  await prisma.orderTransaction.deleteMany({ where: { userId } });
  await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.facebookAdSpend.deleteMany({ where: { userId } });
  await prisma.facebookAdAccount.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'pl-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'pl-test.myshopify.com', accessToken: 'x' } });
  await prisma.facebookAdAccount.create({ data: { id: accountId, userId, accountId: 'pl-test-fb', name: 'PL Test' } });
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe per-day data but keep user/store
  await prisma.dailyPLSnapshot.deleteMany({ where: { userId } });
  await prisma.operatingCost.deleteMany({ where: { userId } });
  await prisma.orderTransaction.deleteMany({ where: { userId } });
  await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.facebookAdSpend.deleteMany({ where: { userId } });
});

async function seedOrder(opts: {
  shopifyOrderId: string;
  total: number;
  subtotal: number;
  discounts?: number;
  shipping?: number;
  tax?: number;
  refunded?: number;
  processedAt: Date;
  cancelledAt?: Date;
  lineItems?: Array<{ shopifyLineItemId: string; quantity: number; price: number; unitCost: number | null }>;
}) {
  const order = await prisma.order.create({
    data: {
      userId,
      storeId,
      shopifyOrderId: opts.shopifyOrderId,
      orderNumber: opts.shopifyOrderId,
      currency: 'USD',
      status: 'paid',
      totalAmount: opts.total,
      subtotalPrice: new Prisma.Decimal(opts.subtotal),
      totalDiscounts: new Prisma.Decimal(opts.discounts ?? 0),
      totalShipping: new Prisma.Decimal(opts.shipping ?? 0),
      totalTax: new Prisma.Decimal(opts.tax ?? 0),
      totalRefunded: new Prisma.Decimal(opts.refunded ?? 0),
      shopifyCreatedAt: opts.processedAt,
      processedAt: opts.processedAt,
      cancelledAt: opts.cancelledAt ?? null
    }
  });
  for (const li of opts.lineItems || []) {
    await prisma.orderLineItem.create({
      data: {
        orderId: order.id,
        shopifyLineItemId: li.shopifyLineItemId,
        quantity: li.quantity,
        price: new Prisma.Decimal(li.price),
        unitCostSnapshot: li.unitCost === null ? null : new Prisma.Decimal(li.unitCost)
      }
    });
  }
  return order;
}

async function seedTx(orderId: string, opts: {
  id: string;
  kind: 'sale' | 'refund' | 'capture';
  status?: string;
  amount: number;
  fee: number;
  processedAt: Date;
  gateway?: string;
}) {
  await prisma.orderTransaction.create({
    data: {
      userId,
      storeId,
      orderId,
      shopifyTransactionId: opts.id,
      kind: opts.kind,
      status: opts.status ?? 'success',
      gateway: opts.gateway ?? 'shopify_payments',
      amount: new Prisma.Decimal(opts.amount),
      fee: new Prisma.Decimal(opts.fee),
      net: new Prisma.Decimal(opts.amount - opts.fee),
      currency: 'USD',
      processedAt: opts.processedAt
    }
  });
}

describe('aggregateForDate', () => {
  test('returns zeros when no data', async () => {
    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.grossRevenue).toBe(0);
    expect(r.netProfit).toBe(0);
    expect(r.orderCount).toBe(0);
  });

  test('computes profit for one simple order', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    const order = await seedOrder({
      shopifyOrderId: 'A1',
      total: 100,
      subtotal: 80,
      shipping: 10,
      tax: 10,
      processedAt: at,
      lineItems: [{ shopifyLineItemId: 'l1', quantity: 2, price: 40, unitCost: 15 }]
    });
    await seedTx(order.id, { id: 't1', kind: 'sale', amount: 100, fee: 3.2, processedAt: at });

    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.grossRevenue).toBe(100);
    expect(r.shippingRevenue).toBe(10);
    expect(r.taxCollected).toBe(10);
    expect(r.netRevenue).toBe(90); // 100 - 0 refunds - 10 tax
    expect(r.cogs).toBe(30); // 2 * 15
    expect(r.paymentFees).toBe(3.2);
    expect(r.grossProfit).toBe(56.8); // 90 - 30 - 3.2
    expect(r.orderCount).toBe(1);
    expect(r.netProfit).toBe(56.8); // no ads, no opEx
  });

  test('refund transaction reduces fees and counts as refund on its own day', async () => {
    const sellAt = new Date(DAY + 'T08:00:00Z');
    const refundAt = new Date(DAY + 'T20:00:00Z');
    const order = await seedOrder({
      shopifyOrderId: 'A2',
      total: 100,
      subtotal: 100,
      processedAt: sellAt,
      lineItems: [{ shopifyLineItemId: 'l1', quantity: 1, price: 100, unitCost: 30 }]
    });
    await seedTx(order.id, { id: 't1', kind: 'sale', amount: 100, fee: 3.2, processedAt: sellAt });
    await seedTx(order.id, { id: 't2', kind: 'refund', amount: 40, fee: 1.2, processedAt: refundAt });

    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.refunds).toBe(40);
    expect(r.refundedOrderCount).toBe(1);
    expect(r.paymentFees).toBe(2); // 3.2 sale - 1.2 refund
    expect(r.netRevenue).toBe(60); // 100 - 40 refund - 0 tax
    expect(r.grossProfit).toBe(28); // 60 - 30 cogs - 2 fees
  });

  test('cancellation on same day excludes the order from revenue', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    await seedOrder({
      shopifyOrderId: 'A3',
      total: 100,
      subtotal: 100,
      processedAt: at,
      cancelledAt: at,
      lineItems: [{ shopifyLineItemId: 'l1', quantity: 1, price: 100, unitCost: 30 }]
    });
    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.orderCount).toBe(0);
    expect(r.grossRevenue).toBe(0);
  });

  test('app_fee category is split out from operatingCost', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    await prisma.operatingCost.createMany({
      data: [
        { userId, storeId, date: DAY_DATE, category: 'app_fee', amount: new Prisma.Decimal(29.99) },
        { userId, storeId, date: DAY_DATE, category: 'app_fee', amount: new Prisma.Decimal(15) },
        { userId, storeId, date: DAY_DATE, category: 'salary', amount: new Prisma.Decimal(100) },
        { userId, storeId, date: DAY_DATE, category: 'misc', amount: new Prisma.Decimal(20) }
      ]
    });
    void at;
    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.appFees).toBe(44.99);
    expect(r.operatingCost).toBe(120); // salary 100 + misc 20
    expect(r.netProfit).toBe(-(44.99 + 120)); // no revenue, all costs go negative
  });

  test('FB ad spend, operating cost, and other_ads category subtract from netProfit', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    const order = await seedOrder({
      shopifyOrderId: 'A4',
      total: 200,
      subtotal: 200,
      processedAt: at,
      lineItems: [{ shopifyLineItemId: 'l1', quantity: 1, price: 200, unitCost: 60 }]
    });
    await seedTx(order.id, { id: 't1', kind: 'sale', amount: 200, fee: 6.1, processedAt: at });

    await prisma.facebookAdSpend.create({
      data: { userId, storeId, accountId, date: DAY_DATE, spend: 25, currency: 'USD' }
    });
    await prisma.operatingCost.createMany({
      data: [
        { userId, storeId, date: DAY_DATE, category: 'salary', amount: new Prisma.Decimal(40) },
        { userId, storeId, date: DAY_DATE, category: 'other_ads', amount: new Prisma.Decimal(15) },
        { userId, storeId, date: DAY_DATE, category: 'misc', amount: new Prisma.Decimal(5) }
      ]
    });

    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.fbAdSpend).toBe(25);
    expect(r.otherAdSpend).toBe(15);
    expect(r.operatingCost).toBe(45); // salary 40 + misc 5
    expect(r.grossProfit).toBe(133.9); // 200 net rev - 60 cogs - 6.1 fees
    expect(r.netProfit).toBeCloseTo(133.9 - 25 - 15 - 45, 2); // 48.9
  });

  test('orders without unitCostSnapshot contribute 0 COGS (graceful)', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    await seedOrder({
      shopifyOrderId: 'A5',
      total: 50,
      subtotal: 50,
      processedAt: at,
      lineItems: [{ shopifyLineItemId: 'l1', quantity: 3, price: 16.66, unitCost: null }]
    });
    const r = await aggregateForDate(userId, storeId, DAY_DATE);
    expect(r.cogs).toBe(0);
    expect(r.orderCount).toBe(1);
    expect(r.grossRevenue).toBe(50);
  });
});

describe('computeAndSaveForDate', () => {
  test('upserts the snapshot row idempotently', async () => {
    const at = new Date(DAY + 'T10:00:00Z');
    const order = await seedOrder({ shopifyOrderId: 'A6', total: 100, subtotal: 100, processedAt: at });
    await seedTx(order.id, { id: 't1', kind: 'sale', amount: 100, fee: 3, processedAt: at });

    const r1 = await computeAndSaveForDate(userId, storeId, DAY_DATE);
    expect(r1.grossRevenue).toBe(100);

    const r2 = await computeAndSaveForDate(userId, storeId, DAY_DATE);
    expect(r2.grossRevenue).toBe(100);

    const rows = await prisma.dailyPLSnapshot.findMany({ where: { userId, storeId } });
    expect(rows.length).toBe(1);
  });
});
