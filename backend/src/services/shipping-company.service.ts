import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Extract the leading alphabetic prefix from a tracking number.
 * Examples:
 *   LP1000046047358CN  -> "LP"
 *   YT2300000000001    -> "YT"
 *   1Z999AA10123456784 -> ""   (no leading letters → returns "" → handled by caller)
 *   ""                 -> null
 */
export function extractTrackingPrefix(trackingNumber: string | null | undefined): string | null {
  if (!trackingNumber) return null;
  const normalized = trackingNumber.trim().toUpperCase().replace(/\s/g, '');
  if (!normalized) return null;
  const m = normalized.match(/^([A-Z]+)/);
  return m && m[1] ? m[1] : null;
}

/**
 * Detect a shipping company by matching tracking_prefixes against known
 * ShippingCompany rows. Returns the company name if any prefix matches.
 */
export async function detectShippingCompanyByPrefix(trackingNumber: string): Promise<string | null> {
  const prefix = extractTrackingPrefix(trackingNumber);
  if (!prefix) return null;

  const companies = await prisma.shippingCompany.findMany({
    where: { is_active: true, tracking_prefixes: { not: null } },
    select: { name: true, tracking_prefixes: true }
  });

  for (const c of companies) {
    if (!c.tracking_prefixes) continue;
    const prefixes = c.tracking_prefixes
      .split(',')
      .map(p => p.trim().toUpperCase())
      .filter(Boolean);
    for (const p of prefixes) {
      if (prefix.startsWith(p) || p === prefix) return c.name;
    }
  }
  return null;
}

/**
 * Resolve a shipping company name from an order's fulfillment data.
 * Priority:
 *   1. fulfillment.tracking_company (Shopify-supplied carrier name) — most reliable
 *   2. tracking number prefix → match against ShippingCompany.tracking_prefixes
 *   3. tracking number prefix → auto-create a new ShippingCompany row with that prefix as both name and prefix
 *   4. null (caller will fall back to store default)
 *
 * Always returns a string when ANY tracking info is present (auto-creates if needed).
 */
export async function resolveShippingCompanyForOrder(order: any): Promise<string | null> {
  const fulfillment = Array.isArray(order.fulfillments) && order.fulfillments.length > 0 ? order.fulfillments[0] : null;
  if (!fulfillment) return null;

  // 1. Direct tracking_company from Shopify
  const trackingCompany: string | null = fulfillment.tracking_company || fulfillment.tracking_info?.company || null;
  if (trackingCompany && trackingCompany.trim()) return trackingCompany.trim();

  // 2 & 3. Tracking number prefix
  const trackingNumber: string | null = fulfillment.tracking_number || (Array.isArray(fulfillment.tracking_numbers) ? fulfillment.tracking_numbers[0] : null);
  if (!trackingNumber) return null;

  const matched = await detectShippingCompanyByPrefix(trackingNumber);
  if (matched) return matched;

  // 3. Auto-create from prefix — name = prefix (user can rename later)
  const prefix = extractTrackingPrefix(trackingNumber);
  if (!prefix) return null;

  // Upsert: race-safe vs concurrent sync workers
  const existing = await prisma.shippingCompany.findFirst({
    where: { name: prefix }
  });
  if (existing) {
    // Make sure the prefix is registered on it
    if (!existing.tracking_prefixes || !existing.tracking_prefixes.split(',').map(p => p.trim().toUpperCase()).includes(prefix)) {
      const updated = (existing.tracking_prefixes ? existing.tracking_prefixes + ',' : '') + prefix;
      await prisma.shippingCompany.update({ where: { id: existing.id }, data: { tracking_prefixes: updated } });
    }
    return existing.name;
  }

  await prisma.shippingCompany.create({
    data: {
      name: prefix,
      display_name: prefix,
      tracking_prefixes: prefix,
      is_active: true
    }
  });
  return prefix;
}
