import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Verify the JWT in `Authorization: Bearer <token>` and expose `req.userId`.
 *
 * 401s on missing / malformed / expired tokens. Use this on every endpoint
 * that touches per-user data — `resolveStore` then narrows down to a
 * specific store for that user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.header('authorization') || req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'default-secret') as { id: string };
    if (!payload?.id) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }
    req.userId = payload.id;
    next();
  } catch (e: any) {
    res.status(401).json({ error: 'Invalid or expired token', detail: e?.message });
  }
}

/**
 * Best-effort variant — attaches `req.userId` if the header is present and
 * valid, but does not 401 when missing. Use on endpoints that have legacy
 * header-based fallbacks (Shopify domain + token) but should still prefer
 * the JWT user when one is provided.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.header('authorization') || req.header('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7).trim(), process.env.JWT_SECRET || 'default-secret') as { id: string };
      if (payload?.id) req.userId = payload.id;
    } catch { /* swallow — fall through to legacy resolution */ }
  }
  next();
}
