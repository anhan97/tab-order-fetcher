/**
 * Shopify OAuth app-install flow (ShipBob-style connect) — replaces the
 * manual "paste an Admin API token" flow.
 *
 *   GET/PUT/DELETE /api/shopify/oauth/app   (JWT) manage the user's OWN
 *                                           Shopify App credentials
 *   POST /api/shopify/oauth/begin           (JWT) {shop} → {installUrl}
 *   GET  /api/shopify/oauth/callback        Shopify redirects here with code+hmac
 *
 * PER-USER APPS: unpublished Shopify apps can only be installed on the
 * stores they belong to, so every user registers their own app (Client ID
 * + Secret) — mirrors the per-user Facebook App model. The env
 * SHOPIFY_CLIENT_ID/SECRET pair is only a fallback for single-tenant
 * installs.
 *
 * `state` is a short-lived signed JWT {uid, shop, purpose} so the callback
 * (which carries no Authorization header) can prove which logged-in user
 * started the install AND which user's app credentials to use for the HMAC
 * check + code exchange.
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { encryptToken, decryptToken } from '../lib/token-crypto';
import { audit } from '../lib/audit';
import { registerShopifyWebhooks } from '../services/shopify-webhooks.service';
import { syncOrders } from '../services/order-sync.service';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

// read_customers on top of read_orders: needed to read the customer object +
// full shipping address on orders. NOTE: the scope alone is NOT enough —
// Shopify also requires "Protected customer data access" to be approved for
// the app (Partner Dashboard → API access), otherwise name/address/phone/
// email come back redacted even with the scope granted.
const SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders,read_products,read_customers';

/**
 * Resolve the ONE global app the whole system connects stores through
 * (shipbro-style): admin-managed DB config first, then env fallback.
 */
export async function resolveShopifyApp(): Promise<{ clientId: string; clientSecret: string; source: 'db' | 'env' } | null> {
  const cfg = await prisma.shopifyAppConfig.findUnique({ where: { id: 'singleton' } });
  if (cfg) return { clientId: cfg.clientId, clientSecret: decryptToken(cfg.clientSecret), source: 'db' };
  if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) {
    return { clientId: process.env.SHOPIFY_CLIENT_ID, clientSecret: process.env.SHOPIFY_CLIENT_SECRET, source: 'env' };
  }
  return null;
}

function normalizeShop(raw: string): string | null {
  let shop = String(raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!shop) return null;
  if (!shop.includes('.')) shop = `${shop}.myshopify.com`;
  // Shopify shop domains are strictly {name}.myshopify.com
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  return shop;
}

export function backendBaseUrl(req: Request): string {
  if (process.env.SHOPIFY_APP_URL) return process.env.SHOPIFY_APP_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return `${proto}://${req.get('host')}`;
}

/** Verify Shopify's HMAC over the OAuth callback query string. */
function verifyCallbackHmac(query: Record<string, any>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac || typeof hmac !== 'string') return false;
  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
  } catch {
    return false;
  }
}

// ── Trạng thái app hệ thống (mọi user đọc được) ────────────────────────────

/** Đã có app global chưa? Frontend dùng để bật/tắt nút kết nối. */
router.get('/status', requireAuth, requireActive, async (req: Request, res: Response) => {
  try {
    const app = await resolveShopifyApp();
    res.json({ configured: !!app, source: app?.source ?? null });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load Shopify app status' });
  }
});

// ── OAuth flow ─────────────────────────────────────────────────────────────

