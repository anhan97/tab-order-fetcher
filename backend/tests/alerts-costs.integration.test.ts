/**
 * Telegram new-order alerts + automatic re-costing after a COGS edit, end to
 * end on a real Postgres through the real routes and ingest path. Telegram
 * itself is faked at the fetch boundary.
 *
 * OPT-IN like the other *.integration tests: TEST_DATABASE_URL and
 * DATABASE_URL must both point at the same throwaway, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { request, type Server } from 'http';
import { AddressInfo } from 'net';
import { PrismaClient, Prisma } from '@prisma/client';
import jwt from 'jsonwebtoken';

process.env.COST_RECOMPUTE_DEBOUNCE_MS = '20';
delete process.env.TELEGRAM_BOT_TOKEN;

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const db = TEST_DB_URL ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } }) : null;

let live = false;
if (!db) {
  console.warn('[alerts] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[alerts] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT "telegramNotifiedAt" FROM "Order" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[alerts] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `alerts-${suffix}.myshopify.com`;
const SECRET = process.env.JWT_SECRET || 'default-secret';
const BOT = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop';
const VARIANT = BigInt(9_000_000_000 + Math.floor(Math.random() * 1_000_000_000));

let ownerId = '', viewerId = '', storeId = '', lineId = '';
let server: Server;
let base = '';

// ── Fake Telegram ────────────────────────────────────────────────────────────
const sent: Array<{ method: string; body: any }> = [];
let telegramFails: string | null = null;
const realFetch = globalThis.fetch;
function fakeFetch(input: any, init?: any): Promise<Response> {
  const url = String(input);
  if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
  const method = url.split('/').pop()!;
  const body = init?.body ? JSON.parse(init.body) : {};
  sent.push({ method, body });
  const reply = (json: any, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));
  if (telegramFails) return reply({ ok: false, description: telegramFails }, 400);
  if (method === 'getMe') return reply({ ok: true, result: { username: 'shop_alert_bot', first_name: 'Alerts' } });
  if (method === 'getUpdates') return reply({ ok: true, result: [{ message: { chat: { id: -100555, title: 'Orders team', type: 'supergroup' } } }] });
  return reply({ ok: true, result: { message_id: 1 } });
}
const messages = () => sent.filter(s => s.method === 'sendMessage');

const token = (id: string) => jwt.sign({ id, status: 'ACTIVE' }, SECRET);
function call(path: string, method: string, as: string, body?: unknown): Promise<{ status: number; json: any }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token(as)}`,
        'X-Shopify-Store-Domain': DOMAIN,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json: any = data;
        try { json = JSON.parse(data); } catch { /* text */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}

let seq = 0;
const shopifyOrder = (over: Record<string, unknown> = {}) => {
  seq++;
  return {
    id: Number(`7${Date.now() % 1e9}${seq}`),
    order_number: 1000 + seq,
    name: `#${1000 + seq}`,
    created_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    total_price: '59.90',
    currency: 'USD',
    financial_status: 'paid',
    shipping_address: { name: 'Ann <b>Lee</b>', city: 'Austin', province_code: 'TX', country_code: 'US' },
    line_items: [{ id: Number(`8${Date.now() % 1e9}${seq}`), title: 'Tote & Bag', variant_title: 'Red', quantity: 2, price: '29.95', variant_id: Number(VARIANT), product_id: 1 }],
    ...over
  };
};

let ingest: (storeId: string, order: any) => Promise<{ orderId: string; created: boolean }>;
let notify: (storeId: string, orderId: string, payload: any) => Promise<void>;

