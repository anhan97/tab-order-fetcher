/**
 * Admin → user FB-app access pivot.
 *
 * Model: admins register FB Apps in UserFacebookApp (their own userId on
 * the row). Users get permission to USE those apps via rows in
 * FacebookAppUserAccess. When a non-admin connects FB, we resolve which
 * app's (App ID, App Secret) to use by consulting this pivot.
 *
 * The pivot is set-semantics on the UI side: admin sees a multi-select
 * user list and saves a snapshot. The service exposes:
 *
 *   listAppsForUser(userId)       — apps this user can log in through.
 *                                   Returns own apps first, then assigned.
 *   listUsersForApp(adminUserFbAppId)
 *                                 — assignees of one admin-owned app.
 *   setUsersForApp(adminUserId, fbAppId, userIds[])
 *                                 — reconcile assignees in one shot.
 *   assignUser(adminUserId, fbAppId, targetUserId)
 *   revokeUser(adminUserId, fbAppId, targetUserId)
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export interface AvailableApp {
  /** The UserFacebookApp.id of the admin's row. */
  appRowId: string;
  fbAppId: string;
  fbBmId: string | null;
  appName: string | null;
  isActive: boolean;
  isOwn: boolean;        // true → this user is the registrant (admin)
  isDefault: boolean;    // user's chosen default (own apps only)
  ownerUserId: string;
  ownerEmail: string | null;
}

export interface AssignedUserRow {
  pivotId: string;
  assignedUserId: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
}

/**
 * Find the admin's UserFacebookApp row for a given fbAppId. We trust the
 * caller's userId (the route layer requires admin role) and look up the
 * row PK + secret length for logging.
 */
async function loadOwnApp(adminUserId: string, fbAppId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "UserFacebookApp"
    WHERE "userId" = ${adminUserId} AND "fbAppId" = ${fbAppId}
    LIMIT 1
  `;
  return rows[0] || null;
}

/** Apps a user is allowed to connect FB through. */
export async function listAppsForUser(userId: string): Promise<AvailableApp[]> {
  // Own apps. Cheap — single index on (userId, fbAppId).
  const own = await prisma.$queryRaw<Array<{
    id: string; fbAppId: string; fbBmId: string | null; appName: string | null;
    isActive: boolean; isDefault: boolean; userId: string;
  }>>`
    SELECT a."id", a."fbAppId", a."fbBmId", a."appName",
           a."isActive", a."isDefault", a."userId"
    FROM "UserFacebookApp" a
    WHERE a."userId" = ${userId} AND a."isActive" = TRUE
    ORDER BY a."isDefault" DESC, a."createdAt" ASC
  `;

  // Apps reachable via pivot. JOIN the underlying UserFacebookApp row so
  // we get the canonical name / BM / active flag from the admin's record.
  const assigned = await prisma.$queryRaw<Array<{
    id: string; fbAppId: string; fbBmId: string | null; appName: string | null;
    isActive: boolean; userId: string; ownerEmail: string | null;
  }>>`
    SELECT a."id", a."fbAppId", a."fbBmId", a."appName",
           a."isActive", a."userId",
           u."email" AS "ownerEmail"
    FROM "FacebookAppUserAccess" p
    JOIN "UserFacebookApp" a ON a."id" = p."userFbAppId"
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE p."assignedUserId" = ${userId}
      AND a."isActive" = TRUE
      AND a."userId" <> ${userId}            -- exclude duplicates if a user is
                                             -- both owner and pivoted (edge)
    ORDER BY a."createdAt" ASC
  `;

  const ownEmails = new Map<string, string | null>();
  if (own.length > 0) {
    const ownerRows = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
      SELECT "id", "email" FROM "User" WHERE "id" = ${userId} LIMIT 1
    `;
    ownEmails.set(userId, ownerRows[0]?.email || null);
  }

  return [
    ...own.map(a => ({
      appRowId: a.id,
      fbAppId: a.fbAppId,
      fbBmId: a.fbBmId,
      appName: a.appName,
      isActive: a.isActive,
      isOwn: true,
      isDefault: a.isDefault,
      ownerUserId: a.userId,
      ownerEmail: ownEmails.get(a.userId) || null
    })),
    ...assigned.map(a => ({
      appRowId: a.id,
      fbAppId: a.fbAppId,
      fbBmId: a.fbBmId,
      appName: a.appName,
      isActive: a.isActive,
      isOwn: false,
      isDefault: false,
      ownerUserId: a.userId,
      ownerEmail: a.ownerEmail
    }))
  ];
}

/** Who has access to one admin-owned app (admin UI). */
export async function listUsersForApp(adminUserId: string, fbAppId: string): Promise<AssignedUserRow[]> {
  const own = await loadOwnApp(adminUserId, fbAppId);
  if (!own) return [];
  return prisma.$queryRaw<AssignedUserRow[]>`
    SELECT p."id" AS "pivotId", p."assignedUserId", p."createdAt",
           u."email", u."role", u."firstName", u."lastName"
    FROM "FacebookAppUserAccess" p
    JOIN "User" u ON u."id" = p."assignedUserId"
    WHERE p."userFbAppId" = ${own.id}
    ORDER BY u."email" ASC
  `;
}

