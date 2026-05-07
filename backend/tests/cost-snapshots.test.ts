import { PrismaClient, Prisma } from '@prisma/client';
import { recomputeOrderCostSnapshots } from '../src/services/order-sync.service';

const prisma = new PrismaClient();

const userId = '00000000-0000-0000-0000-00000000cs01';
const storeId = '00000000-0000-0000-0000-00000000cs01';

async function reset() {
  await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.pricebookShippingTier.deleteMany({ where: { pricebook: { userId } } });
  await prisma.pricebookVariantCostOverride.deleteMany({ where: { pricebook: { userId } } });
  await prisma.pricebook.deleteMany({ where: { userId } });
  await prisma.productVariant.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'cs-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'cs-test.myshopify.com', accessToken: 'x' } });

  // Variant with baseCost = $10
  await prisma.productVariant.create({
    data: {
      variantId: BigInt(101), userId, storeId,
      title: 'Test variant', productId: BigInt(1), baseCost: new Prisma.Decimal(10)
    }
  });

  // Pricebook for US + LP supplier — variant override = $7, ship tier 1-2 = $3, 3+ = $5
  const pb = await prisma.pricebook.create({
    data: { userId, storeId, countryCode: 'US', shippingCompany: 'LP', currency: 'USD' }
  });
  await prisma.pricebookShippingTier.createMany({
    data: [
      { pricebookId: pb.pricebookId, minItems: 1, maxItems: 2, shippingCost: new Prisma.Decimal(3) },
      { pricebookId: pb.pricebookId, minItems: 3, maxItems: 999, shippingCost: new Prisma.Decimal(5) }
    ]
  });
  await prisma.pricebookVariantCostOverride.create({
    data: { pricebookId: pb.pricebookId, variantId: BigInt(101), overrideCost: new Prisma.Decimal(7) }
  });
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.orderLineItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
});

async function makeOrder(opts: { country: string | null; supplier: string | null; carrier?: string | null; qty: number }): Promise<string> {
  const order = await prisma.order.create({
    data: {
      userId, storeId,
      shopifyOrderId: 'CS' + Date.now() + Math.random(),
      orderNumber: 'CS-test',
      currency: 'USD', status: 'paid',
      totalAmount: 100,
      shippingCountryCode: opts.country,
      shippingCompany: opts.carrier !== undefined ? opts.carrier : opts.supplier
    }
  });
  await prisma.orderLineItem.create({
    data: {
      orderId: order.id, shopifyLineItemId: 'l1', quantity: opts.qty,
      variantId: BigInt(101), price: new Prisma.Decimal(50)
    }
  });
  return order.id;
}

describe('recomputeOrderCostSnapshots', () => {
  test('Pricebook hit: uses variant override + ship tier', async () => {
    const id = await makeOrder({ country: 'US', supplier: 'LP', qty: 2 });
    await recomputeOrderCostSnapshots(userId, storeId, id);

    const o = await prisma.order.findUnique({ where: { id }, include: { lineItems: true } });
    expect(o!.lineItems[0].unitCostSnapshot?.toString()).toBe('7'); // override
    expect(o!.shippingCostSnapshot?.toString()).toBe('3'); // tier 1-2
  });

  test('Pricebook hit: ship tier picks 3+ bracket for qty=3', async () => {
    const id = await makeOrder({ country: 'US', supplier: 'LP', qty: 3 });
    await recomputeOrderCostSnapshots(userId, storeId, id);
    const o = await prisma.order.findUnique({ where: { id } });
    expect(o!.shippingCostSnapshot?.toString()).toBe('5');
  });

  test('No pricebook anywhere for country: falls back to baseCost, ship cost = 0', async () => {
    // CA has no pricebook at all → no fallback even via Default supplier
    const id = await makeOrder({ country: 'CA', supplier: 'LP', qty: 1 });
    await recomputeOrderCostSnapshots(userId, storeId, id);
    const o = await prisma.order.findUnique({ where: { id }, include: { lineItems: true } });
    expect(o!.lineItems[0].unitCostSnapshot?.toString()).toBe('10'); // base cost
    expect(o!.shippingCostSnapshot?.toString()).toBe('0');
  });

  test('Missing supplier on order: cascades to (Default supplier, country, carrier)', async () => {
    // Order has no supplier but DOES have a carrier (LP). The pricebook in
    // this suite is keyed (Default, US, LP) — the cascade's step 3 should
    // hit it via the Default-supplier branch.
    const id = await makeOrder({ country: 'US', supplier: null, carrier: 'LP', qty: 1 });
    await recomputeOrderCostSnapshots(userId, storeId, id);
    const o = await prisma.order.findUnique({ where: { id }, include: { lineItems: true } });
    expect(o!.lineItems[0].unitCostSnapshot?.toString()).toBe('7'); // override
    expect(o!.shippingCostSnapshot?.toString()).toBe('3'); // tier 1-2
  });

  test('Order with no line items: shippingCostSnapshot stays at 0 (no-op)', async () => {
    const order = await prisma.order.create({
      data: {
        userId, storeId, shopifyOrderId: 'EMPTY' + Date.now(), orderNumber: 'EMPTY',
        currency: 'USD', status: 'paid', totalAmount: 0,
        shippingCountryCode: 'US', shippingCompany: 'LP'
      }
    });
    await recomputeOrderCostSnapshots(userId, storeId, order.id);
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(num(o!.shippingCostSnapshot)).toBe(0);
  });
});

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v);
}