beforeAll(async () => {
  if (!live || !db) return;
  vi.stubGlobal('fetch', fakeFetch);
  const mk = async (who: string) => (await db.user.create({
    data: { email: `${who}-${suffix}@alerts.test`, password: 'x', isVerified: true, status: 'ACTIVE' }
  })).id;
  ownerId = await mk('owner');
  viewerId = await mk('viewer');
  storeId = (await db.shopifyStore.create({
    data: {
      userId: ownerId, storeDomain: DOMAIN, accessToken: 'blob', isActive: true, name: 'Test Shop',
      defaultSupplier: 'Acme', defaultShippingCompany: 'YT'
    }
  })).id;
  await db.storeMember.create({ data: { userId: viewerId, storeId, role: 'viewer' } });
  await db.productVariant.create({
    data: { variantId: VARIANT, userId: ownerId, storeId, title: 'Tote', productId: BigInt(1) }
  });
  lineId = (await db.cogsLine.create({
    data: { userId: ownerId, storeId, supplier: 'Acme', carrier: 'YT', countryCode: 'US' }
  })).id;

  ({ ingestOrderPayload: ingest } = await import('../src/services/order-sync.service'));
  ({ notifyNewOrder: notify } = await import('../src/services/telegram.service'));
  const [{ default: notificationsRoutes }, { default: matrixRoutes }, { default: plRoutes }] = await Promise.all([
    import('../src/routes/notifications.routes'),
    import('../src/routes/cogs-matrix.routes'),
    import('../src/routes/pl.routes')
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/cogs-matrix', matrixRoutes);
  app.use('/api/pl', plRoutes);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { sent.length = 0; telegramFails = null; });

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (!db) return;
  try {
    if (live) {
      // Let fire-and-forget work (alerts, re-costing) settle before deleting.
      await new Promise(r => setTimeout(r, 300));
      const stores = await db.shopifyStore.findMany({
        where: { storeDomain: { startsWith: 'alerts-', endsWith: '.myshopify.com' } },
        select: { id: true }
      });
      const storeIds = stores.map(s => s.id);
      await db.orderLineItem.deleteMany({ where: { order: { storeId: { in: storeIds } } } });
      await db.order.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.dailyPLSnapshot.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.cogsLine.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.productVariant.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.storeMember.deleteMany({ where: { storeId: { in: storeIds } } });
      await db.auditLog.deleteMany({ where: { target: { in: storeIds } } }).catch(() => undefined);
      await db.shopifyStore.deleteMany({ where: { id: { in: storeIds } } });
      await db.user.deleteMany({ where: { email: { endsWith: '@alerts.test' } } });
    }
  } finally {
    await db.$disconnect();
  }
});

describe('Telegram settings', () => {
  maybe()('a viewer cannot change alerts', async () => {
    const r = await call('/api/notifications/telegram', 'PUT', viewerId, { enabled: true, chatId: '-100555', botToken: BOT });
    expect(r.status).toBe(403);
  });

  maybe()('rejects a malformed chat id, and turning on without a bot', async () => {
    expect((await call('/api/notifications/telegram', 'PUT', ownerId, { enabled: true, chatId: 'hello world' })).status).toBe(400);
    const noBot = await call('/api/notifications/telegram', 'PUT', ownerId, { enabled: true, chatId: '-100555' });
    expect(noBot.status).toBe(400);
    expect(noBot.json.error).toMatch(/bot token/i);
  });

  maybe()('finds the chat that messaged the bot', async () => {
    const r = await call('/api/notifications/telegram/detect-chats', 'POST', ownerId, { botToken: BOT });
    expect(r.status).toBe(200);
    expect(r.json.chats).toEqual([{ id: '-100555', title: 'Orders team', type: 'supergroup' }]);
  });

  maybe()('saves the bot token encrypted and never returns it', async () => {
    const r = await call('/api/notifications/telegram', 'PUT', ownerId, { enabled: true, chatId: '-100555', botToken: BOT });
    expect(r.status).toBe(200);
    const row = await db!.shopifyStore.findUnique({ where: { id: storeId } });
    expect(row!.telegramBotToken).toBeTruthy();
    expect(row!.telegramBotToken).not.toContain(BOT);

    const g = await call('/api/notifications/telegram', 'GET', viewerId);
    expect(g.json).toMatchObject({ enabled: true, chatId: '-100555', hasOwnBot: true, botUsername: 'shop_alert_bot' });
    expect(JSON.stringify(g.json)).not.toContain(BOT);
  });
});

describe('new-order alerts', () => {
  maybe()('a new order is announced once, with its details escaped', async () => {
    const payload = shopifyOrder();
    const first = await ingest(storeId, payload);
    expect(first.created).toBe(true);
    await until(async () => messages().length, n => n >= 1);

    // The same order arriving again (orders/updated webhook, periodic sync)…
    const again = await ingest(storeId, payload);
    expect(again.created).toBe(false);
    // …or a racing path calling notify directly: still one message.
    await notify(storeId, first.orderId, payload);
    await new Promise(r => setTimeout(r, 100));

    expect(messages()).toHaveLength(1);
    const m = messages()[0].body;
    expect(m.chat_id).toBe('-100555');
    expect(m.parse_mode).toBe('HTML');
    expect(m.text).toContain(`New order ${payload.name}`);
    expect(m.text).toContain('59.90 USD');
    expect(m.text).toContain('Tote &amp; Bag — Red × 2');
    expect(m.text).toContain('Ann &lt;b&gt;Lee&lt;/b&gt;');
    expect(m.text).not.toContain('<b>Lee');
  });

  maybe()('old orders pulled by a backfill are not announced', async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const r = await ingest(storeId, shopifyOrder({ created_at: old, processed_at: old }));
    expect(r.created).toBe(true);
    await new Promise(r => setTimeout(r, 150));
    expect(messages()).toHaveLength(0);
  });

  maybe()('a failed send is recorded on the store, and cleared by the next success', async () => {
    telegramFails = 'Bad Request: chat not found';
    await ingest(storeId, shopifyOrder());
    const failed = await until(() => db!.shopifyStore.findUnique({ where: { id: storeId } }), s => !!s?.telegramError);
    expect(failed!.telegramError).toContain('chat not found');

    telegramFails = null;
    await ingest(storeId, shopifyOrder());
    const ok = await until(() => db!.shopifyStore.findUnique({ where: { id: storeId } }), s => !s?.telegramError);
    expect(ok!.telegramError).toBeNull();
  });

  maybe()('nothing is sent while alerts are off', async () => {
    await db!.shopifyStore.update({ where: { id: storeId }, data: { telegramEnabled: false } });
    await ingest(storeId, shopifyOrder());
    await new Promise(r => setTimeout(r, 150));
    expect(messages()).toHaveLength(0);
  });
});

