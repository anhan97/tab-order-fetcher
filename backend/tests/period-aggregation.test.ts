import { PrismaClient, Prisma } from '@prisma/client';
import { aggregateByPeriod, compareTwoPeriods } from '../src/services/period-aggregation.service';

const prisma = new PrismaClient();
const userId = '00000000-0000-0000-0000-00000000pa01';
const storeId = '00000000-0000-0000-0000-00000000pa01';

async function reset() {
  await prisma.dailyPLSnapshot.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function seedSnapshot(date: Date, opts: Partial<{ rev: number; profit: number; orders: number; ads: number; cogs: number; ship: number }>) {
  await prisma.dailyPLSnapshot.create({
    data: {
      userId, storeId,
      date,
      grossRevenue: new Prisma.Decimal(opts.rev ?? 0),
      netRevenue: new Prisma.Decimal(opts.rev ?? 0),
      cogs: new Prisma.Decimal(opts.cogs ?? 0),
      shippingCost: new Prisma.Decimal(opts.ship ?? 0),
      fbAdSpend: new Prisma.Decimal(opts.ads ?? 0),
      grossProfit: new Prisma.Decimal((opts.rev ?? 0) - (opts.cogs ?? 0) - (opts.ship ?? 0)),
      netProfit: new Prisma.Decimal(opts.profit ?? 0),
      orderCount: opts.orders ?? 0
    }
  });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'pa-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'pa-test.myshopify.com', accessToken: 'x' } });
});

afterAll(async () => { await reset(); await prisma.$disconnect(); });

beforeEach(async () => { await prisma.dailyPLSnapshot.deleteMany({ where: { userId } }); });

describe('aggregateByPeriod', () => {
  test('groups daily snapshots into months correctly', async () => {
    // April: 2 days x $100 each = $200
    // May:   3 days x $50 each = $150
    await seedSnapshot(new Date('2026-04-01T00:00:00Z'), { rev: 100, profit: 30, orders: 2 });
    await seedSnapshot(new Date('2026-04-15T00:00:00Z'), { rev: 100, profit: 30, orders: 1 });
    await seedSnapshot(new Date('2026-05-05T00:00:00Z'), { rev: 50, profit: 10, orders: 1 });
    await seedSnapshot(new Date('2026-05-10T00:00:00Z'), { rev: 50, profit: 10, orders: 1 });
    await seedSnapshot(new Date('2026-05-30T00:00:00Z'), { rev: 50, profit: 10, orders: 1 });

    const months = await aggregateByPeriod(userId, storeId, new Date('2026-04-01'), new Date('2026-05-31'), 'month');
    expect(months.length).toBe(2);

    const apr = months.find(m => m.periodKey === '2026-04')!;
    const may = months.find(m => m.periodKey === '2026-05')!;
    expect(apr.netRevenue).toBe(200);
    expect(apr.netProfit).toBe(60);
    expect(apr.orderCount).toBe(3);
    expect(may.netRevenue).toBe(150);
    expect(may.netProfit).toBe(30);
    expect(may.orderCount).toBe(3);
  });

  test('quarter grouping puts Jan/Feb/Mar in Q1, Apr/May/Jun in Q2', async () => {
    await seedSnapshot(new Date('2026-02-01T00:00:00Z'), { rev: 50 });
    await seedSnapshot(new Date('2026-03-15T00:00:00Z'), { rev: 50 });
    await seedSnapshot(new Date('2026-04-15T00:00:00Z'), { rev: 100 });

    const qs = await aggregateByPeriod(userId, storeId, new Date('2026-01-01'), new Date('2026-12-31'), 'quarter');
    expect(qs.find(q => q.periodKey === '2026-Q1')!.netRevenue).toBe(100);
    expect(qs.find(q => q.periodKey === '2026-Q2')!.netRevenue).toBe(100);
  });

  test('year grouping sums correctly across multiple years', async () => {
    await seedSnapshot(new Date('2025-12-31T00:00:00Z'), { rev: 100 });
    await seedSnapshot(new Date('2026-01-01T00:00:00Z'), { rev: 200 });
    await seedSnapshot(new Date('2026-06-15T00:00:00Z'), { rev: 300 });

    const ys = await aggregateByPeriod(userId, storeId, new Date('2025-01-01'), new Date('2026-12-31'), 'year');
    expect(ys.find(y => y.periodKey === '2025')!.netRevenue).toBe(100);
    expect(ys.find(y => y.periodKey === '2026')!.netRevenue).toBe(500);
  });

  test('day grouping is identity (one bucket per day)', async () => {
    await seedSnapshot(new Date('2026-04-15T00:00:00Z'), { rev: 100, orders: 5 });
    await seedSnapshot(new Date('2026-04-16T00:00:00Z'), { rev: 200, orders: 3 });

    const days = await aggregateByPeriod(userId, storeId, new Date('2026-04-15'), new Date('2026-04-16'), 'day');
    expect(days.length).toBe(2);
    expect(days[0].periodKey).toBe('2026-04-15');
    expect(days[1].periodKey).toBe('2026-04-16');
    expect(days[0].orderCount).toBe(5);
    expect(days[1].orderCount).toBe(3);
  });

  test('week grouping uses ISO week (Mon-start)', async () => {
    // 2026-04-13 is Monday → week 16
    await seedSnapshot(new Date('2026-04-13T00:00:00Z'), { rev: 100 });
    await seedSnapshot(new Date('2026-04-15T00:00:00Z'), { rev: 50 }); // Wed same week
    await seedSnapshot(new Date('2026-04-20T00:00:00Z'), { rev: 200 }); // Mon next week

    const ws = await aggregateByPeriod(userId, storeId, new Date('2026-04-01'), new Date('2026-04-30'), 'week');
    expect(ws.length).toBe(2);
    // First week: $100 + $50 = $150
    expect(ws[0].netRevenue).toBe(150);
    expect(ws[1].netRevenue).toBe(200);
  });
});

describe('compareTwoPeriods', () => {
  test('current vs previous (equal length) computes deltaPct correctly', async () => {
    // Window: Apr 1 → Apr 30 (29 day rolling window). Previous: Mar 3 → Apr 1.
    // Seed dates carefully so they fall inside their windows.
    await seedSnapshot(new Date('2026-04-05T00:00:00Z'), { rev: 100, profit: 30, orders: 2 });
    await seedSnapshot(new Date('2026-04-15T00:00:00Z'), { rev: 100, profit: 30, orders: 2 });
    await seedSnapshot(new Date('2026-03-15T00:00:00Z'), { rev: 60, profit: 10, orders: 1 });
    await seedSnapshot(new Date('2026-03-25T00:00:00Z'), { rev: 40, profit: 10, orders: 1 });

    const cmp = await compareTwoPeriods(userId, storeId, new Date('2026-04-01'), new Date('2026-04-30'), 'month');
    expect(cmp.totals.current.netRevenue).toBe(200);
    expect(cmp.totals.previous.netRevenue).toBe(100);
    expect(cmp.totals.deltaPct.netRevenue).toBe(100); // doubled
    expect(cmp.totals.deltaPct.netProfit).toBe(200); // tripled
  });

  test('previous = 0 → deltaPct null (avoid div-by-zero)', async () => {
    await seedSnapshot(new Date('2026-04-01T00:00:00Z'), { rev: 100 });
    const cmp = await compareTwoPeriods(userId, storeId, new Date('2026-04-01'), new Date('2026-04-30'), 'month');
    expect(cmp.totals.deltaPct.netRevenue).toBeNull();
  });
});
