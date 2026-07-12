import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import type { AppRole } from './require-role';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userStatus?: string;
      // userRole is declared by require-role.ts (AppRole)
    }
  }
}

function readClaims(req: Request): { id: string; status?: string; role?: string } | null {
  const auth = req.header('authorization') || req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const payload = verifyAccessToken(auth.slice(7).trim());
    return payload?.id ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Verify the JWT in `Authorization: Bearer <token>` and expose `req.userId`
 * (+ `userStatus`/`userRole` claims for the approval gate / RBAC).
 *
 * 401s on missing / malformed / expired tokens. Use this on every endpoint
 * that touches per-user data — `resolveStore` then narrows down to a
 * specific store for that user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const claims = readClaims(req);
  if (!claims) {
    res.status(401).json({ error: 'Invalid or missing Bearer token', code: 'unauthorized' });
    return;
  }
  req.userId = claims.id;
  req.userStatus = claims.status;
  if (claims.role) req.userRole = claims.role as AppRole;
  next();
}

/**
 * Approval gate — mount AFTER requireAuth. Pre-refresh tokens carry no
 * status claim; treat them as ACTIVE (they were minted before the gate
 * existed, by users who were backfilled to ACTIVE).
 */
export function requireActive(req: Request, res: Response, next: NextFunction): void {
  const status = req.userStatus || 'ACTIVE';
  if (status === 'PENDING') {
    res.status(403).json({ error: 'Account is awaiting admin approval', code: 'account_pending' });
    return;
  }
  if (status === 'SUSPENDED') {
    res.status(403).json({ error: 'Account is suspended', code: 'account_suspended' });
    return;
  }
  next();
}

/**
 * Best-effort variant — attaches `req.userId` if the header is present and
 * valid, but does not 401 when missing. Use on endpoints that have legacy
 * header-based fallbacks (Shopify domain + token) but should still prefer
 * the JWT user when one is provided.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const claims = readClaims(req);
  if (claims) {
    req.userId = claims.id;
    req.userStatus = claims.status;
    if (claims.role) req.userRole = claims.role as AppRole;
  }
  next();
}
