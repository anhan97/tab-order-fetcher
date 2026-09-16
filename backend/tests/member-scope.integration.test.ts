/**
 * Two regressions, end to end against a real Postgres.
 *
 * 1. A manager granted a store saw an empty P&L (no revenue, no ad spend) and
 *    their manual costs vanished. resolveStore resolved req.resolved.userId to
 *    the MANAGER, but every store row is keyed by the OWNER's userId.
 *
 * 2. Combo pricing: an order whose items exactly match a combo priced on its
 *    ship line is costed at the combo price, split across the items.
 *
 * OPT-IN, same rules as store-member.integration.test.ts: set TEST_DATABASE_URL
 * AND DATABASE_URL to the same throwaway, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { resolveStore } from '../src/middleware/resolve-store';
import { recomputeOrderCostSnapshots } from '../src/services/order-sync.service';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const db = TEST_DB_URL ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } }) : null;

let live = false;
if (!db) {
  console.warn('[member-scope] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[member-scope] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT 1 FROM "CogsCombo" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[member-scope] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `scope-${suffix}.myshopify.com`;
const SECRET = process.env.JWT_SECRET || 'default-secret';
let ownerId = '', managerId = '', storeId = '';

beforeAll(async () => {
  if (!live || !db) return;
  const mk = async (who: string) => (await db.user.create({
    data: { email: `${who}-${suffix}@memberscope.test`, password: 'x', isVerified: true, status: 'ACTIVE' }
  })).id;
  ownerId = await mk('owner');
  managerId = await mk('manager');
  storeId = (await db.shopifyStore.create({
    data: { userId: ownerId, storeDomain: DOMAIN, accessToken: 'blob', isActive: true }
  })).id;
  await db.storeMember.create({ data: { userId: managerId, storeId, role: 'manager' } });
});

afterAll(async () => {
  if (!db) return;
  try {
    if (live && storeId) {
      await db.cogsCombo.deleteMany({ where: { storeId } });
      await db.cogsLine.deleteMany({ where: { storeId } });
      await db.order.deleteMany({ where: { storeId } });
      await db.productVariant.deleteMany({ where: { storeId } });
      await db.storeMember.deleteMany({ where: { storeId } });
      await db.shopifyStore.deleteMany({ where: { id: storeId } });
      await db.user.deleteMany({ where: { email: { endsWith: '@memberscope.test' } } });
    }
  } finally {
    await db.$disconnect();
  }
});

/** Run the real middleware with a signed JWT and the store-domain header. */
function resolveAs(userId: string): Promise<{ status: number; resolved?: any }> {
  const token = jwt.sign({ id: userId }, SECRET);
  const req: any = {
    headers: { 'x-shopify-store-domain': DOMAIN, authorization: `Bearer ${token}` },
    header(name: string) { return this.headers[name.toLowerCase()]; },
    query: {},
    body: {}
  };
  return new Promise(resolve => {
    const res: any = {
      statusCode: 200,
      status(c: number) { this.statusCode = c; return this; },
      json() { resolve({ status: this.statusCode }); return this; }
    };
    resolveStore(req, res, () => resolve({ status: 200, resolved: req.resolved }));
  });
}

describe('granted members resolve to the owner\'s data', () => {
  maybe()('the owner resolves to themself', async () => {
    const r = await resolveAs(ownerId);
    expect(r.resolved.userId).toBe(ownerId);
    expect(r.resolved.actorId).toBe(ownerId);
    expect(r.resolved.level).toBe('owner');
  });

  maybe()('a manager resolves to the OWNER as data tenant, and to themself as actor', async () => {
    const r = await resolveAs(managerId);
    expect(r.status).toBe(200);
    expect(r.resolved.storeId).toBe(storeId);
    expect(r.resolved.userId).toBe(ownerId);
    expect(r.resolved.actorId).toBe(managerId);
    expect(r.resolved.level).toBe('manager');
  });

  maybe()('a cost saved through a manager\'s request lands on the owner\'s P&L', async () => {
    const r = await resolveAs(managerId);
    const { userId } = r.resolved;
    await db!.operatingCost.create({
      data: { userId, storeId, date: new Date('2026-09-01'), category: 'fb_ads', amount: new Prisma.Decimal(42) }
    });
    const ownerView = await db!.operatingCost.findMany({ where: { userId: ownerId, storeId } });
    expect(ownerView.map(c => Number(c.amount))).toContain(42);
    await db!.operatingCost.deleteMany({ where: { storeId } });
  });
});

