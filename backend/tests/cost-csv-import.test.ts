import { PrismaClient, Prisma } from '@prisma/client';
import { parseCsv, parseMoney, normalizeCountry, importCostCsv } from '../src/services/cost-csv-import.service';

const prisma = new PrismaClient();
const userId = '00000000-0000-0000-0000-00000000ci01';
const storeId = '00000000-0000-0000-0000-00000000ci01';

async function reset() {
  await prisma.pricebookVariantCostOverride.deleteMany({ where: { pricebook: { userId } } });
  await prisma.pricebookShippingTier.deleteMany({ where: { pricebook: { userId } } });
  await prisma.pricebook.deleteMany({ where: { userId } });
  await prisma.productVariant.deleteMany({ where: { userId } });
  await prisma.shopifyStore.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
  await reset();
  await prisma.user.create({ data: { id: userId, email: 'csv-test@example.com', password: 'x', isVerified: true } });
  await prisma.shopifyStore.create({ data: { id: storeId, userId, storeDomain: 'csv-test.myshopify.com', accessToken: 'x' } });
  // Seed two variants the CSV references
  await prisma.productVariant.upsert({
    where: { variantId: BigInt(900001) },
    create: { variantId: BigInt(900001), userId, storeId, sku: 'LUNCHBAG-BLACK', title: 'Black tote', productId: BigInt(1), baseCost: new Prisma.Decimal(0) },
    update: {}
  });
  await prisma.productVariant.upsert({
    where: { variantId: BigInt(900002) },
    create: { variantId: BigInt(900002), userId, storeId, sku: 'LUNCHBAG-CLARET', title: 'Claret tote', productId: BigInt(1), baseCost: new Prisma.Decimal(0) },
    update: {}
  });
});

afterAll(async () => { await reset(); await prisma.$disconnect(); });

describe('parseMoney', () => {
  test('handles dollar prefix and decimals', () => {
    expect(parseMoney('$20.60')).toBe(20.60);
    expect(parseMoney('20.60')).toBe(20.60);
    expect(parseMoney('$1,234.56')).toBe(1234.56);
  });
  test('handles European decimal comma', () => {
    expect(parseMoney('20,60')).toBe(20.60);
  });
  test('returns null for empty/invalid', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('  ')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('normalizeCountry', () => {
  test('maps full names to ISO codes', () => {
    expect(normalizeCountry('United States')).toBe('US');
    expect(normalizeCountry('United Kingdom')).toBe('GB');
    expect(normalizeCountry('Australia')).toBe('AU');
    expect(normalizeCountry('Canada')).toBe('CA');
  });
  test('passes 2-letter codes through', () => {
    expect(normalizeCountry('US')).toBe('US');
    expect(normalizeCountry('au')).toBe('AU');
    expect(normalizeCountry('GB')).toBe('GB');
  });
  test('returns null for unknown / empty', () => {
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry('Mars')).toBeNull();
  });
});

describe('parseCsv', () => {
  const HEADER = ' ,Order Date,Product SKU,Product Name,STYLE(COLOR),Quantity,EMAIL,NAME,Address,City,State/Province,Postal Code,Country Code,Phone Number,Shipping cost,Final price,,,Tracking Number,Shipping costs,Fulfillment Status,Notes';

  test('parses normal rows', () => {
    const csv = HEADER + '\n4161,1/3/2026,LUNCHBAG-BLACK,Tote with lunch compartment,Black,1,a,a,a,a,a,1085,United States,a,$20.60,,,,LP1000038162557CN,,,';
    const rows = parseCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].orderId).toBe('4161');
    expect(rows[0].sku).toBe('LUNCHBAG-BLACK');
    expect(rows[0].quantity).toBe(1);
    expect(rows[0].country).toBe('US');
    expect(rows[0].shippingCost).toBe(20.60);
    expect(rows[0].trackingNumber).toBe('LP1000038162557CN');
  });

  test('skips blank lines and section-header rows', () => {
    const csv = HEADER + '\n,,,,,,,,,,,,,,,,,,,,,\n"4,22",,,,,,,,,,,,,,,,,,,,,\n4161,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,1085,United States,a,$20.60,,,,LP1234,,,';
    const rows = parseCsv(csv);
    expect(rows.length).toBe(1);
    expect(rows[0].orderId).toBe('4161');
  });

  test('handles 2-letter country code in CSV (US, AU)', () => {
    const csv = HEADER + '\n4309,3/4/2026,Bag-brown white,Tote,Beige/Brown,1,a,a,a,a,a,07011,US,a,$20.60,$20.60,,,SF6047423408274,,,';
    const rows = parseCsv(csv);
    expect(rows[0].country).toBe('US');
  });
});

