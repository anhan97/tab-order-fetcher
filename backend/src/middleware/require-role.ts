/**
 * Generic role-gate middleware.
 *
 * Roles supported (all stored as plain strings on `User.role` — no Prisma
 * enum so we can add new ones without a migration):
 *
 *   admin   — sees & manages every user/store/FB app in the system. Only
 *             role allowed to register or assign FB Apps.
 *   user    — merchant. Owns their stores, uses FB Apps the admin has
 *             assigned to them. Cannot manage other users.
 *   cs      — Customer Service / fulfillment. Read-only on most things,
 *             can update fulfillment fields on orders.
 *   finance — Finance team. Reads P&L + cost data; no order edits, no
 *             FB management.
 *
 * Use:
 *   router.use(requireAuth, requireRole(['admin']));
 *   router.use(requireAuth, requireRole(['admin', 'finance']));
 *
 * On reject: 403 with the required role list so the frontend can show a
 * helpful "asks <role>" page instead of a generic forbidden.
 */
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type AppRole = 'admin' | 'user' | 'cs' | 'finance';
export const ALL_ROLES: AppRole[] = ['admin', 'user', 'cs', 'finance'];

declare global {
  namespace Express {
    interface Request {
      userRole?: AppRole;
    }
  }
}

// Tiny in-process role cache. Roles change rarely — a 30s TTL spares the
// DB from a round-trip on every request, which matters at the FB metrics
// + dashboard cadence.
const roleCache = new Map<string, { role: AppRole; at: number }>();
const ROLE_TTL_MS = 30_000;

export async function loadRole(userId: string): Promise<AppRole | null> {
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) return cached.role;
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT "role" FROM "User" WHERE "id" = ${userId} LIMIT 1
  `;
  if (!rows[0]) return null;
  const role = (rows[0].role as AppRole) || 'user';
  roleCache.set(userId, { role, at: Date.now() });
  return role;
}

export function invalidateRoleCache(userId?: string): void {
  if (!userId) { roleCache.clear(); return; }
  roleCache.delete(userId);
}

export function requireRole(allowed: AppRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const role = await loadRole(req.userId);
      if (!role || !allowed.includes(role)) {
        res.status(403).json({ error: 'Insufficient role', requires: allowed, actual: role });
        return;
      }
      req.userRole = role;
      next();
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to verify role' });
    }
  };
}

/** Convenience helpers — shorter at callsites than requireRole([...]). */
export const requireAdminRole = requireRole(['admin']);
export const requireAdminOrFinance = requireRole(['admin', 'finance']);
export const requireAnyKnownRole = requireRole(ALL_ROLES);
