/**
 * Guard for the Shopify proxy endpoints (live orders, tracking writeback,
 * products). These used to trust the raw `X-Shopify-Store-Domain` +
 * `X-Shopify-Access-Token` headers with no auth at all.
 *
 * Resolution:
 *   1. JWT present → the store must belong to that user (by domain). The
 *      actual Shopify call then uses the DB-stored (decrypted) token, so the
 *      frontend no longer needs to hold a real token at all.
 *   2. No JWT (legacy) → the header token must match a stored token for that
 *      domain. Same ownership proof resolve-store uses; blocks using our
 *      backend as an open Shopify proxy.
 *
 * On success sets `req.storeAccess = { storeId, userId, storeDomain, accessToken }`
 * (accessToken already decrypted).
 */
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import { decryptToken } from '../lib/token-crypto';

const prisma = new PrismaClient();

declare global {
  namespace Express {
    interface Request {
      storeAccess?: { storeId: string; userId: string; storeDomain: string; accessToken: string };
    }
  }
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\/admin$/, '');
}

export async function requireStoreAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const rawDomain = (req.headers['x-shopify-store-domain'] || req.headers['x-shopify-store-url']) as string | undefined;
    if (!rawDomain) {
      return res.status(400).json({ error: 'X-Shopify-Store-Domain header required' });
    }
    const storeDomain = normalizeDomain(rawDomain);

    // 1. JWT path
    const auth = req.header('authorization') || req.header('Authorization');
    if (auth?.startsWith('Bearer ')) {
      try {
        const claims = verifyAccessToken(auth.slice(7).trim());
        if (claims?.id) {
          if (claims.status === 'PENDING' || claims.status === 'SUSPENDED') {
            return res.status(403).json({
              error: claims.status === 'PENDING' ? 'Account is awaiting admin approval' : 'Account is suspended',
              code: claims.status === 'PENDING' ? 'account_pending' : 'account_suspended'
            });
          }
          const store = await prisma.shopifyStore.findUnique({
            where: { userId_storeDomain: { userId: claims.id, storeDomain } }
          });
          if (!store || !store.isActive) {
            return res.status(404).json({ error: `Store ${storeDomain} not found for this user` });
          }
          req.storeAccess = {
            storeId: store.id,
            userId: store.userId,
            storeDomain,
            accessToken: decryptToken(store.accessToken)
          };
          return next();
        }
      } catch { /* invalid/expired JWT → fall through to legacy header check */ }
    }

    // 2. Legacy header path — header token must match a stored one.
    const headerToken = req.headers['x-shopify-access-token'] as string | undefined;
    if (!headerToken) {
      return res.status(401).json({ error: 'Authentication required (Bearer JWT or X-Shopify-Access-Token)' });
    }
    const candidates = await prisma.shopifyStore.findMany({
      where: { storeDomain, isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    const match = candidates.find(s => decryptToken(s.accessToken) === headerToken);
    if (!match) {
      return res.status(401).json({ error: 'Unknown store or token mismatch' });
    }
    req.storeAccess = {
      storeId: match.id,
      userId: match.userId,
      storeDomain,
      accessToken: headerToken
    };
    next();
  } catch (e: any) {
    console.error('requireStoreAccess error:', e);
    res.status(500).json({ error: 'Store access check failed', details: e?.message });
  }
}