describe('combo pricing reaches the order cost snapshot', () => {
  maybe()('an exact basket match is costed at the combo price, split by item price', async () => {
    const SHIRT = BigInt(`9${Date.now()}1`.slice(0, 15));
    const CAP = BigInt(`9${Date.now()}2`.slice(0, 15));
    for (const [variantId, title] of [[SHIRT, 'Shirt'], [CAP, 'Cap']] as const) {
      await db!.productVariant.create({
        data: { variantId, productId: variantId, userId: ownerId, storeId, title, basecost: new Prisma.Decimal(0) }
      });
    }

    const line = await db!.cogsLine.create({
      data: { userId: ownerId, storeId, supplier: 'Default', carrier: 'YT', countryCode: 'US', setSizes: [1] }
    });
    // Alone: shirt 20, cap 10 → 30 bought separately.
    await db!.cogsPrice.createMany({
      data: [
        { lineId: line.id, variantId: SHIRT, setQty: 1, productCost: new Prisma.Decimal(15), shippingCost: new Prisma.Decimal(5), cost: new Prisma.Decimal(20) },
        { lineId: line.id, variantId: CAP, setQty: 1, productCost: new Prisma.Decimal(7), shippingCost: new Prisma.Decimal(3), cost: new Prisma.Decimal(10) }
      ]
    });
    // Together they ship as one parcel: 24 instead of 30.
    const combo = await db!.cogsCombo.create({
      data: {
        userId: ownerId, storeId, name: 'Shirt + Cap',
        items: [{ variantId: String(SHIRT), qty: 1 }, { variantId: String(CAP), qty: 1 }],
        signature: [SHIRT, CAP].map(String).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map(v => `${v}x1`).join(',')
      }
    });
    await db!.cogsComboPrice.create({
      data: { comboId: combo.id, lineId: line.id, productCost: new Prisma.Decimal(20), shippingCost: new Prisma.Decimal(4), cost: new Prisma.Decimal(24) }
    });

    const order = await db!.order.create({
      data: {
        userId: ownerId, storeId, shopifyOrderId: `o-${suffix}`, orderNumber: '1001',
        totalAmount: 50, currency: 'USD', status: 'paid',
        shippingCompany: 'YT', shippingCountryCode: 'US',
        lineItems: {
          create: [
            { shopifyLineItemId: `li1-${suffix}`, variantId: SHIRT, quantity: 1, price: new Prisma.Decimal(30) },
            { shopifyLineItemId: `li2-${suffix}`, variantId: CAP, quantity: 1, price: new Prisma.Decimal(20) }
          ]
        }
      }
    });

    await recomputeOrderCostSnapshots(ownerId, storeId, order.id);

    const items = await db!.orderLineItem.findMany({ where: { orderId: order.id } });
    const byVariant = new Map(items.map(i => [String(i.variantId), Number(i.unitBasecost)]));
    // 24 split 2:1 by the standalone prices (20 vs 10).
    expect(byVariant.get(String(SHIRT))).toBe(16);
    expect(byVariant.get(String(CAP))).toBe(8);
    expect(byVariant.get(String(SHIRT))! + byVariant.get(String(CAP))!).toBe(24);
  });

  maybe()('a basket that is NOT exactly the combo falls back to per-item prices', async () => {
    const variants = await db!.productVariant.findMany({ where: { storeId }, orderBy: { title: 'desc' } });
    const [shirt] = variants.filter(v => v.title === 'Shirt');
    const order = await db!.order.create({
      data: {
        userId: ownerId, storeId, shopifyOrderId: `o2-${suffix}`, orderNumber: '1002',
        totalAmount: 30, currency: 'USD', status: 'paid',
        shippingCompany: 'YT', shippingCountryCode: 'US',
        lineItems: {
          create: [{ shopifyLineItemId: `li3-${suffix}`, variantId: shirt.variantId, quantity: 1, price: new Prisma.Decimal(30) }]
        }
      }
    });

    await recomputeOrderCostSnapshots(ownerId, storeId, order.id);
    const [item] = await db!.orderLineItem.findMany({ where: { orderId: order.id } });
    expect(Number(item.unitBasecost)).toBe(20);
  });
});
