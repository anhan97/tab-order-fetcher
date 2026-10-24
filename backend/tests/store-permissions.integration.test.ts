/**
 * Ads-side permissions end to end, through the real routes on a real Postgres:
 * a store manager sees no Creatives / launcher / Facebook until granted; a
 * 'creative' member uploads and handles only their own creatives and cannot
 * read orders; granted permissions open exactly their feature; the admin API
 * stores them; the FB plumbing endpoints that used to answer anyone now need
 * an admin.
 *
 * OPT-IN like the other *.integration tests: TEST_DATABASE_URL and
 * DATABASE_URL must both point at the same throwaway, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const db = TEST_DB_URL ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } }) : null;

let live = false;
if (!db) {
  console.warn('[store-permissions] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[store-permissions] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT "permissions" FROM "StoreMember" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[store-permissions] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `perm-${suffix}.invalid`;
const SECRET = process.env.JWT_SECRET || 'default-secret';
const DEMO = '900000000000001';
const PAGE = '900000000000101';
const PIXEL = '900000000000201';
const PRODUCT_ID = `${Date.now()}`.slice(-11) + '7';
/** An old, finalized P&L day (outside the live-recomputed last days). */
const PL_DAY = new Date(Date.UTC(2026, 0, 10));

process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-media-'));

const ids = {
  owner: '', manager: '', creative: '', creative2: '', buyer: '', curator: '', admin: '', plain: '', fin: '', book: ''
};
let storeId = '';
let server: Server;
let base = '';

