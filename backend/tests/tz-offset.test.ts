import { PrismaClient, Prisma } from '@prisma/client';
import { aggregateForDate, parseTzOffsetMinutes } from '../src/services/daily-pl.service';

const prisma = new PrismaClient();

const userId = '00000000-0000-0000-0000-00000000tz01';
const storeId = '00000000-0000-0000-0000-00000000tz01';

async function reset() {
  await prisma.dailyPLSnapshot.deleteMany({ where: { userId } });
  await prisma.operatingCost.deleteMany({ where: { userId } });
  await prisma.orderTransaction.deleteMany({ where: { userId } });
  await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'tz-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'tz-test.myshopify.com', accessToken: 'x' } });
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe('parseTzOffsetMinutes', () => {
  test('Etc/GMT+6 → 360 (west, behind UTC)', () => {
    expect(parseTzOffsetMinutes('Etc/GMT+6')).toBe(360);
  });
  test('Etc/GMT-7 → -420 (east, ahead UTC)', () => {
    expect(parseTzOffsetMinutes('Etc/GMT-7')).toBe(-420);
  });
  test('GMT-6 (POSIX-flipped) → 360', () => {
    expect(parseTzOffsetMinutes('GMT-6')).toBe(360);
  });
  test('UTC+7 → -420', () => {
    expect(parseTzOffsetMinutes('UTC+7')).toBe(-420);
  });
  test('numeric string passes through', () => {
    expect(parseTzOffsetMinutes('420')).toBe(420);
    expect(parseTzOffsetMinutes('-420')).toBe(-420);
  });
  test('invalid/missing → 0', () => {
    expect(parseTzOffsetMinutes('')).toBe(0);
    expect(parseTzOffsetMinutes(null)).toBe(0);
    expect(parseTzOffsetMinutes('America/New_York')).toBe(0); // not supported (would need IANA db)
  });
});

describe('aggregateForDate respects tz offset', () => {
  beforeEach(async () => {
    await prisma.orderTransaction.deleteMany({ where: { userId } });
    await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
    await prisma.order.deleteMany({ where: { userId } });
  });

  test('order at 23:30 local GMT-6 (= 05:30 UTC next day) is bucketed into local-day, not UTC-day', async () => {
    // UTC instant = April 15 05:30 → in GMT-6 that's April 14 23:30 local
    const utcInstant = new Date('2026-04-15T05:30:00Z');
    const order = await prisma.order.create({
      data: {
        userId, storeId, shopifyOrderId: 'TZ1', orderNumber: 'TZ1', currency: 'USD', status: 'paid',
        totalAmount: 100, subtotalPrice: new Prisma.Decimal(100),
        processedAt: utcInstant, shopifyCreatedAt: utcInstant
      }
    });
    await prisma.orderLineItem.create({
      data: { orderId: order.id, shopifyLineItemId: 'l1', quantity: 1, price: new Prisma.Decimal(100), unitCostSnapshot: new Prisma.Decimal(40) }
    });

    // Querying "April 14" with GMT-6 (offset 360) should INCLUDE the order
    const local14 = await aggregateForDate(userId, storeId, new Date('2026-04-14T00:00:00Z'), 360);
    expect(local14.orderCount).toBe(1);
    expect(local14.grossRevenue).toBe(100);

    // Querying "April 15" with GMT-6 should NOT include it (it's still April 14 local)
    const local15 = await aggregateForDate(userId, storeId, new Date('2026-04-15T00:00:00Z'), 360);
    expect(local15.orderCount).toBe(0);

    // Querying "April 15" with UTC (offset 0) WOULD include it (UTC sees it on April 15)
    const utc15 = await aggregateForDate(userId, storeId, new Date('2026-04-15T00:00:00Z'), 0);
    expect(utc15.orderCount).toBe(1);
  });

  test('order at 06:00 local GMT-6 (= 12:00 UTC same day) is bucketed correctly in either tz', async () => {
    const utcInstant = new Date('2026-04-15T12:00:00Z');
    const order = await prisma.order.create({
      data: {
        userId, storeId, shopifyOrderId: 'TZ2', orderNumber: 'TZ2', currency: 'USD', status: 'paid',
        totalAmount: 50, subtotalPrice: new Prisma.Decimal(50),
        processedAt: utcInstant, shopifyCreatedAt: utcInstant
      }
    });
    await prisma.orderLineItem.create({
      data: { orderId: order.id, shopifyLineItemId: 'l1', quantity: 1, price: new Prisma.Decimal(50), unitCostSnapshot: new Prisma.Decimal(20) }
    });

    const localGmt6 = await aggregateForDate(userId, storeId, new Date('2026-04-15T00:00:00Z'), 360);
    expect(localGmt6.orderCount).toBe(1);
    const utc = await aggregateForDate(userId, storeId, new Date('2026-04-15T00:00:00Z'), 0);
    expect(utc.orderCount).toBe(1);
  });
});
