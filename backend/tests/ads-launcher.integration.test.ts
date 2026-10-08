/**
 * Ads Launcher end to end through the real HTTP routes on a real Postgres,
 * using the demo ad account (fake Meta writer, no network to Meta):
 * presets + starters, creative upload / list / archive, launch, idempotency
 * (replay / running / release), 403 / 404, posts and refresh (§15.1 "Route").
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
  console.warn('[ads-launcher] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[ads-launcher] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT 1 FROM "AdCreative" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[ads-launcher] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// .invalid never resolves: Shopify calls fail fast and the catalog falls back
// to the synced variants seeded below.
const DOMAIN = `ads-${suffix}.invalid`;
const OTHER_DOMAIN = `ads-other-${suffix}.invalid`;
const SECRET = process.env.JWT_SECRET || 'default-secret';
const DEMO = '900000000000001';
const PAGE = '900000000000101';
const PIXEL = '900000000000201';
const PRODUCT_ID = `${Date.now()}`.slice(-12);

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-launcher-media-'));
process.env.MEDIA_DIR = mediaDir;

let ownerId = '', viewerId = '', strangerId = '', storeId = '', otherStoreId = '';
let server: Server;
let base = '';

const token = (id: string) => jwt.sign({ id, status: 'ACTIVE' }, SECRET);

// src/test/setup.ts replaces global fetch with a mock, so talk HTTP directly
// (and encode multipart by hand: jsdom's FormData can't be serialised here).
const CRLF = '\r\n';
class Multipart {
  readonly boundary = `----ads${Math.random().toString(16).slice(2)}`;
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

async function call(pathname: string, method: string, as: string, body?: unknown, domain = DOMAIN): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token(as)}`, 'X-Shopify-Store-Domain': domain };
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

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

function uploadForm(angle: string, file: Buffer = JPEG, mime = 'image/jpeg') {
  return new Multipart()
    .file('file', 'shot.jpg', mime, file)
    .field('productId', PRODUCT_ID)
    .field('angle', angle)
    .field('primaryText', `Copy for ${angle}`)
    .field('headline', 'Headline');
}

function launchBody(ads: unknown[], over: Record<string, unknown> = {}) {
  return {
    adAccountId: DEMO,
    pageId: PAGE,
    pixelId: PIXEL,
    campaign: { mode: 'new', name: `IT ${suffix}`, objective: 'OUTCOME_SALES', dailyBudget: '50', status: 'PAUSED' },
    adsets: [{
      mode: 'new', name: 'Broad', optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE',
      targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true }, status: 'PAUSED', ads
    }],
    destination: { url: 'https://shop.example/products/comb', displayLink: 'shop.example' },
    callToAction: 'SHOP_NOW',
    adStatus: 'PAUSED',
    requestId: randomUUID(),
    launchId: randomUUID(),
    ...over
  };
}

beforeAll(async () => {
  if (!live || !db) return;
  const mk = async (who: string, firstName?: string) => (await db.user.create({
    data: { email: `${who}-${suffix}@ads.test`, password: 'x', isVerified: true, status: 'ACTIVE', firstName }
  })).id;
  ownerId = await mk('owner', 'Triết');
  viewerId = await mk('viewer');
  strangerId = await mk('stranger');
  storeId = (await db.shopifyStore.create({ data: { userId: ownerId, storeDomain: DOMAIN, accessToken: 'blob', isActive: true } })).id;
  otherStoreId = (await db.shopifyStore.create({ data: { userId: strangerId, storeDomain: OTHER_DOMAIN, accessToken: 'blob', isActive: true } })).id;
  await db.storeMember.create({ data: { userId: viewerId, storeId, role: 'viewer' } });
  await db.productVariant.create({
    data: { variantId: BigInt(`9${PRODUCT_ID}`), userId: ownerId, storeId, productId: BigInt(PRODUCT_ID), title: 'Comb', sku: 'COMB01-S' }
  });

  const [{ default: launcher }, { default: presets }, { default: creatives }] = await Promise.all([
    import('../src/routes/ads-launcher.routes'),
    import('../src/routes/launch-presets.routes'),
    import('../src/routes/creatives.routes')
  ]);
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/ads-launcher', launcher);
  app.use('/api/launch-presets', presets);
  app.use('/api/creatives', creatives);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (db && live) {
    const users = [ownerId, viewerId, strangerId].filter(Boolean);
    await db.metaCampaign.deleteMany({ where: { ownerId: { in: users } } });
    await db.adCreative.deleteMany({ where: { storeId: { in: [storeId, otherStoreId] } } });
    await db.productVariant.deleteMany({ where: { storeId } });
    await db.storeMember.deleteMany({ where: { storeId } });
    await db.shopifyStore.deleteMany({ where: { id: { in: [storeId, otherStoreId] } } });
    await db.adLaunchRequest.deleteMany({ where: { key: { contains: ownerId } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }
  await db?.$disconnect();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('Ads Launcher routes', { timeout: 60_000 }, () => {
  const created: string[] = [];

  maybe()('presets: starters copied once, CRUD, restore', async () => {
    const list = await call('/api/launch-presets', 'GET', ownerId);
    expect(list.status).toBe(200);
    expect(list.json.success).toBe(true);
    const keys = list.json.data.items.map((p: any) => p.starterKey);
    expect(keys).toContain('cbo-all-in-one');
    expect(keys).toContain('cbo-per-creative');

    const first = list.json.data.items[0];
    const del = await call(`/api/launch-presets/${first.id}`, 'DELETE', ownerId);
    expect(del.status).toBe(200);
    // Deleting must not trigger a re-seed on the next open.
    const again = await call('/api/launch-presets', 'GET', ownerId);
    expect(again.json.data.items.find((p: any) => p.id === first.id)).toBeUndefined();

    const bad = await call('/api/launch-presets', 'POST', ownerId, { name: 'X', config: { ...first.config, campaign: { ...first.config.campaign, bidStrategy: 'COST_CAP' } } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('invalid_request');

    const made = await call('/api/launch-presets', 'POST', ownerId, { name: 'Mine', config: first.config });
    expect(made.status).toBe(201);
    const restored = await call('/api/launch-presets/restore-starters', 'POST', ownerId);
    expect(restored.json.data.items.find((p: any) => p.id === first.id)).toBeTruthy();

    // Presets are private: the viewer's list is their own (and the viewer may not manage).
    expect((await call('/api/launch-presets', 'GET', viewerId)).status).toBe(403);
  });

  maybe()('creatives: upload, list with counts, edit, archive, scope', async () => {
    const products = await call('/api/creatives/products', 'GET', ownerId);
    expect(products.status).toBe(200);
    expect(products.json.data.items[0]).toMatchObject({ id: PRODUCT_ID, code: 'COMB01-S' });

    for (const angle of ['Dead corner | fix', 'Travel size', 'Gift']) {
      const up = await call('/api/creatives', 'POST', ownerId, uploadForm(angle));
      expect(up.status).toBe(201);
      created.push(up.json.data.id);
    }
    const one = await call(`/api/creatives/${created[0]}`, 'GET', ownerId);
    expect(one.json.data.name).toMatch(/^Triết \| Dead corner \/ fix \| COMB01-S - \d{2}\/\d{2}\/\d{4}$/);
    expect(one.json.data.mediaUrl).toMatch(/^\/api\/media\/creatives\//);
    expect(fs.existsSync(path.join(mediaDir, one.json.data.mediaUrl.replace('/api/media/', '')))).toBe(true);

    const notJpeg = await call('/api/creatives', 'POST', ownerId, uploadForm('Fake', Buffer.from('not an image at all')));
    expect(notJpeg.status).toBe(400);
    const viewerUpload = await call('/api/creatives', 'POST', viewerId, uploadForm('Nope'));
    expect(viewerUpload.status).toBe(403);
    expect((await call('/api/creatives', 'GET', viewerId)).status).toBe(200);

    const edited = await call(`/api/creatives/${created[2]}`, 'PUT', ownerId, { angle: 'Gift box', headline: 'New head' });
    expect(edited.json.data).toMatchObject({ angle: 'Gift box', headline: 'New head' });
    expect(edited.json.data.name).toContain('| Gift box |');

    const listed = await call(`/api/creatives?productId=${PRODUCT_ID}&status=active`, 'GET', ownerId);
    expect(listed.json.data.total).toBe(3);
    expect(listed.json.data.notLaunched).toBe(3);

    // Another store's user cannot see these.
    const stranger = await call(`/api/creatives/${created[0]}`, 'GET', strangerId, undefined, OTHER_DOMAIN);
    expect(stranger.status).toBe(404);
  });

  maybe()('launch on the demo account: ok, mirrored, replay is idempotent', async () => {
    const accounts = await call('/api/ads-launcher/accounts', 'GET', ownerId);
    expect(accounts.json.data.items.find((a: any) => a.isDemo)).toMatchObject({ id: DEMO });
    const options = await call(`/api/ads-launcher/options?adAccountId=${DEMO}`, 'GET', ownerId);
    expect(options.json.data).toMatchObject({ adAccount: { isDemo: true }, pixels: [{ externalId: PIXEL }] });
    // The whole business, not only the page linked to the ad account.
    expect(options.json.data.pages.length).toBeGreaterThan(1);
    expect(options.json.data.pages[0]).toMatchObject({ externalId: PAGE, linked: true, instagramUserId: expect.any(String) });
    expect(options.json.data.audiences.length).toBeGreaterThan(0);
    const interests = await call(`/api/ads-launcher/interests?adAccountId=${DEMO}&q=hair`, 'GET', ownerId);
    expect(interests.json.data.items[0]).toMatchObject({ name: expect.stringMatching(/hair/i) });

    const body = launchBody([{ creativeId: created[0] }, { creativeId: created[0] }, { creativeId: created[1] }]);
    const r = await call('/api/ads-launcher/launch', 'POST', ownerId, body);
    expect(r.status).toBe(201);
    expect(r.json.data.summary).toEqual({ adsCreated: 3, adsFailed: 0, adsetsCreated: 1, campaignCreated: true });
    expect(r.json.data.adsets[0].ads.map((a: any) => a.name.slice(-3))).toEqual([' #1', ' #2', expect.any(String)]);

    const ads = await db!.metaAd.findMany({ where: { ownerId, creativeId: created[0] } });
    expect(ads).toHaveLength(2);
    expect(ads[0].postId).toMatch(/^\d+_\d+$/);

    const history = await call('/api/ads-launcher/history', 'GET', ownerId);
    expect(history.json.data.items[0]).toMatchObject({ name: `IT ${suffix}`, isDemo: true, adsets: 1, ads: 3, launchedBy: 'Triết' });
    expect((await call('/api/ads-launcher/history', 'GET', viewerId)).status).toBe(403);

    const replay = await call('/api/ads-launcher/launch', 'POST', ownerId, body);
    expect(replay.status).toBe(201);
    expect(replay.json.data).toEqual(r.json.data);
    expect(await db!.metaCampaign.count({ where: { ownerId, name: `IT ${suffix}` } })).toBe(1);

    const listed = await call(`/api/creatives?productId=${PRODUCT_ID}&launched=not`, 'GET', ownerId);
    expect(listed.json.data.items.map((c: any) => c.id)).toEqual([created[2]]);
  });

  maybe()('idempotency: running → 409; a failed launch releases its key', async () => {
    const requestId = randomUUID();
    await db!.adLaunchRequest.create({
      data: { key: `ads-launcher:launch:${ownerId}:${requestId}`, status: 'running', expiresAt: new Date(Date.now() + 3600_000) }
    });
    const running = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ creativeId: created[0] }], { requestId }));
    expect(running.status).toBe(409);

    const missingId = randomUUID();
    const rid = randomUUID();
    const notFound = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ creativeId: missingId }], { requestId: rid }));
    expect(notFound.status).toBe(404);
    expect(notFound.json.error.code).toBe('creative_not_found');
    expect(await db!.adLaunchRequest.count({ where: { key: { endsWith: rid } } })).toBe(0);
  });

  maybe()('archived creative → 404; out-of-scope creative → 404, nothing created', async () => {
    await call(`/api/creatives/${created[1]}/archive`, 'POST', ownerId);
    const archived = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ creativeId: created[1] }]));
    expect(archived.status).toBe(404);
    expect(archived.json.error.message).toMatch(/restore it in the library/);
    await call(`/api/creatives/${created[1]}/restore`, 'POST', ownerId);

    const before = await db!.metaCampaign.count();
    const foreign = await call('/api/ads-launcher/launch', 'POST', strangerId, launchBody([{ creativeId: created[0] }]), OTHER_DOMAIN);
    expect(foreign.status).toBe(404);
    expect(await db!.metaCampaign.count()).toBe(before);
  });

  maybe()('real account without any Facebook connection → 403', async () => {
    const r = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ creativeId: created[0] }], { adAccountId: '1234567890' }));
    expect(r.status).toBe(403);
    expect(r.json.error.message).toMatch(/Connect Facebook first/);
    expect((await call('/api/ads-launcher/launch', 'POST', viewerId, launchBody([{ creativeId: created[0] }]))).status).toBe(403);
  });

  maybe()('posts: grouped by post, refresh stamps every asked ad, launch an old post', async () => {
    const posts = await call(`/api/ads-launcher/posts?productId=${PRODUCT_ID}&range=lifetime`, 'GET', ownerId);
    expect(posts.status).toBe(200);
    const first = posts.json.data.items.find((p: any) => p.creative?.id === created[0]);
    expect(first).toMatchObject({ ads: 2, creative: { id: created[0] }, product: { id: PRODUCT_ID } });
    expect(first.permalink).toMatch(/^https:\/\/www\.facebook\.com\/\d+\/posts\/\d+$/);

    // Forget one post id and refresh it back.
    const ad = await db!.metaAd.findFirst({ where: { ownerId, creativeId: created[1] } });
    await db!.metaAd.update({ where: { id: ad!.id }, data: { postId: null, postCheckedAt: null } });
    const missing = await call('/api/ads-launcher/posts', 'GET', ownerId);
    expect(missing.json.data.missingPostIds).toBe(1);
    const refreshed = await call('/api/ads-launcher/posts/refresh', 'POST', ownerId, {});
    expect(refreshed.json.data).toMatchObject({ checked: 1, found: 1, remaining: 0, failures: [] });
    const after = await db!.metaAd.findUnique({ where: { id: ad!.id } });
    expect(after!.postId).toMatch(/^\d+_\d+$/);
    expect(after!.postCheckedAt).toBeTruthy();

    // Launch that post again: same post id, linked to its creative, no landing page needed.
    const r = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ postId: first.postId, creativeId: created[0] }], { destination: undefined }));
    expect(r.status).toBe(201);
    expect(r.json.data.adsets[0].ads[0]).toMatchObject({ status: 'ok', postId: first.postId, creativeId: created[0] });
    const again = await call(`/api/ads-launcher/posts?postIds=${first.postId}`, 'GET', ownerId);
    expect(again.json.data.items[0].ads).toBe(3);
  });

  maybe()('existing campaign (demo) appears in options and accepts a new ad set', async () => {
    const options = await call(`/api/ads-launcher/options?adAccountId=${DEMO}`, 'GET', ownerId);
    const camp = options.json.data.campaigns.find((c: any) => c.name === `IT ${suffix}`);
    expect(camp).toBeTruthy();
    const r = await call('/api/ads-launcher/launch', 'POST', ownerId, launchBody([{ creativeId: created[2] }], { campaign: { mode: 'existing', campaignId: camp.externalId } }));
    expect(r.status).toBe(201);
    expect(r.json.data.summary).toMatchObject({ adsCreated: 1, campaignCreated: false, adsetsCreated: 1 });
  });
});