/**
 * Reconcile the assignee set for one app in a single call.
 * Inserts missing rows, deletes rows not in the new set. Atomic.
 */
export async function setUsersForApp(
  adminUserId: string,
  fbAppId: string,
  userIds: string[]
): Promise<{ added: number; removed: number; total: number }> {
  const own = await loadOwnApp(adminUserId, fbAppId);
  if (!own) throw new Error('FB App not found for this admin');
  const cleanIds = Array.from(new Set(userIds.filter(Boolean)));

  return prisma.$transaction(async tx => {
    const existing = await tx.$queryRaw<Array<{ assignedUserId: string }>>`
      SELECT "assignedUserId" FROM "FacebookAppUserAccess"
      WHERE "userFbAppId" = ${own.id}
    `;
    const have = new Set(existing.map(r => r.assignedUserId));
    const want = new Set(cleanIds);

    const toAdd = cleanIds.filter(id => !have.has(id));
    const toRemove = existing.map(r => r.assignedUserId).filter(id => !want.has(id));

    let added = 0;
    for (const uid of toAdd) {
      // Skip nonexistent users — defensive against stale UI state.
      const userExists = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${uid} LIMIT 1
      `;
      if (!userExists[0]) continue;
      await tx.$executeRaw`
        INSERT INTO "FacebookAppUserAccess" ("id", "userFbAppId", "assignedUserId", "createdAt")
        VALUES (${crypto.randomUUID()}, ${own.id}, ${uid}, NOW())
        ON CONFLICT ("userFbAppId", "assignedUserId") DO NOTHING
      `;
      added++;
    }

    let removed = 0;
    if (toRemove.length > 0) {
      const result = await tx.$executeRaw`
        DELETE FROM "FacebookAppUserAccess"
        WHERE "userFbAppId" = ${own.id}
          AND "assignedUserId" = ANY(${toRemove}::text[])
      `;
      removed = Number(result);
    }

    return { added, removed, total: cleanIds.length };
  });
}

/** Convenience: add one. Idempotent via ON CONFLICT DO NOTHING. */
export async function assignUser(
  adminUserId: string,
  fbAppId: string,
  targetUserId: string
): Promise<void> {
  const own = await loadOwnApp(adminUserId, fbAppId);
  if (!own) throw new Error('FB App not found for this admin');
  await prisma.$executeRaw`
    INSERT INTO "FacebookAppUserAccess" ("id", "userFbAppId", "assignedUserId", "createdAt")
    VALUES (${crypto.randomUUID()}, ${own.id}, ${targetUserId}, NOW())
    ON CONFLICT ("userFbAppId", "assignedUserId") DO NOTHING
  `;
}

/** Convenience: remove one. */
export async function revokeUser(
  adminUserId: string,
  fbAppId: string,
  targetUserId: string
): Promise<void> {
  const own = await loadOwnApp(adminUserId, fbAppId);
  if (!own) return;
  await prisma.$executeRaw`
    DELETE FROM "FacebookAppUserAccess"
    WHERE "userFbAppId" = ${own.id} AND "assignedUserId" = ${targetUserId}
  `;
}

/**
 * Resolve the canonical app row for use in token exchange / API calls.
 * Returns the admin's UserFacebookApp row (with the secret) when the
 * given user has access to it — either as owner or via the pivot.
 */
export async function resolveAppForUserById(
  userId: string,
  fbAppId: string
): Promise<{
  appRowId: string;
  fbAppId: string;
  fbAppSecret: string;
  fbBmId: string | null;
  ownerUserId: string;
} | null> {
  // Own row first.
  const ownRows = await prisma.$queryRaw<Array<{
    id: string; fbAppId: string; fbAppSecret: string; fbBmId: string | null; userId: string;
  }>>`
    SELECT "id", "fbAppId", "fbAppSecret", "fbBmId", "userId"
    FROM "UserFacebookApp"
    WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId} AND "isActive" = TRUE
    LIMIT 1
  `;
  if (ownRows[0]) {
    return {
      appRowId: ownRows[0].id,
      fbAppId: ownRows[0].fbAppId,
      fbAppSecret: ownRows[0].fbAppSecret,
      fbBmId: ownRows[0].fbBmId,
      ownerUserId: ownRows[0].userId
    };
  }
  // Pivot.
  const pivotRows = await prisma.$queryRaw<Array<{
    id: string; fbAppId: string; fbAppSecret: string; fbBmId: string | null; userId: string;
  }>>`
    SELECT a."id", a."fbAppId", a."fbAppSecret", a."fbBmId", a."userId"
    FROM "FacebookAppUserAccess" p
    JOIN "UserFacebookApp" a ON a."id" = p."userFbAppId"
    WHERE p."assignedUserId" = ${userId}
      AND a."fbAppId" = ${fbAppId}
      AND a."isActive" = TRUE
    LIMIT 1
  `;
  if (pivotRows[0]) {
    return {
      appRowId: pivotRows[0].id,
      fbAppId: pivotRows[0].fbAppId,
      fbAppSecret: pivotRows[0].fbAppSecret,
      fbBmId: pivotRows[0].fbBmId,
      ownerUserId: pivotRows[0].userId
    };
  }
  return null;
}
