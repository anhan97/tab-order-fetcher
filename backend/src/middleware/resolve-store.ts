import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { decryptToken, encryptToken } from '../lib/token-crypto';
import { loadRole } from './require-role';
import {
  resolveStoreAccess, listAccessibleStores, can,
  type StoreAccessLevel, type StoreCapability
} from '../lib/store-access';

const prisma = new PrismaClient();

declare global {
  namespace Express {
    interface Request {
      resolved?: {
        userId: string;
        storeId: string;
        storeDomain: string;
        /** Caller's access level in THIS store: owner | manager | cs | finance | viewer. */
        level?: StoreAccessLevel;
        /** Store's owner — differs from userId when access came from a grant. */
        ownerId?: string;
      };
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
 *   1. Explicit `userId`/`storeId` in query/body — ADMIN ONLY. This used to
 *      be honoured for anyone, before any auth check, which meant
 *      `?userId=<victim>&storeId=<their store>` impersonated them outright —
 *      unauthenticated on routers that mount resolveStore without requireAuth.
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

    // 1. Explicit override — admins only.
    //
    // Anyone could previously pass ?userId=&storeId= and be resolved as that
    // user, ahead of every auth branch below. A non-admin who sends these now
    // just falls through to normal resolution (their own stores) rather than
    // getting an error, so a stray param cannot lock a real user out.
    const explicitUser = (req.query.userId as string) || (req.body && req.body.userId);
    const explicitStore = (req.query.storeId as string) || (req.body && req.body.storeId);
    if (explicitUser && explicitStore) {
      const callerId = userIdFromAuthHeader(req);
      const callerRole = callerId ? await loadRole(callerId) : null;
      if (callerRole === 'admin') {
        const store = await prisma.shopifyStore.findUnique({ where: { id: explicitStore } });
        req.resolved = {
          userId: explicitUser,
          storeId: explicitStore,
          storeDomain: store?.storeDomain || (rawDomain ? normalizeDomain(rawDomain) : ''),
          level: 'owner',
          ownerId: store?.userId || explicitUser
        };
        return next();
      }
    }

    // 2. JWT-authenticated user picks one of their stores
    const authedUserId = userIdFromAuthHeader(req);
    if (authedUserId) {
      const domain = rawDomain ? normalizeDomain(rawDomain) : null;

      // Owned OR admin-granted (StoreMember) — resolveStoreAccess covers both
      // and reports which, so downstream capability gates know what to allow.
      let access = domain
        ? await resolveStoreAccess(authedUserId, { storeDomain: domain })
        : null;

      // No domain header (or a domain they can't open) → fall back to the
      // first store they can reach at all, owned ones first.
      if (!access) {
        const [first] = await listAccessibleStores(authedUserId);
        if (first) {
          access = { storeId: first.id, storeDomain: first.storeDomain, ownerId: first.ownerId, level: first.access };
        }
      }
      if (!access) {
        return res.status(404).json({ error: 'No store found for this user. Add one via /api/auth/stores.' });
      }
      req.resolved = {
        userId: authedUserId,
        storeId: access.storeId,
        storeDomain: access.storeDomain,
        level: access.level,
        ownerId: access.ownerId
      };
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
      req.resolved = { userId: realStore.userId, storeId: realStore.id, storeDomain, level: 'owner', ownerId: realStore.userId };
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

    req.resolved = { userId: user.id, storeId: store.id, storeDomain, level: 'owner', ownerId: user.id };
    next();
  } catch (e: any) {
    console.error('resolveStore error:', e);
    res.status(500).json({ error: 'Failed to resolve store', details: e?.message });
  }
}


/**
 * Gate a store-scoped route on a capability. Mount AFTER resolveStore:
 *
 *   router.patch('/:id/tracking', requireStoreCapability('fulfill'), handler)
 *
 * 403 names the capability so the UI can say "you have read-only access to
 * this store" instead of a bare Forbidden.
 */
export function requireStoreCapability(capability: StoreCapability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const resolved = req.resolved;
    if (!resolved) {
      res.status(500).json({ error: 'requireStoreCapability used without resolveStore' });
      return;
    }
    // Legacy header-auth paths set level 'owner'; a missing level would mean
    // resolveStore was bypassed, so fail closed rather than assuming owner.
    if (!can(resolved.level, capability)) {
      res.status(403).json({
        error: `Your access to this store does not allow "${capability}"`,
        code: 'store_capability_denied',
        requires: capability,
        access: resolved.level ?? null
      });
      return;
    }
    next();
  };
}

/** Only the store's owner (never a granted member) may do this. */
export function requireStoreOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.resolved?.level !== 'owner') {
    res.status(403).json({
      error: 'Only the store owner can do this',
      code: 'store_owner_required',
      access: req.resolved?.level ?? null
    });
    return;
  }
  next();
}
