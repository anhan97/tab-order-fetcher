import { PrismaClient } from '@prisma/client';
import { extractTrackingPrefix, detectShippingCompanyByPrefix, resolveShippingCompanyForOrder } from '../src/services/shipping-company.service';

const prisma = new PrismaClient();

async function reset() {
  // Tests touch the global ShippingCompany table — clean only test rows.
  await prisma.shippingCompany.deleteMany({ where: { name: { in: ['LP', 'YT', 'YUNTU', 'DHL-TEST', 'AUTO-XYZ'] } } });
}

beforeAll(async () => {
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe('extractTrackingPrefix', () => {
  test('extracts leading letters from common tracking formats', () => {
    expect(extractTrackingPrefix('LP1000046047358CN')).toBe('LP');
    expect(extractTrackingPrefix('YT2300000000001')).toBe('YT');
    expect(extractTrackingPrefix('YUNTU123456789')).toBe('YUNTU');
    expect(extractTrackingPrefix('  lp123abc  ')).toBe('LP'); // case + whitespace
  });

  test('returns null for missing/empty/numeric-only input', () => {
    expect(extractTrackingPrefix('')).toBeNull();
    expect(extractTrackingPrefix('   ')).toBeNull();
    expect(extractTrackingPrefix(null)).toBeNull();
    expect(extractTrackingPrefix(undefined)).toBeNull();
    expect(extractTrackingPrefix('1234567890')).toBeNull(); // pure numeric → no leading letters
  });

  test('handles UPS-style tracking that starts with digits', () => {
    expect(extractTrackingPrefix('1Z999AA10123456784')).toBeNull();
  });
});

describe('detectShippingCompanyByPrefix', () => {
  beforeAll(async () => {
    await prisma.shippingCompany.create({
      data: { name: 'LP', display_name: 'LP', tracking_prefixes: 'LP', is_active: true }
    });
    await prisma.shippingCompany.create({
      data: { name: 'YUNTU', display_name: 'YunTu', tracking_prefixes: 'YT,YUNTU', is_active: true }
    });
  });

  test('matches single-prefix carrier', async () => {
    const r = await detectShippingCompanyByPrefix('LP1000046047358CN');
    expect(r).toBe('LP');
  });

  test('matches multi-prefix carrier (comma-separated)', async () => {
    expect(await detectShippingCompanyByPrefix('YT2300001')).toBe('YUNTU');
    expect(await detectShippingCompanyByPrefix('YUNTU555')).toBe('YUNTU');
  });

  test('returns null when no prefix matches', async () => {
    expect(await detectShippingCompanyByPrefix('ZZ9999999')).toBeNull();
  });
});

describe('resolveShippingCompanyForOrder', () => {
  test('uses fulfillment.tracking_company when present', async () => {
    const order = { fulfillments: [{ tracking_company: 'DHL Express', tracking_number: '1234567890' }] };
    expect(await resolveShippingCompanyForOrder(order)).toBe('DHL Express');
  });

  test('falls back to tracking-prefix detection when tracking_company missing', async () => {
    const order = { fulfillments: [{ tracking_company: '', tracking_number: 'LP1000046047358CN' }] };
    expect(await resolveShippingCompanyForOrder(order)).toBe('LP');
  });

  test('auto-creates ShippingCompany row from new prefix', async () => {
    // Prefix "AUTOXYZ" doesn't exist in DB
    const order = { fulfillments: [{ tracking_number: 'AUTOXYZ123456789' }] };
    const result = await resolveShippingCompanyForOrder(order);
    expect(result).toBe('AUTOXYZ');
    const row = await prisma.shippingCompany.findFirst({ where: { name: 'AUTOXYZ' } });
    expect(row).toBeTruthy();
    expect(row?.tracking_prefixes).toBe('AUTOXYZ');
    // cleanup this auto-created row
    await prisma.shippingCompany.delete({ where: { id: row!.id } });
  });

  test('returns null when fulfillments is empty', async () => {
    expect(await resolveShippingCompanyForOrder({})).toBeNull();
    expect(await resolveShippingCompanyForOrder({ fulfillments: [] })).toBeNull();
  });

  test('returns null when fulfillment has neither company nor tracking number', async () => {
    expect(await resolveShippingCompanyForOrder({ fulfillments: [{}] })).toBeNull();
  });
});
