import { PrismaClient, Prisma } from '@prisma/client';
import { seedDefaultPricebooks } from '../src/services/pricebook-seed.service';

const prisma = new PrismaClient();
const userId = '00000000-0000-0000-0000-00000000ps01';
const storeId = '00000000-0000-0000-0000-00000000ps01';

async function reset() {
  await prisma.pricebookShippingTier.deleteMany({ where: { pricebook: { userId } } });
  await prisma.pricebook.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'ps-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'ps-test.myshopify.com', accessToken: 'x' } });
});
afterAll(async () => { await reset(); await prisma.$disconnect(); });

describe('seedDefaultPricebooks', () => {
  test('first run creates 5 pricebooks (US, UK, GB, CA, AU) with tiers', async () => {
    const r = await seedDefaultPricebooks(userId, storeId);
    expect(r.pricebooksCreated).toBe(5);
    expect(r.pricebooksUpdated).toBe(0);
    expect(r.tiersWritten).toBeGreaterThanOrEqual(5 * 3); // 2 anchored + 1 extrapolated per country

    const us = await prisma.pricebook.findFirst({
      where: { userId, storeId, countryCode: 'US' },
      include: { shippingTiers: { orderBy: { minItems: 'asc' } } }
    });
    expect(us).toBeTruthy();
    expect(us!.supplier).toBe('Default');
    expect(us!.shippingCompany).toBe('Default');
    expect(us!.shippingTiers.length).toBe(3); // qty=1, qty=2, qty=3..999
    expect(Number(us!.shippingTiers[0].shippingCost)).toBe(22);
    expect(Number(us!.shippingTiers[1].shippingCost)).toBe(38.9);
    // Extrapolated tier 3..999
    expect(us!.shippingTiers[2].minItems).toBe(3);
    expect(us!.shippingTiers[2].maxItems).toBe(999);
    // Cost(3) = 38.9 + (38.9-22) = 55.8
    expect(Number(us!.shippingTiers[2].shippingCost)).toBeCloseTo(55.8, 1);
  });

  test('idempotent: re-running updates existing pricebooks rather than duplicating', async () => {
    const r2 = await seedDefaultPricebooks(userId, storeId);
    expect(r2.pricebooksCreated).toBe(0);
    expect(r2.pricebooksUpdated).toBe(5);

    const count = await prisma.pricebook.count({ where: { userId, storeId } });
    expect(count).toBe(5);
  });

  test('different supplier creates a separate set of pricebooks', async () => {
    const r = await seedDefaultPricebooks(userId, storeId, { supplier: 'YunExpress', shippingCompany: 'YunExpress' });
    expect(r.pricebooksCreated).toBe(5);
    const total = await prisma.pricebook.count({ where: { userId, storeId } });
    expect(total).toBe(10); // 5 Default + 5 YunExpress
  });

  test('UK and GB rates match (Shopify uses GB code)', async () => {
    const uk = await prisma.pricebook.findFirst({
      where: { userId, storeId, countryCode: 'UK', supplier: 'Default' },
      include: { shippingTiers: true }
    });
    const gb = await prisma.pricebook.findFirst({
      where: { userId, storeId, countryCode: 'GB', supplier: 'Default' },
      include: { shippingTiers: true }
    });
    expect(uk).toBeTruthy();
    expect(gb).toBeTruthy();
    expect(Number(uk!.shippingTiers.find(t => t.minItems === 1)!.shippingCost)).toBe(19.10);
    expect(Number(gb!.shippingTiers.find(t => t.minItems === 1)!.shippingCost)).toBe(19.10);
  });
});
