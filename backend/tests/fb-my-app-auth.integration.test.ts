/**
 * Admin-only FB app routes (/api/facebook/my-app, /my-apps…) must accept a
 * valid admin JWT. They chained resolveStore → requireRole without
 * requireAuth, and requireRole reads req.userId — which only requireAuth
 * sets — so every call answered 401 "Authentication required", admins included.
 *
 * OPT-IN like the other *.integration tests: TEST_DATABASE_URL and
 * DATABASE_URL must both point at the same throwaway, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const db = TEST_DB_URL ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } }) : null;

let live = false;
if (!db) {
  console.warn('[fb-my-app-auth] TEST_DATABASE_URL not set — skipping');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  console.warn('[fb-my-app-auth] DATABASE_URL must equal TEST_DATABASE_URL — skipping');
} else {
  try {
    await db.$queryRaw`SELECT 1 FROM "UserFacebookApp" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[fb-my-app-auth] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}
const maybe = () => (live ? it : it.skip);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `fbapp-${suffix}.invalid`;
const SECRET = process.env.JWT_SECRET || 'default-secret';

let adminId = '', userId = '';
const storeIds: string[] = [];
let server: Server;
let base = '';

// src/test/setup.ts mocks global fetch, so talk HTTP directly.
function call(path: string, method: string, as: string | null, body?: unknown): Promise<{ status: number; json: any }> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'X-Shopify-Store-Domain': DOMAIN, 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${jwt.sign({ id: as, status: 'ACTIVE' }, SECRET)}`;
  if (payload) headers['Content-Length'] = String(payload.length);
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, res => {
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

beforeAll(async () => {
  if (!live || !db) return;
  const mk = async (who: string, role: string) => (await db.user.create({
    data: { email: `${who}-${suffix}@fbapp.test`, password: 'x', isVerified: true, status: 'ACTIVE', role }
  })).id;
  adminId = await mk('admin', 'admin');
  userId = await mk('user', 'user');
  for (const owner of [adminId, userId]) {
    storeIds.push((await db.shopifyStore.create({ data: { userId: owner, storeDomain: DOMAIN, accessToken: 'blob', isActive: true } })).id);
  }
  const { default: facebookRoutes } = await import('../src/routes/facebook.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/facebook', facebookRoutes);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  if (db && live) {
    await db.shopifyStore.deleteMany({ where: { id: { in: storeIds } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, userId].filter(Boolean) } } });
  }
  await db?.$disconnect();
});

describe('admin FB app routes', { timeout: 30_000 }, () => {
  // An invalid App ID stops at validation (400): it proves the auth chain let
  // the request through without writing anything.
  const bad = { fbAppId: 'not-a-number' };

  maybe()('admin JWT passes the gate (was 401 "Authentication required")', async () => {
    const put = await call('/api/facebook/my-app', 'PUT', adminId, bad);
    expect(put.status).toBe(400);
    expect(put.json.error).toMatch(/fbAppId/);
    const post = await call('/api/facebook/my-apps', 'POST', adminId, bad);
    expect(post.status).not.toBe(401);
    expect(post.status).not.toBe(403);
  });

  maybe()('non-admin gets 403, no token gets 401', async () => {
    expect((await call('/api/facebook/my-app', 'PUT', userId, bad)).status).toBe(403);
    expect((await call('/api/facebook/my-app', 'PUT', null, bad)).status).toBe(401);
    expect((await call('/api/facebook/my-app', 'DELETE', userId)).status).toBe(403);
  });
});
