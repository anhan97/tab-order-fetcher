/**
 * The /api/cogs and /api/comprehensive-cogs routers used to run with NO auth
 * middleware at all: every handler read the caller's identity out of the
 * `X-User-Id` / `X-Store-Id` request headers and trusted it. Anyone who could
 * reach the port could read or write any merchant's COGS by supplying an id,
 * and the service layer would lazily create a User/ShopifyStore for ids that
 * did not exist yet.
 *
 * These tests pin the guard: unauthenticated requests must be rejected before
 * a handler runs, and a forged identity header must not buy access.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { request, type Server } from 'http';
import { AddressInfo } from 'net';
import cogsRoutes from '../src/routes/cogs.routes';
import comprehensiveCogsRoutes from '../src/routes/comprehensive-cogs.routes';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cogs', cogsRoutes);
  app.use('/api/comprehensive-cogs', comprehensiveCogsRoutes);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

// [path, method, body?] — one per shape of handler in each router.
const GUARDED: Array<[string, string, unknown?]> = [
  ['/api/cogs/configs', 'GET'],
  ['/api/cogs/configs', 'POST', { variantId: '1', productId: '1', productTitle: 'x', variantTitle: 'y' }],
  ['/api/cogs/configs/bulk', 'POST', { configs: [] }],
  ['/api/cogs/configs/abc', 'PUT', { baseCost: 1 }],
  ['/api/cogs/configs/abc', 'DELETE'],
  ['/api/cogs/combo-pricing/abc', 'DELETE'],
  ['/api/cogs/pricing-tiers/abc', 'DELETE'],
  ['/api/cogs/pricing/1/US/1', 'GET'],
  ['/api/cogs/shipping-companies', 'GET'],
  ['/api/cogs/shipping-companies', 'POST', { name: 'x' }],
  ['/api/comprehensive-cogs/pricebooks', 'GET'],
  ['/api/comprehensive-cogs/pricebooks', 'POST', { country_code: 'US', shipping_company: 'x', currency: 'USD' }],
  ['/api/comprehensive-cogs/combos/abc', 'GET'],
  ['/api/comprehensive-cogs/cost/quote', 'POST', {}],
];

// Raw node:http rather than fetch — the shared vitest setup replaces
// `global.fetch` with a stub for the frontend tests, and that stub leaks into
// this file too.
function call(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      `${base}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      res => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('COGS routers reject unauthenticated callers', () => {
  it.each(GUARDED)('%s %s → 401 without a Bearer token', async (path, method, body) => {
    const res = await call(path, method, body);
    expect(res.status).toBe(401);
  });

  it.each(GUARDED)('%s %s → 401 even with forged identity headers', async (path, method, body) => {
    const res = await call(path, method, body, {
      'X-User-Id': 'default-user',
      'X-Store-Id': 'store_123'
    });
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ id: 'someone-elses-id' }, 'not-the-real-secret');
    const res = await call('/api/cogs/configs', 'GET', undefined, {
      Authorization: `Bearer ${forged}`
    });
    expect(res.status).toBe(401);
  });
});
