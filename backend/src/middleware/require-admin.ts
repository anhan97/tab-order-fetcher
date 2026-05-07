/**
 * Admin-gated route middleware.
 *
 * Reads `req.userId` (set by `requireAuth` upstream) and rejects unless
 * the user's `role` column is 'admin'. Bootstrap is handled in
 * auth.controller via the ADMIN_EMAIL env var — first time that email
 * logs in we promote them.
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ role: string }>>`
      SELECT "role" FROM "User" WHERE "id" = ${req.userId} LIMIT 1
    `;
    if (rows[0]?.role !== 'admin') {
      res.status(403).json({ error: 'Admin role required' });
      return;
    }
    next();
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to verify admin role' });
  }
}

/**
 * Promote a user to admin by email. No-op if no such user. Called from
 * the auth controller on first login of ADMIN_EMAIL.
 */
export async function ensureAdminByEmail(email: string): Promise<void> {
  if (!email) return;
  await prisma.$executeRaw`
    UPDATE "User" SET "role" = 'admin', "updatedAt" = NOW()
    WHERE LOWER("email") = LOWER(${email}) AND "role" <> 'admin'
  `;
}
