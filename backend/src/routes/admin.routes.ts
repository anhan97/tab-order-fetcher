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

/** GET /api/admin/stores — every active store across every user. */
router.get('/stores', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const search = String(req.query.q || '').trim();
  const includeInactive = String(req.query.includeInactive || '') === '1';
  const wildcardOrAll = search ? `%${search}%` : '%';
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string; storeDomain: string; name: string | null;
      isActive: boolean; createdAt: Date; updatedAt: Date;
      userId: string; userEmail: string;
      userFirstName: string | null; userLastName: string | null;
      userRole: string;
      orderCount: bigint;
    }>>`
      SELECT
        s."id", s."storeDomain", s."name", s."isActive",
        s."createdAt", s."updatedAt",
        u."id"        AS "userId",
        u."email"     AS "userEmail",
        u."firstName" AS "userFirstName",
        u."lastName"  AS "userLastName",
        u."role"      AS "userRole",
        (SELECT COUNT(*) FROM "Order" o WHERE o."storeId" = s."id") AS "orderCount"
      FROM "ShopifyStore" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE (s."isActive" = TRUE OR ${includeInactive})
        AND (s."storeDomain" ILIKE ${wildcardOrAll}
             OR u."email" ILIKE ${wildcardOrAll}
             OR COALESCE(s."name", '') ILIKE ${wildcardOrAll})
      ORDER BY s."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const stores = rows.map(r => ({
      ...r,
      orderCount: Number(r.orderCount)
    }));
    res.json({ stores, limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/users/:id/fb-apps/assign
 * Body: { fbAppId, fbAppSecret, fbBmId?, appName?, makeDefault? }
 *
 * Provision an FB App for the target user. Admin pastes the App ID/Secret
 * they registered at developers.facebook.com — we insert a row into
 * UserFacebookApp with userId=target. The target user's FB Login flow
 * then resolves through that row and reaches FB with the right creds.
 *
 * Why we copy the row rather than reference-share: UserFacebookConnection
 * joins on (userId, fbAppId), so each user needs their OWN row keyed by
 * their userId. Sharing creds is intentional — admin trusts the assignee
 * with the App Secret (Facebook lets the same App talk to N FB accounts).
 */
router.post('/users/:id/fb-apps/assign', async (req: Request, res: Response) => {
  const targetUserId = req.params.id;
  const { fbAppId, fbAppSecret, fbBmId, appName, makeDefault } = req.body || {};
  if (typeof fbAppId !== 'string' || !/^\d{8,20}$/.test(fbAppId.trim())) {
    return res.status(400).json({ error: 'fbAppId must be a numeric FB App ID (8-20 digits)' });
  }
  if (typeof fbAppSecret !== 'string' || fbAppSecret.length < 16) {
    return res.status(400).json({ error: 'fbAppSecret looks too short' });
  }
  try {
    const exists = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${targetUserId} LIMIT 1
    `;
    if (!exists[0]) return res.status(404).json({ error: 'User not found' });

    const userFbApp = await import('../services/user-fb-app.service');
    const out = await userFbApp.upsert(targetUserId, {
      fbAppId: fbAppId.trim(),
      fbAppSecret: fbAppSecret.trim(),
      fbBmId: fbBmId !== undefined ? (String(fbBmId).trim() || null) : undefined,
      appName: appName !== undefined ? (String(appName).trim() || null) : undefined,
      makeDefault: !!makeDefault
    });
    res.json({ app: out });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/admin/users/:id/fb-apps/:fbAppId — revoke an assignment. */
router.delete('/users/:id/fb-apps/:fbAppId', async (req: Request, res: Response) => {
  const targetUserId = req.params.id;
  const fbAppId = String(req.params.fbAppId || '').trim();
  if (!fbAppId) return res.status(400).json({ error: 'fbAppId required' });
  try {
    const userFbApp = await import('../services/user-fb-app.service');
    await userFbApp.deleteApp(targetUserId, fbAppId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/users/:id/role
 * Body: { role: 'admin' | 'user' | 'cs' | 'finance' }
 *
 * Promote/demote. We invalidate the role cache so the next request sees
 * the new role immediately rather than waiting for the 30s TTL.
 */
router.put('/users/:id/role', async (req: Request, res: Response) => {
  const targetUserId = req.params.id;
  const role = String(req.body?.role || '').trim();
  const ALLOWED = ['admin', 'user', 'cs', 'finance'];
  if (!ALLOWED.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${ALLOWED.join(', ')}` });
  }
  // Guard: don't let an admin demote themselves into a no-admin state by
  // accident. They can demote OTHER admins, but not themselves.
  if (targetUserId === req.userId && role !== 'admin') {
    return res.status(400).json({ error: 'Refusing to demote yourself' });
  }
  try {
    await prisma.$executeRaw`
      UPDATE "User" SET "role" = ${role}, "updatedAt" = NOW() WHERE "id" = ${targetUserId}
    `;
    const { invalidateRoleCache } = await import('../middleware/require-role');
    invalidateRoleCache(targetUserId);
    res.json({ ok: true, role });
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