describe('importCostCsv (DB integration)', () => {
  const HEADER = ' ,Order Date,Product SKU,Product Name,STYLE(COLOR),Quantity,EMAIL,NAME,Address,City,State/Province,Postal Code,Country Code,Phone Number,Shipping cost,Final price,,,Tracking Number,Shipping costs,Fulfillment Status,Notes';

  beforeEach(async () => {
    await prisma.pricebookVariantCostOverride.deleteMany({ where: { pricebook: { userId } } });
    await prisma.pricebookShippingTier.deleteMany({ where: { pricebook: { userId } } });
    await prisma.pricebook.deleteMany({ where: { userId } });
    await prisma.productVariant.update({ where: { variantId: BigInt(900001) }, data: { baseCost: new Prisma.Decimal(0) } });
    await prisma.productVariant.update({ where: { variantId: BigInt(900002) }, data: { baseCost: new Prisma.Decimal(0) } });
  });

  test('imports single-item per-SKU costs grouped by (country, carrier)', async () => {
    const csv = HEADER + [
      '',
      '4161,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,1,United States,a,$20.60,,,,LP1234,,,',
      '4162,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,2,United States,a,$20.60,,,,LP5678,,,',
      '4163,1/3/2026,LUNCHBAG-CLARET,Tote,Claret,1,a,a,a,a,a,3,United States,a,$13.80,,,,LP9999,,,',
      '4205,7/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,4,Canada,a,$13.10,,,,YT1111,,,'
    ].join('\n');

    const r = await importCostCsv(userId, storeId, csv);
    expect(r.totalRows).toBe(4);
    expect(r.singleItemOrders).toBe(4);
    expect(r.uniqueSkus).toBe(2);
    expect(r.uniqueCountries).toBe(2);
    expect(r.uniqueCarriers).toBe(2);
    expect(r.pricebooksTouched).toBe(2); // (US, LP) and (CA, YT)

    const pricebooks = await prisma.pricebook.findMany({
      where: { userId, storeId },
      include: { variantCostOverrides: true }
    });
    const usLp = pricebooks.find(p => p.countryCode === 'US' && p.shippingCompany === 'LP');
    const caYt = pricebooks.find(p => p.countryCode === 'CA' && p.shippingCompany === 'YT');
    expect(usLp).toBeTruthy();
    expect(caYt).toBeTruthy();

    // US/LP should have 2 overrides: BLACK ($20.60) and CLARET ($13.80)
    expect(usLp!.variantCostOverrides.length).toBe(2);
    const blackOverride = usLp!.variantCostOverrides.find(v => v.variantId === BigInt(900001));
    const claretOverride = usLp!.variantCostOverrides.find(v => v.variantId === BigInt(900002));
    expect(Number(blackOverride!.overrideCost)).toBe(20.60);
    expect(Number(claretOverride!.overrideCost)).toBe(13.80);

    // CA/YT should have 1 override for BLACK at $13.10
    expect(caYt!.variantCostOverrides.length).toBe(1);
    expect(Number(caYt!.variantCostOverrides[0].overrideCost)).toBe(13.10);
  });

  test('takes median when multiple samples for same (sku, country, carrier)', async () => {
    const csv = HEADER + [
      '',
      '4161,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,1,US,a,$20.60,,,,LP1,,,',
      '4162,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,2,US,a,$20.60,,,,LP2,,,',
      '4163,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,3,US,a,$13.80,,,,LP3,,,'
    ].join('\n');
    await importCostCsv(userId, storeId, csv);
    const pb = await prisma.pricebook.findFirst({
      where: { userId, storeId, countryCode: 'US', shippingCompany: 'LP' },
      include: { variantCostOverrides: true }
    });
    // Median of [13.80, 20.60, 20.60] = 20.60
    expect(Number(pb!.variantCostOverrides[0].overrideCost)).toBe(20.60);
  });

  test('updates ProductVariant.baseCost to cross-country median', async () => {
    const csv = HEADER + [
      '',
      '4161,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,1,US,a,$20.60,,,,LP1,,,',
      '4162,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,2,UK,a,$16.64,,,,LP2,,,',
      '4163,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,3,CA,a,$13.10,,,,YT3,,,'
    ].join('\n');
    await importCostCsv(userId, storeId, csv);
    const v = await prisma.productVariant.findUnique({ where: { variantId: BigInt(900001) } });
    expect(Number(v!.baseCost)).toBe(16.64); // median of 13.10, 16.64, 20.60
  });

  test('skips multi-item orders (cost per SKU is ambiguous)', async () => {
    const csv = HEADER + [
      '',
      '4209,8/3/2026,LUNCHBAG-BLACK,Tote,Black,2,a,a,a,a,a,1,US,a,$36.30,,,,LP1,,,'
    ].join('\n');
    const r = await importCostCsv(userId, storeId, csv);
    expect(r.singleItemOrders).toBe(0);
    const pb = await prisma.pricebook.findFirst({ where: { userId, storeId } });
    expect(pb).toBeNull(); // no single-item samples → no pricebook touched
  });

  test('reports unmapped SKUs', async () => {
    const csv = HEADER + [
      '',
      '4161,1/3/2026,UNKNOWN-SKU,Tote,Black,1,a,a,a,a,a,1,US,a,$20.60,,,,LP1,,,'
    ].join('\n');
    const r = await importCostCsv(userId, storeId, csv);
    expect(r.unmappedSkus).toContain('UNKNOWN-SKU');
    expect(r.variantOverridesWritten).toBe(0);
  });

  test('zeros out tier rows for touched pricebooks (avoids double-counting)', async () => {
    const csv = HEADER + [
      '',
      '4161,1/3/2026,LUNCHBAG-BLACK,Tote,Black,1,a,a,a,a,a,1,US,a,$20.60,,,,LP1,,,'
    ].join('\n');
    await importCostCsv(userId, storeId, csv);
    const tiers = await prisma.pricebookShippingTier.findMany({
      where: { pricebook: { userId, storeId } }
    });
    expect(tiers.length).toBe(1);
    expect(Number(tiers[0].shippingCost)).toBe(0);
  });
});