router.post('/begin', requireAuth, requireActive, async (req: Request, res: Response) => {
  const shop = normalizeShop(req.body?.shop);
  if (!shop) {
    return res.status(400).json({ error: 'shop không hợp lệ — ví dụ: my-store hoặc my-store.myshopify.com' });
  }
  const app = await resolveShopifyApp();
  if (!app) {
    return res.status(400).json({
      error: 'Hệ thống chưa cấu hình Shopify App. Liên hệ admin để cài đặt Shopify App (mục Admin → Shopify App).',
      code: 'oauth_not_configured'
    });
  }
  const state = jwt.sign(
    { uid: req.userId, shop, purpose: 'shopify_oauth' },
    JWT_SECRET,
    { expiresIn: '10m' }
  );
  const redirectUri = `${backendBaseUrl(req)}/api/shopify/oauth/callback`;
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(app.clientId)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;
  res.json({ installUrl, shop, appSource: app.source });
});

router.get('/callback', async (req: Request, res: Response) => {
  const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '') || '';
  const fail = (reason: string) =>
    res.redirect(`${frontend}/connect?status=error&reason=${encodeURIComponent(reason)}`);

  try {
    const { code, state, shop: shopParam } = req.query as Record<string, string>;
    if (!code || !state || !shopParam) return fail('missing_params');

    // 1. Our signed state → which user started this install (and therefore
    //    which user's app credentials sign this callback).
    let statePayload: { uid: string; shop: string; purpose: string };
    try {
      statePayload = jwt.verify(state, JWT_SECRET) as any;
    } catch {
      return fail('state_expired');
    }
    if (statePayload.purpose !== 'shopify_oauth' || !statePayload.uid) return fail('bad_state');

    const shop = normalizeShop(shopParam);
    if (!shop || shop !== statePayload.shop) return fail('shop_mismatch');

    const app = await resolveShopifyApp();
    if (!app) return fail('oauth_not_configured');

    // 2. Shopify's HMAC over the callback query.
    if (!verifyCallbackHmac(req.query as Record<string, any>, app.clientSecret)) {
      console.warn(`[shopify-oauth] HMAC verification failed for ${shop}`);
      return fail('hmac_invalid');
    }

    // 3. Exchange code → permanent access token.
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code })
    });
    if (!tokenRes.ok) {
      console.error(`[shopify-oauth] token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      return fail('token_exchange_failed');
    }
    const tokenJson = await tokenRes.json() as { access_token?: string; scope?: string };
    if (!tokenJson.access_token) return fail('no_access_token');

    // 4. Upsert the store for this user (token encrypted at rest).
    const existing = await prisma.shopifyStore.findUnique({
      where: { userId_storeDomain: { userId: statePayload.uid, storeDomain: shop } }
    });
    const store = existing
      ? await prisma.shopifyStore.update({
          where: { id: existing.id },
          data: { accessToken: encryptToken(tokenJson.access_token), isActive: true }
        })
      : await prisma.shopifyStore.create({
          data: {
            userId: statePayload.uid,
            storeDomain: shop,
            accessToken: encryptToken(tokenJson.access_token),
            name: shop.replace('.myshopify.com', ''),
            isActive: true
          }
        });

    await audit({
      userId: statePayload.uid,
      actorUserId: statePayload.uid,
      action: 'store.connected_oauth',
      target: shop,
      metadata: { scope: tokenJson.scope }
    });

    // 5. Register webhooks + kick the initial order sync. Both best-effort
    //    and async — the user shouldn't stare at a spinner while we page
    //    through their order history.
    registerShopifyWebhooks(shop, tokenJson.access_token, backendBaseUrl(req))
      .catch(e => console.warn(`[shopify-oauth] webhook registration failed for ${shop}:`, e?.message));
    syncOrders(store.id, { pullTransactions: false })
      .then(r => console.log(`[shopify-oauth] initial sync ${shop}: +${r.ordersCreated}/${r.ordersUpdated} orders`))
      .catch(e => console.warn(`[shopify-oauth] initial sync failed for ${shop}:`, e?.message));

    res.redirect(`${frontend}/connect?status=connected&shop=${encodeURIComponent(shop)}`);
  } catch (e: any) {
    console.error('[shopify-oauth] callback error:', e);
    fail('internal_error');
  }
});

export default router;
