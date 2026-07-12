import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import { resolveShippingCompanyForOrder, extractTrackingPrefix } from './shipping-company.service';
import { recomputeOrderCostSnapshots } from './order-sync.service';
import { decryptToken } from '../lib/token-crypto';

const prisma = new PrismaClient();
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const THROTTLE_MS = parseInt(process.env.SHOPIFY_THROTTLE_MS || '500', 10);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * For every order in `[since, until]` that doesn't have a shippingCompany set,
 * fetch the fulfillment(s) from Shopify and resolve the carrier:
 *   1. fulfillment.tracking_company directly
 *   2. tracking number prefix → matched against ShippingCompany registry
 *   3. AUTO-CREATE a ShippingCompany row whose name = first 2 letters of the
 *      tracking number prefix (the user can rename later)
 *
 * After updating Order.shippingCompany, recomputes cost snapshots so any
 * Pricebook hit on the new carrier is reflected.
 *
 * Returns counts; rate-limit safe via 500ms throttle.
 */
export async function backfillShippingCompaniesFromTracking(
  storeId: string,
  windowDays: number = 30
): Promise<{ scanned: number; updated: number; createdCarriers: string[]; errors: string[] }> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');

  const since = new Date(Date.now() - windowDays * 86400000);
  const orders = await prisma.order.findMany({
    where: {
      storeId,
      shopifyCreatedAt: { gte: since }
    },
    select: { id: true, shopifyOrderId: true, shippingCompany: true, orderNumber: true }
  });

  const errors: string[] = [];
  const createdCarriers = new Set<string>();
  const carriersBeforeRun = new Set(
    (await prisma.shippingCompany.findMany({ select: { name: true } })).map(c => c.name)
  );
  let updated = 0;

  for (const o of orders) {
    try {
      // Hit Shopify to get fresh fulfillment data — order JSON in our DB doesn't
      // store fulfillments[]. This is the same per-order pattern the sync uses
      // for transactions, so the throttle is identical.
      await sleep(THROTTLE_MS);
      const url = `https://${store.storeDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${o.shopifyOrderId}.json?fields=id,fulfillments`;
      const res = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': decryptToken(store.accessToken), 'Accept': 'application/json' }
      });
      if (!res.ok) {
        errors.push(`#${o.orderNumber}: ${res.status} ${await res.text()}`);
        continue;
      }
      const body = await res.json() as { order?: { fulfillments?: any[] } };
      const fulfillments = body.order?.fulfillments || [];
      if (fulfillments.length === 0) continue;

      // Per user spec: backfill ALWAYS re-detects via tracking-number prefix
      // and uses the first 2 letters as both name and code. Shopify's
      // `tracking_company` (often "Other") is intentionally ignored here.
      const fulfillment = fulfillments[0];
      const trackingNumber: string = fulfillment.tracking_number || (Array.isArray(fulfillment.tracking_numbers) ? fulfillment.tracking_numbers[0] : '');
      let carrierName: string | null = null;

      if (trackingNumber) {
        const prefix = extractTrackingPrefix(trackingNumber);
        if (prefix && prefix.length >= 2) {
          // Apply user's "first 2 letters" rule for the carrier name
          const code = prefix.slice(0, 2);
          // Check existing by name
          const existing = await prisma.shippingCompany.findFirst({ where: { name: code } });
          if (existing) {
            // Make sure prefix is registered
            const regs = (existing.tracking_prefixes || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            if (!regs.includes(prefix)) {
              const next = (existing.tracking_prefixes ? existing.tracking_prefixes + ',' : '') + prefix;
              await prisma.shippingCompany.update({ where: { id: existing.id }, data: { tracking_prefixes: next } });
            }
            carrierName = code;
          } else {
            await prisma.shippingCompany.create({
              data: {
                name: code,
                display_name: code,
                tracking_prefixes: prefix,
                is_active: true
              }
            });
            carrierName = code;
            if (!carriersBeforeRun.has(code)) createdCarriers.add(code);
          }
        }
      }

      if (carrierName && carrierName !== o.shippingCompany) {
        await prisma.order.update({
          where: { id: o.id },
          data: { shippingCompany: carrierName }
        });
        updated++;
      }

      // After the carrier is set, recompute the order's cost snapshots so any
      // pricebook keyed on (supplier, country, carrierName) takes effect.
      await recomputeOrderCostSnapshots(store.userId, storeId, o.id);
    } catch (e: any) {
      errors.push(`#${o.orderNumber}: ${e?.message || String(e)}`);
    }
  }

  return {
    scanned: orders.length,
    updated,
    createdCarriers: Array.from(createdCarriers),
    errors
  };
}
