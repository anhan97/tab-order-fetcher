/**
 * Admin endpoints — read-only audit views over every user in the system.
 *
 * Mounted at `/api/admin`. Every endpoint is gated by requireAuth +
 * requireAdmin so only the operator (set via env ADMIN_EMAIL) can hit
 * them. We do NOT echo back FB app secrets / FB tokens — admins see
 * fingerprints + counts, not raw credentials. If they need to act on a
 * user's account they impersonate via existing per-user endpoints.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/require-auth';
import { requireAdmin } from '../middleware/require-admin';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireAdmin);

interface AdminUserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isVerified: boolean;
  createdAt: Date;
  storeCount: bigint;
  fbAppCount: bigint;
  fbConnectionCount: bigint;
}

/** GET /api/admin/users — paginated list with high-level FB counts. */
router.get('/users', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const search = String(req.query.q || '').trim();
  // Wildcard for ILIKE — empty string matches everything.
  const searchPattern = search ? `%${search}%` : '%';
  try {
    const rows = await prisma.$queryRaw<AdminUserRow[]>`
      SELECT u."id", u."email", u."firstName", u."lastName", u."role",
             u."isVerified", u."createdAt",
             (SELECT COUNT(*) FROM "ShopifyStore" s WHERE s."userId" = u."id" AND s."isActive" = TRUE) AS "storeCount",
             (SELECT COUNT(*) FROM "UserFacebookApp" a WHERE a."userId" = u."id") AS "fbAppCount",
             (SELECT COUNT(*) FROM "UserFacebookConnection" c WHERE c."userId" = u."id") AS "fbConnectionCount"
      FROM "User" u
      WHERE u."email" ILIKE ${searchPattern}
      ORDER BY u."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    // BigInt → number for JSON.
    const users = rows.map(r => ({
      ...r,
      storeCount: Number(r.storeCount),
      fbAppCount: Number(r.fbAppCount),
      fbConnectionCount: Number(r.fbConnectionCount)
    }));
    res.json({ users, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/users/:id — full detail for one user. */
router.get('/users/:id', async (req: Request, res: Response) => {
  const userId = req.params.id;
  try {
    const userRows = await prisma.$queryRaw<Array<{
      id: string; email: string; firstName: string | null; lastName: string | null;
      role: string; isVerified: boolean; createdAt: Date; updatedAt: Date;
    }>>`
      SELECT "id", "email", "firstName", "lastName", "role",
             "isVerified", "createdAt", "updatedAt"
      FROM "User" WHERE "id" = ${userId} LIMIT 1
    `;
    if (!userRows[0]) return res.status(404).json({ error: 'User not found' });
    const user = userRows[0];

    const stores = await prisma.shopifyStore.findMany({
      where: { userId },
      select: {
        id: true, storeDomain: true, name: true, isActive: true,
        defaultShippingCompany: true, defaultSupplier: true,
        createdAt: true, updatedAt: true
      }
    });

    const apps = await prisma.$queryRaw<Array<{
      id: string; fbAppId: string; fbBmId: string | null; appName: string | null;
      isActive: boolean; isDefault: boolean; lastError: string | null;
      secretLength: number; createdAt: Date; updatedAt: Date;
    }>>`
      SELECT "id", "fbAppId", "fbBmId", "appName", "isActive", "isDefault",
             "lastError", LENGTH("fbAppSecret") AS "secretLength",
             "createdAt", "updatedAt"
      FROM "UserFacebookApp"
      WHERE "userId" = ${userId}
      ORDER BY "isDefault" DESC, "createdAt" ASC
    `;

    const connections = await prisma.$queryRaw<Array<{
      id: string; fbAppId: string; fbUserId: string; fbUserName: string | null;
      expiresAt: Date | null; dataAccessExpiresAt: Date | null;
      lastRefreshedAt: Date | null; lastUsedAt: Date | null; lastError: string | null;
      createdAt: Date;
    }>>`
      SELECT "id", "fbAppId", "fbUserId", "fbUserName",
             "expiresAt", "dataAccessExpiresAt",
             "lastRefreshedAt", "lastUsedAt", "lastError", "createdAt"
      FROM "UserFacebookConnection"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" ASC
    `;

    res.json({ user, stores, fbApps: apps, fbConnections: connections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/stats — system-wide counts for the admin dashboard. */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<Array<{
      userCount: bigint; adminCount: bigint;
      storeCount: bigint; fbAppCount: bigint; fbConnectionCount: bigint;
    }>>`
      SELECT
        (SELECT COUNT(*) FROM "User") AS "userCount",
        (SELECT COUNT(*) FROM "User" WHERE "role" = 'admin') AS "adminCount",
        (SELECT COUNT(*) FROM "ShopifyStore" WHERE "isActive" = TRUE) AS "storeCount",
        (SELECT COUNT(*) FROM "UserFacebookApp") AS "fbAppCount",
        (SELECT COUNT(*) FROM "UserFacebookConnection") AS "fbConnectionCount"
    `;
    const r = rows[0];
    res.json({
      users: Number(r.userCount),
      admins: Number(r.adminCount),
      stores: Number(r.storeCount),
      fbApps: Number(r.fbAppCount),
      fbConnections: Number(r.fbConnectionCount)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