describe('re-costing after a COGS edit', () => {
  maybe()('orders that arrived before the price get costed without pressing anything', async () => {
    const order = await ingest(storeId, shopifyOrder());
    const before = await db!.orderLineItem.findFirst({ where: { orderId: order.orderId } });
    expect(before!.unitBasecost).toBeNull();

    const fees0 = await call('/api/pl/order-fees', 'GET', ownerId);
    const shopifyId = (await db!.order.findUnique({ where: { id: order.orderId } }))!.shopifyOrderId;
    expect(fees0.json.fees[shopifyId]).toMatchObject({ cogs: null, missingCost: true });

    const save = await call('/api/cogs-matrix/prices', 'PUT', ownerId, {
      cells: [{ lineId, variantId: String(VARIANT), setQty: 2, productCost: 14, shippingCost: 6 }]
    });
    expect(save.status).toBe(200);

    const after = await until(
      () => db!.orderLineItem.findFirst({ where: { orderId: order.orderId } }),
      li => li?.unitBasecost !== null
    );
    // Set of 2 priced 20 → 10 per unit, split 7 product / 3 shipping.
    expect(Number(after!.unitBasecost)).toBe(10);
    expect(Number(after!.unitProductCost)).toBe(7);
    expect(Number(after!.unitShippingCost)).toBe(3);

    const fees = await call('/api/pl/order-fees', 'GET', ownerId);
    expect(fees.json.fees[shopifyId]).toMatchObject({ cogs: 20, missingCost: false });
  });

  maybe()('a failed edit does not trigger a recompute', async () => {
    const order = await ingest(storeId, shopifyOrder({ line_items: [{ id: Number(`9${Date.now() % 1e9}`), title: 'X', quantity: 1, price: '1', variant_id: Number(VARIANT) + 1, product_id: 1 }] }));
    const r = await call('/api/cogs-matrix/prices', 'PUT', viewerId, {
      cells: [{ lineId, variantId: String(Number(VARIANT) + 1), setQty: 1, productCost: 5, shippingCost: 0 }]
    });
    expect(r.status).toBe(403);
    await new Promise(r => setTimeout(r, 200));
    const li = await db!.orderLineItem.findFirst({ where: { orderId: order.orderId } });
    expect(li!.unitBasecost).toBeNull();
  });
});