const CRLF = '\r\n';
class Multipart {
  readonly boundary = `----perm${Math.random().toString(16).slice(2)}`;
  private parts: Buffer[] = [];
  field(name: string, value: string) {
    this.parts.push(Buffer.from(`--${this.boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`));
    return this;
  }
  file(name: string, filename: string, mime: string, data: Buffer) {
    this.parts.push(
      Buffer.from(`--${this.boundary}${CRLF}Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}Content-Type: ${mime}${CRLF}${CRLF}`),
      data,
      Buffer.from(CRLF)
    );
    return this;
  }
  encode() {
    return Buffer.concat([...this.parts, Buffer.from(`--${this.boundary}--${CRLF}`)]);
  }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const uploadForm = (angle: string) => new Multipart()
  .file('file', 'shot.jpg', 'image/jpeg', JPEG)
  .field('productId', PRODUCT_ID)
  .field('angle', angle);

function call(pathname: string, method: string, as: string | null, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'X-Shopify-Store-Domain': DOMAIN };
  if (as) headers.Authorization = `Bearer ${jwt.sign({ id: as, status: 'ACTIVE' }, SECRET)}`;
  let payload: Buffer | undefined;
  if (body instanceof Multipart) {
    payload = body.encode();
    headers['Content-Type'] = `multipart/form-data; boundary=${body.boundary}`;
  } else if (body !== undefined) {
    payload = Buffer.from(JSON.stringify(body));
    headers['Content-Type'] = 'application/json';
  }
  if (payload) headers['Content-Length'] = String(payload.length);
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${pathname}`, { method, headers }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json: any = data;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const status = async (pathname: string, method: string, as: string | null, body?: unknown) => (await call(pathname, method, as, body)).status;

function launchBody(creativeId: string) {
  return {
    adAccountId: DEMO,
    pageId: PAGE,
    pixelId: PIXEL,
    campaign: { mode: 'new', name: `Perm ${suffix}`, objective: 'OUTCOME_SALES', dailyBudget: '50', status: 'PAUSED' },
    adsets: [{
      mode: 'new', name: 'Broad', optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE',
      targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true }, status: 'PAUSED',
      ads: [{ creativeId }]
    }],
    destination: { url: 'https://shop.example/products/comb' },
    callToAction: 'SHOP_NOW',
    adStatus: 'PAUSED',
    requestId: randomUUID(),
    launchId: randomUUID()
  };
}

beforeAll(async () => {
  if (!live || !db) return;
  const mk = async (who: string, role = 'user') => (await db.user.create({
    data: { email: `${who}-${suffix}@perm.test`, password: 'x', isVerified: true, status: 'ACTIVE', role, firstName: who }
  })).id;
  for (const k of Object.keys(ids) as Array<keyof typeof ids>) ids[k] = await mk(k, k === 'admin' ? 'admin' : 'user');
  storeId = (await db.shopifyStore.create({ data: { userId: ids.owner, storeDomain: DOMAIN, accessToken: 'blob', isActive: true } })).id;
  const grant = (userId: string, role: string, permissions: string[] = []) =>
    db.storeMember.create({ data: { userId, storeId, role, permissions } });
  await grant(ids.manager, 'manager');
  await grant(ids.creative, 'creative');
  await grant(ids.creative2, 'creative');
  await grant(ids.buyer, 'viewer', ['ads.launch', 'facebook.view']);
  await grant(ids.curator, 'viewer', ['creatives.manage']);
  await grant(ids.admin, 'viewer');
  await grant(ids.fin, 'finance');
  await grant(ids.book, 'finance', ['fees.view']);
  await db.dailyPLSnapshot.create({ data: {
    userId: ids.owner, storeId, date: PL_DAY, netRevenue: 1000, grossRevenue: 1000, basecost: 300,
    paymentFees: 35, grossProfit: 665, netProfit: 200, orderCount: 20, isFinalized: true
  } });
  await db.productVariant.create({
    data: { variantId: BigInt(`8${PRODUCT_ID}`), userId: ids.owner, storeId, productId: BigInt(PRODUCT_ID), title: 'Comb', sku: 'PERM01-S' }
  });

  const [launcher, presets, creatives, facebook, orders, auth, admin] = await Promise.all([
    import('../src/routes/ads-launcher.routes'),
    import('../src/routes/launch-presets.routes'),
    import('../src/routes/creatives.routes'),
    import('../src/routes/facebook.routes'),
    import('../src/routes/orders.routes'),
    import('../src/routes/auth.routes'),
    import('../src/routes/admin.routes')
  ]);
  const { default: pl } = await import('../src/routes/pl.routes');
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/ads-launcher', launcher.default);
  app.use('/api/launch-presets', presets.default);
  app.use('/api/creatives', creatives.default);
  app.use('/api/facebook', facebook.default);
  app.use('/api/orders', orders.default);
  app.use('/api/auth', auth.default);
  app.use('/api/admin', admin.default);
  app.use('/api/pl', pl);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (db && live) {
    const users = Object.values(ids).filter(Boolean);
    await db.metaCampaign.deleteMany({ where: { ownerId: { in: users } } });
    await db.adCreative.deleteMany({ where: { storeId } });
    await db.productVariant.deleteMany({ where: { storeId } });
    await db.storeMember.deleteMany({ where: { storeId } });
    await db.dailyPLSnapshot.deleteMany({ where: { storeId } });
    await db.shopifyStore.deleteMany({ where: { id: storeId } });
    await db.adLaunchRequest.deleteMany({ where: { key: { contains: ids.owner } } });
    await db.launchPreset.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db?.$disconnect();
});

const capsOf = async (who: string): Promise<string[]> => {
  const r = await call('/api/auth/stores', 'GET', who);
  return r.json.stores.find((s: any) => s.id === storeId)?.capabilities ?? [];
};

describe('store permissions', { timeout: 60_000 }, () => {
  let mine = '', theirs = '';

  maybe()('a manager runs the store but sees no Creatives / launcher / Facebook until granted', async () => {
    expect(await status('/api/orders', 'GET', ids.manager)).toBe(200);
    expect(await status('/api/creatives', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/creatives', 'POST', ids.manager, uploadForm('Nope'))).toBe(403);
    expect(await status('/api/creatives/products', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/ads-launcher/accounts', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/ads-launcher/posts', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/launch-presets', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/facebook/connection-status', 'GET', ids.manager)).toBe(403);
    expect(await status('/api/facebook/campaigns', 'GET', ids.manager)).toBe(403);
    expect(await capsOf(ids.manager)).toEqual(['read', 'sync', 'fulfill', 'costs', 'manage']);
  });

  maybe()('a creative uploads and sees only their own creatives — and cannot read orders', async () => {
    expect(await capsOf(ids.creative)).toEqual(['creatives.upload']);
    expect(await status('/api/orders', 'GET', ids.creative)).toBe(403);

    const a = await call('/api/creatives', 'POST', ids.creative, uploadForm('Mine'));
    expect(a.status).toBe(201);
    mine = a.json.data.id;
    const b = await call('/api/creatives', 'POST', ids.creative2, uploadForm('Theirs'));
    expect(b.status).toBe(201);
    theirs = b.json.data.id;

    const list = await call('/api/creatives', 'GET', ids.creative);
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((c: any) => c.id)).toEqual([mine]);
    expect(await status(`/api/creatives/${theirs}`, 'GET', ids.creative)).toBe(404);
    const products = await call('/api/creatives/products', 'GET', ids.creative);
    expect(products.status).toBe(200);
    expect(products.json.data.items.find((p: any) => p.id === PRODUCT_ID)?.creatives).toBe(1);

    // Own: edit + archive + restore. Someone else's: not even visible.
    expect(await status(`/api/creatives/${mine}`, 'PUT', ids.creative, { angle: 'Mine v2' })).toBe(200);
    expect(await status(`/api/creatives/${mine}/archive`, 'POST', ids.creative)).toBe(200);
    expect(await status(`/api/creatives/${mine}/restore`, 'POST', ids.creative)).toBe(200);
    expect(await status(`/api/creatives/${theirs}`, 'PUT', ids.creative, { angle: 'Hijack' })).toBe(404);
    expect(await status(`/api/creatives/${theirs}`, 'DELETE', ids.creative)).toBe(404);

    // Nothing of the launcher, the posts or Facebook.
    expect(await status('/api/ads-launcher/posts', 'GET', ids.creative)).toBe(403);
    expect(await status('/api/ads-launcher/launch', 'POST', ids.creative, launchBody(mine))).toBe(403);
    expect(await status('/api/facebook/connection-status', 'GET', ids.creative)).toBe(403);
  });

  maybe()('"Launch ads" opens the launcher and the whole library, nothing to edit', async () => {
    expect(await capsOf(ids.buyer)).toEqual(['read', 'creatives.view', 'ads.launch', 'facebook.view']);
    const list = await call('/api/creatives', 'GET', ids.buyer);
    expect(list.json.data.items.map((c: any) => c.id).sort()).toEqual([mine, theirs].sort());
    expect(await status('/api/creatives', 'POST', ids.buyer, uploadForm('Nope'))).toBe(403);
    expect(await status(`/api/creatives/${mine}`, 'PUT', ids.buyer, { angle: 'Nope' })).toBe(403);
    expect(await status('/api/launch-presets', 'GET', ids.buyer)).toBe(200);
    expect(await status('/api/ads-launcher/posts', 'GET', ids.buyer)).toBe(200);

    const launched = await call('/api/ads-launcher/launch', 'POST', ids.buyer, launchBody(mine));
    expect(launched.status).toBe(201);
    expect(launched.json.data.summary.adsCreated).toBe(1);

    // "See Facebook" without "Map campaigns".
    expect(await status('/api/facebook/connection-status', 'GET', ids.buyer)).toBe(200);
    expect(await status('/api/facebook/campaign-mapping', 'PUT', ids.buyer, {})).toBe(403);
  });

  maybe()('an uploader cannot delete their creative once ads use it; "Manage all creatives" can', async () => {
    const del = await call(`/api/creatives/${mine}`, 'DELETE', ids.creative);
    expect(del.status).toBe(403);
    expect(del.json.error.code).toBe('creative_in_use');
    expect(await status(`/api/creatives/${theirs}`, 'PUT', ids.curator, { angle: 'Curated' })).toBe(200);
    expect(await status(`/api/creatives/${mine}`, 'DELETE', ids.curator)).toBe(200);
    // ...and the uploader may delete their own while it is unused.
    expect(await status(`/api/creatives/${theirs}`, 'DELETE', ids.creative2)).toBe(200);
  });

  maybe()('a system admin can do everything in a store they were granted as viewer', async () => {
    const caps = await capsOf(ids.admin);
    for (const c of ['read', 'manage', 'creatives.manage', 'ads.launch', 'facebook.manage']) expect(caps).toContain(c);
    expect(await status('/api/creatives', 'GET', ids.admin)).toBe(200);
    expect(await status('/api/launch-presets', 'GET', ids.admin)).toBe(200);
  });

  maybe()('the admin API grants permissions; a role change alone keeps them', async () => {
    const put = (body: object) => call(`/api/admin/stores/${storeId}/members`, 'PUT', ids.admin, body);
    const bad = await put({ userId: ids.manager, role: 'manager', permissions: ['ads.launch', 'root'] });
    expect(bad.status).toBe(400);

    const ok = await put({ userId: ids.manager, role: 'manager', permissions: ['facebook.view', 'ads.launch', 'ads.launch'] });
    expect(ok.status).toBe(200);
    expect(ok.json.member.permissions).toEqual(['ads.launch', 'facebook.view']);
    expect(await status('/api/ads-launcher/accounts', 'GET', ids.manager)).toBe(200);
    expect(await status('/api/facebook/connection-status', 'GET', ids.manager)).toBe(200);

    const roleOnly = await put({ userId: ids.manager, role: 'viewer' });
    expect(roleOnly.json.member.permissions).toEqual(['ads.launch', 'facebook.view']);

    const members = await call(`/api/admin/stores/${storeId}/members`, 'GET', ids.admin);
    const row = members.json.members.find((m: any) => m.userId === ids.manager);
    expect(row).toMatchObject({ role: 'viewer', permissions: ['ads.launch', 'facebook.view'] });
    expect(row.capabilities).toEqual(['read', 'creatives.view', 'ads.launch', 'facebook.view']);
    expect(members.json.grantableRoles).toContain('creative');

    expect((await call(`/api/admin/stores/${storeId}/members`, 'PUT', ids.owner, { userId: ids.manager, role: 'manager' })).status).toBe(403);
  });

  maybe()('FB plumbing that answered anyone now needs an admin', async () => {
    for (const [p, m] of [
      ['/api/facebook/admin/config', 'GET'], ['/api/facebook/admin/tokens', 'GET'], ['/api/facebook/sync-status', 'GET'],
      ['/api/facebook/proxy?url=http://127.0.0.1/&access_token=x', 'GET'], ['/api/facebook/sync-bm', 'POST']
    ] as const) {
      expect(await status(p, m, null)).toBe(401);
      expect(await status(p, m, ids.owner)).toBe(403);
    }
    expect(await status('/api/facebook/sync-status', 'GET', ids.admin)).toBe(200);
  });

  maybe()('payment fees: only with "See payment fees"; others get profit before fees', async () => {
    const q = `from=${new Date(PL_DAY.getTime() - 86400000).toISOString()}&to=${new Date(PL_DAY.getTime() + 86400000).toISOString()}`;
    const day = async (who: string) => (await call(`/api/pl/daily?${q}`, 'GET', who)).json.snapshots.find((s: any) => String(s.date).startsWith('2026-01-10'));

    const owner = await day(ids.owner);
    expect(Number(owner.paymentFees)).toBe(35);
    expect(Number(owner.netProfit)).toBe(200);

    // Finance member without the permission: no fee, profit before it.
    const fin = await day(ids.fin);
    expect(fin.paymentFees).toBeNull();
    expect(fin).toMatchObject({ grossProfit: 700, netProfit: 235 });
    expect(await status(`/api/pl/fee-status?${q}`, 'GET', ids.fin)).toBe(403);
    expect((await call('/api/orders/sync-status', 'GET', ids.fin)).json.feeSyncError).toBeNull();

    // Granted: same numbers as the owner.
    const book = await day(ids.book);
    expect(Number(book.paymentFees)).toBe(35);
    expect(Number(book.netProfit)).toBe(200);
    const fs = await call(`/api/pl/fee-status?${q}`, 'GET', ids.book);
    expect(fs.status).toBe(200);
    expect(fs.json).toHaveProperty('payoutsScope');
    expect(Array.isArray(fs.json.gateways)).toBe(true);

    expect(await capsOf(ids.fin)).not.toContain('fees.view');
    expect(await capsOf(ids.owner)).toContain('fees.view');
  });
});
