/**
 * Per-user FB ad account access — raw SQL because the new tables aren't in
 * the generated Prisma client until the user restarts the backend and runs
 * `prisma generate`. Once that's done these can be refactored to typed
 * `prisma.facebookAdAccountAccess` calls; the schemas are identical.
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export interface AdAccountWithAccess {
  accountId: string;
  accountName: string;
  poolIndex: number;
  status: string;
  accountStatus: number | null;
  currency: string | null;
  timezone: string | null;
  role: string;
  isFavorite: boolean;
}

/**
 * Upsert a row in FacebookAdAccountAssignment after a successful BM sync.
 * Called by the BM management job for each discovered account.
 */
export async function upsertAssignment(input: {
  accountId: string;
  accountName: string;
  poolIndex: number;
  systemUserId: string;
  status?: string;
  accountStatus?: number | null;
  currency?: string | null;
  timezone?: string | null;
  lastError?: string | null;
}): Promise<void> {
  // Use raw SQL UPSERT (Postgres ON CONFLICT). Prisma typed equivalent is
  // .upsert() but new model isn't in client yet.
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "FacebookAdAccountAssignment"
      ("id", "accountId", "accountName", "poolIndex", "systemUserId", "status",
       "accountStatus", "currency", "timezone", "lastError", "lastSyncAt", "updatedAt")
    VALUES
      (${id}, ${input.accountId}, ${input.accountName}, ${input.poolIndex},
       ${input.systemUserId}, ${input.status || 'assigned'},
       ${input.accountStatus ?? null}, ${input.currency ?? null}, ${input.timezone ?? null},
       ${input.lastError ?? null}, NOW(), NOW())
    ON CONFLICT ("accountId") DO UPDATE SET
      "accountName"   = EXCLUDED."accountName",
      "poolIndex"     = EXCLUDED."poolIndex",
      "systemUserId"  = EXCLUDED."systemUserId",
      "status"        = EXCLUDED."status",
      "accountStatus" = EXCLUDED."accountStatus",
      "currency"      = EXCLUDED."currency",
      "timezone"      = EXCLUDED."timezone",
      "lastError"     = EXCLUDED."lastError",
      "lastSyncAt"    = NOW(),
      "updatedAt"     = NOW()
  `;
}

/**
 * List accounts the given user has access to. Joined view of access rows
 * + assignment metadata, sorted favorites-first then alphabetical.
 */
export async function listUserAccounts(userId: string): Promise<AdAccountWithAccess[]> {
  const rows = await prisma.$queryRaw<Array<{
    accountId: string;
    accountName: string;
    poolIndex: number;
    status: string;
    accountStatus: number | null;
    currency: string | null;
    timezone: string | null;
    role: string;
    isFavorite: boolean;
  }>>`
    SELECT a."accountId", a."accountName", a."poolIndex", a."status",
           a."accountStatus", a."currency", a."timezone",
           x."role", x."isFavorite"
    FROM "FacebookAdAccountAccess" x
    JOIN "FacebookAdAccountAssignment" a ON a."accountId" = x."accountId"
    WHERE x."userId" = ${userId}
    ORDER BY x."isFavorite" DESC, a."accountName" ASC
  `;
  return rows;
}

/**
 * Grant a user access to an ad account. No-op if already has access.
 * Called when user "claims" accounts during onboarding.
 */
export async function grantAccess(userId: string, accountId: string, role: string = 'viewer'): Promise<void> {
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "FacebookAdAccountAccess" ("id", "userId", "accountId", "role")
    VALUES (${id}, ${userId}, ${accountId}, ${role})
    ON CONFLICT ("userId", "accountId") DO NOTHING
  `;
}

export async function revokeAccess(userId: string, accountId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "FacebookAdAccountAccess"
    WHERE "userId" = ${userId} AND "accountId" = ${accountId}
  `;
}

export async function setFavorite(userId: string, accountId: string, isFavorite: boolean): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "FacebookAdAccountAccess"
    SET "isFavorite" = ${isFavorite}
    WHERE "userId" = ${userId} AND "accountId" = ${accountId}
  `;
}

/**
 * Check if a user is permitted to access the given account. Returns the
 * assignment metadata so callers can use the right pool token.
 */
export async function getUserAccess(userId: string, accountId: string): Promise<AdAccountWithAccess | null> {
  const rows = await prisma.$queryRaw<AdAccountWithAccess[]>`
    SELECT a."accountId", a."accountName", a."poolIndex", a."status",
           a."accountStatus", a."currency", a."timezone",
           x."role", x."isFavorite"
    FROM "FacebookAdAccountAccess" x
    JOIN "FacebookAdAccountAssignment" a ON a."accountId" = x."accountId"
    WHERE x."userId" = ${userId} AND x."accountId" = ${accountId}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Look up assignment by accountId (no user-specific role check).
 * Used by BM sync + admin endpoints.
 */
export async function getAssignment(accountId: string): Promise<{
  accountId: string;
  poolIndex: number;
  systemUserId: string;
  status: string;
} | null> {
  const rows = await prisma.$queryRaw<Array<{
    accountId: string;
    poolIndex: number;
    systemUserId: string;
    status: string;
  }>>`
    SELECT "accountId", "poolIndex", "systemUserId", "status"
    FROM "FacebookAdAccountAssignment"
    WHERE "accountId" = ${accountId}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * List all unclaimed accounts (in BM but no user has access). Useful for
 * admin UI to see what's pending.
 */
export async function listUnclaimedAccounts(): Promise<Array<{
  accountId: string;
  accountName: string;
  status: string;
  accountStatus: number | null;
}>> {
  return prisma.$queryRaw`
    SELECT a."accountId", a."accountName", a."status", a."accountStatus"
    FROM "FacebookAdAccountAssignment" a
    LEFT JOIN "FacebookAdAccountAccess" x ON x."accountId" = a."accountId"
    WHERE x."userId" IS NULL
    ORDER BY a."accountName"
  `;
}
