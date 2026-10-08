/**
 * HTTP helpers shared by the launcher routers: the `{ success, data | error }`
 * envelope (§7), the auth chain and the caller context.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError } from 'zod';
import { requireActive, requireAuth } from '../middleware/require-auth';
import { loadRole } from '../middleware/require-role';
import { requireStoreCapability, resolveStore } from '../middleware/resolve-store';
import type { StoreScope } from './creatives.service';
import type { Caller } from './token-owner';

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export function zodFail(res: Response, error: ZodError): void {
  fail(res, 400, 'invalid_request', error.issues[0]?.message ?? 'Invalid request', error.issues.map(i => ({ path: i.path.join('.'), message: i.message })));
}

/**
 * Store-scoped auth chain: valid JWT, approved account, a store the caller
 * can open, and the capability the route needs. resolveStore answers with the
 * legacy `{ error }` shape; that is fine for these rare paths.
 */
export function storeChain(capability: 'read' | 'manage'): RequestHandler[] {
  return [requireAuth, requireActive, resolveStore, requireStoreCapability(capability)];
}

export function scopeOf(req: Request): StoreScope {
  const r = req.resolved!;
  return { ownerId: r.userId, storeId: r.storeId, actorId: r.actorId };
}

export async function callerOf(req: Request): Promise<Caller> {
  const r = req.resolved!;
  const role = await loadRole(r.actorId);
  return { actorId: r.actorId, ownerId: r.userId, isAdmin: role === 'admin' };
}

/** Wrap an async handler so a throw becomes a 500 envelope, not a hang. */
export function handle(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    fn(req, res).catch(e => {
      console.error('[ads-launcher]', req.method, req.originalUrl, e);
      if (!res.headersSent) fail(res, 500, 'internal_error', e?.message || 'Internal error');
    });
  };
}
