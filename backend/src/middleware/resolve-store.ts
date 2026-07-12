import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { decryptToken, encryptToken } from '../lib/token-crypto';

const prisma = new PrismaClient();

declare global {
  namespace Express {
    interface Request {
      resolved?: { userId: string; storeId: string; storeDomain: string };
    }
  }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\/admin$/, '');
}

function userIdFromAuthHeader(req: Request): string | null {
  // First check req.userId set by an upstream requireAuth middleware.
  if (req.userId) return req.userId;
  const auth = req.header('authorization') || req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7).trim(), process.env.JWT_SECRET || 'default-secret') as { id: string };
    return payload?.id || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the (User, ShopifyStore) tuple for a request.
 *
 * Resolution order:
 *   1. Explicit `userId`/`storeId` in query/body — for service-to-service.
 *   2. JWT in `Authorization: Bearer …` + `X-Shopify-Store-Domain` — the
 *      logged-in user picks which of THEIR stores this request targets.
 *      Token comes from DB (the header `X-Shopify-Access-Token` is ignored
 *      once the user has been authenticated).
 *   3. Legacy: `X-Shopify-Store-Domain` + `X-Shopify-Access-Token` headers
 *      with no JWT → lazy-create a synthetic user. Kept for back-compat
 *      with the few endpoints / scripts that haven't migrated yet.
 */
export async function resolveStore(req: Request, res: Response, next: NextFunction) {
  try {
    const rawDomain = (req.headers['x-shopify-store-domain'] || req.headers['x-shopify-store-url']) as string | undefined;

    // 1. Explicit override
    const explicitUser = (req.query.userId as string) || (req.body && req.body.userId);
    const explicitStore = (req.query.storeId as string) || (req.body && req.body.storeId);
    if (explicitUser && explicitStore) {
      req.resolved = { userId: explicitUser, storeId: explicitStore, storeDomain: rawDomain ? normalizeDomain(rawDomain) : '' };
      return next();
    }

    // 2. JWT-authenticated user picks one of their stores
    const authedUserId = userIdFromAuthHeader(req);
    if (authedUserId) {
      const domain = rawDomain ? normalizeDomain(rawDomain) : null;
      let store = null;
      if (domain) {
        store = await prisma.shopifyStore.findUnique({
          where: { userId_storeDomain: { userId: authedUserId, storeDomain: domain } }
        });
      }
      // If domain not specified, default to the user's first active store.
      if (!store) {
        store = await prisma.shopifyStore.findFirst({
          where: { userId: authedUserId, isActive: true },
          orderBy: { createdAt: 'asc' }
        });
      }
      if (!store) {
        return res.status(404).json({ error: 'No store found for this user. Add one via /api/auth/stores.' });
      }
      req.resolved = { userId: authedUserId, storeId: store.id, storeDomain: store.storeDomain };
      return next();
    }

    // 3. Legacy header auth (no JWT): X-Shopify-Store-Domain + X-Shopify-Access-Token.
    const accessToken = req.headers['x-shopify-access-token'] as string | undefined;
    if (!rawDomain || !accessToken) {
      return res.status(401).json({ error: 'Authentication required. Provide a Bearer JWT, or fall back to X-Shopify-Store-Domain + X-Shopify-Access-Token headers.' });
    }
    const storeDomain = normalizeDomain(rawDomain);
    const syntheticEmail = `${storeDomain}@autocreated.local`;

    // 3a. Prefer the REAL user who already registered this store (via
    // /api/auth/stores). Historically this path always lazy-created a
    // synthetic `<domain>@autocreated.local` user, so the same person hit
    // the API as TWO different userIds depending on whether the frontend
    // call attached the JWT. FB tokens / campaign mappings / metrics are
    // all keyed by userId, so that split made "connected" checks and P&L
    // look at the wrong user. Matching the access token proves store
    // ownership just as strongly as the old behavior did.
    const ownedStores = await prisma.shopifyStore.findMany({
      where: { storeDomain },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' }
    });
    const realStore = ownedStores.find(s =>
      decryptToken(s.accessToken) === accessToken && !s.user.email.endsWith('@autocreated.local')
    );
    if (realStore) {
      req.resolved = { userId: realStore.userId, storeId: realStore.id, storeDomain };
      return next();
    }

    // 3b. No real owner → legacy synthetic-user fallback.
    let user = await prisma.user.findUnique({ where: { email: syntheticEmail } });
    if (!user) {
      const hashed = await bcrypt.hash(Math.random().toString(36).slice(2), 8);
      user = await prisma.user.create({
        data: { email: syntheticEmail, password: hashed, isVerified: true, firstName: storeDomain }
      });
    }

    let store = await prisma.shopifyStore.findUnique({
      where: { userId_storeDomain: { userId: user.id, storeDomain } }
    });
    if (!store) {
      store = await prisma.shopifyStore.create({
        data: { userId: user.id, storeDomain, accessToken: encryptToken(accessToken), isActive: true }
      });
    } else if (decryptToken(store.accessToken) !== accessToken) {
      store = await prisma.shopifyStore.update({
        where: { id: store.id },
        data: { accessToken: encryptToken(accessToken) }
      });
    }

    req.resolved = { userId: user.id, storeId: store.id, storeDomain };
    next();
  } catch (e: any) {
    console.error('resolveStore error:', e);
    res.status(500).json({ error: 'Failed to resolve store', details: e?.message });
  }
}
