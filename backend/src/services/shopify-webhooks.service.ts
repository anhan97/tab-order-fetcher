/**
 * Shopify webhook registration + processing.
 *
 * Registration: after OAuth install we subscribe to order + uninstall
 * topics pointing at /api/webhooks/shopify. Idempotent — existing
 * subscriptions with the same topic+address are kept.
 *
 * Processing: HMAC-verified (route layer), deduped via WebhookEvent
 * (unique X-Shopify-Webhook-Id), then dispatched per topic. Order payloads
 * run through the same upsert pipeline as the batch sync.
 */
import { PrismaClient } from '@prisma/client';
import { ingestOrderPayload } from './order-sync.service';

const prisma = new PrismaClient();
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

export const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'app/uninstalled'
];

export async function registerShopifyWebhooks(shopDomain: string, accessToken: string, baseUrl: string): Promise<{ created: number; existing: number; errors: string[] }> {
  const address = `${baseUrl.replace(/\/$/, '')}/api/webhooks/shopify`;
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  };

  const listRes = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json?limit=250`, { headers });
  if (!listRes.ok) throw new Error(`list webhooks failed: ${listRes.status} ${await listRes.text()}`);
  const existing = ((await listRes.json() as any).webhooks || []) as Array<{ id: number; topic: string; address: string }>;

  const result = { created: 0, existing: 0, errors: [] as string[] };
  for (const topic of WEBHOOK_TOPICS) {
    if (existing.some(w => w.topic === topic && w.address === address)) {
      result.existing++;
      continue;
    }
    const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ webhook: { topic, address, format: 'json' } })
    });
    if (res.ok) {
      result.created++;
    } else {
      result.errors.push(`${topic}: ${res.status} ${(await res.text()).slice(0, 150)}`);
    }
  }
  console.log(`[webhooks] ${shopDomain}: ${result.created} created, ${result.existing} existing${result.errors.length ? `, errors: ${result.errors.join(' | ')}` : ''}`);
  return result;
}

/**
 * Process one webhook delivery. Idempotent on webhookId. Never throws for
 * per-store processing failures — the error is recorded on the ledger row
 * (Shopify would otherwise retry a payload that consistently fails and then
 * drop our subscription).
 */
export async function processShopifyWebhook(
  webhookId: string,
  topic: string,
  shopDomain: string,
  payload: any
): Promise<{ duplicate: boolean }> {
  const existing = await prisma.webhookEvent.findUnique({ where: { shopifyId: webhookId } });
  if (existing) return { duplicate: true };

  await prisma.webhookEvent.create({
    data: { shopifyId: webhookId, topic, shopDomain, payload: payload ?? {}, processed: false }
  });

  let error: string | null = null;
  try {
    // A domain can legitimately map to several store rows (multiple users
    // connected the same store). Fan the event out to each.
    const stores = await prisma.shopifyStore.findMany({
      where: { storeDomain: shopDomain, isActive: true }
    });
    if (stores.length === 0) {
      error = `no active store for ${shopDomain}`;
    } else if (topic.startsWith('orders/')) {
      for (const store of stores) {
        await ingestOrderPayload(store.id, payload);
      }
    } else if (topic === 'app/uninstalled') {
      await prisma.shopifyStore.updateMany({
        where: { storeDomain: shopDomain, isActive: true },
        data: { isActive: false }
      });
      console.log(`[webhooks] ${shopDomain} uninstalled — store(s) deactivated`);
    }
  } catch (e: any) {
    error = e?.message || String(e);
    console.error(`[webhooks] processing ${topic} for ${shopDomain} failed:`, error);
  }

  await prisma.webhookEvent.update({
    where: { shopifyId: webhookId },
    data: { processed: !error, error }
  });
  return { duplicate: false };
}

/**
 * Verify Shopify webhook HMAC (base64 over raw body).
 *
 * The whole system connects stores through ONE global app, so the delivery
 * is signed with that app's secret: the admin-managed ShopifyAppConfig, or
 * the env fallback. Accept if either matches.
 */
export async function verifyWebhookHmac(_shopDomain: string, rawBody: string, hmacHeader: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const crypto = require('crypto') as typeof import('crypto');
  const { decryptToken } = await import('../lib/token-crypto');

  const secrets = new Set<string>();
  if (process.env.SHOPIFY_CLIENT_SECRET) secrets.add(process.env.SHOPIFY_CLIENT_SECRET);
  try {
    const cfg = await prisma.shopifyAppConfig.findUnique({ where: { id: 'singleton' } });
    if (cfg) secrets.add(decryptToken(cfg.clientSecret));
  } catch (e: any) {
    console.warn('[webhooks] secret lookup failed:', e?.message);
  }

  for (const secret of secrets) {
    const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    try {
      if (crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmacHeader, 'utf8'))) return true;
    } catch { /* length mismatch — try next */ }
  }
  return false;
}
