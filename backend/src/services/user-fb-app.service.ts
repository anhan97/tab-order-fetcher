/**
 * Per-user, per-app FB credentials service.
 *
 * One user can register MANY FB Apps (one per FB nick they manage). Each
 * app has its own FB connection with a 60-day long-lived token. Resolution
 * is by `(userId, fbAppId)`; the `default` app for a user is the one
 * picked first when the caller doesn't specify which app to use.
 *
 * Why per-user-per-app: a single FB account is limited in how many ad
 * accounts it can own, and one compliance flag on a shared app would
 * take down every merchant. Letting users bring their OWN N apps
 * isolates risk + scales horizontally.
 *
 * Raw SQL because the dev server holds the Prisma DLL lock — the
 * regenerated client with the new schema isn't loaded until restart.
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

interface CacheEntry {
  config: ResolvedFbApp;
  cachedAt: number;
}
const cache = new Map<string, CacheEntry>(); // key = `${userId}:${fbAppId}`
const CACHE_TTL_MS = 60_000;

export interface UserFbAppRow {
  id: string;
  userId: string;
  fbAppId: string;
  fbAppSecret: string;
  fbBmId: string | null;
  appName: string | null;
  isActive: boolean;
  isDefault: boolean;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedFbApp {
  id: string;
  fbAppId: string;
  fbAppSecret: string;
  fbBmId: string | null;
  appName: string | null;
  isDefault: boolean;
}

export interface SafeFbApp {
  id: string;
  fbAppId: string;
  fbBmId: string | null;
  appName: string | null;
  isActive: boolean;
  isDefault: boolean;
  secretFingerprint: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function cacheKey(userId: string, fbAppId: string): string {
  return `${userId}:${fbAppId}`;
}

function fingerprint(secret: string): string {
  return secret.length >= 8
    ? `${secret.slice(0, 4)}••••${secret.slice(-4)} (len=${secret.length})`
    : '••••';
}

function safeView(r: UserFbAppRow): SafeFbApp {
  return {
    id: r.id,
    fbAppId: r.fbAppId,
    fbBmId: r.fbBmId,
    appName: r.appName,
    isActive: r.isActive,
    isDefault: r.isDefault,
    secretFingerprint: fingerprint(r.fbAppSecret),
    lastError: r.lastError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

/** List every FB app this user has registered. UI dropdown source. */
export async function listForUser(userId: string): Promise<SafeFbApp[]> {
  const rows = await prisma.$queryRaw<UserFbAppRow[]>`
    SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
           "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
    FROM "UserFacebookApp"
    WHERE "userId" = ${userId}
    ORDER BY "isDefault" DESC, "createdAt" ASC
  `;
  return rows.map(safeView);
}

/**
 * Resolve a specific FB app for the user. If `fbAppId` is null, resolve
 * the user's default app (or first by createdAt).
 *
 * Resolution order:
 *   1. user's own UserFacebookApp row (admins / legacy installs)
 *   2. an app the user has been granted access to via FacebookAppUserAccess
 *      (non-admin users — admin assigns one of their own apps to user X,
 *       and X's FB Login resolves through the admin's credentials)
 *
 * Returns null if neither side has a row.
 */
export async function resolveForUser(userId: string, fbAppId?: string | null): Promise<ResolvedFbApp | null> {
  const k = cacheKey(userId, fbAppId || 'default');
  const cached = cache.get(k);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.config;

  let row: UserFbAppRow | undefined;
  if (fbAppId) {
    row = (await prisma.$queryRaw<UserFbAppRow[]>`
      SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
             "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
      FROM "UserFacebookApp"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId} AND "isActive" = TRUE
      LIMIT 1
    `)[0];
  } else {
    row = (await prisma.$queryRaw<UserFbAppRow[]>`
      SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
             "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
      FROM "UserFacebookApp"
      WHERE "userId" = ${userId} AND "isActive" = TRUE
      ORDER BY "isDefault" DESC, "createdAt" ASC
      LIMIT 1
    `)[0];
  }

  // Pivot fallback: user doesn't own a row → see if admin has assigned an
  // app to them. We mirror the admin's row into the ResolvedFbApp shape so
  // every downstream consumer (token exchange, debug-token lookup, etc.)
  // sees the same fields regardless of how the resolution happened.
  if (!row) {
    if (fbAppId) {
      row = (await prisma.$queryRaw<UserFbAppRow[]>`
        SELECT a."id", a."userId", a."fbAppId", a."fbAppSecret", a."fbBmId",
               a."appName", a."isActive",
               FALSE AS "isDefault",            -- assigned apps are never the user's "default"
               a."lastError", a."createdAt", a."updatedAt"
        FROM "FacebookAppUserAccess" p
        JOIN "UserFacebookApp" a ON a."id" = p."userFbAppId"
        WHERE p."assignedUserId" = ${userId}
          AND a."fbAppId" = ${fbAppId}
          AND a."isActive" = TRUE
        LIMIT 1
      `)[0];
    } else {
      row = (await prisma.$queryRaw<UserFbAppRow[]>`
        SELECT a."id", a."userId", a."fbAppId", a."fbAppSecret", a."fbBmId",
               a."appName", a."isActive",
               FALSE AS "isDefault",
               a."lastError", a."createdAt", a."updatedAt"
        FROM "FacebookAppUserAccess" p
        JOIN "UserFacebookApp" a ON a."id" = p."userFbAppId"
        WHERE p."assignedUserId" = ${userId}
          AND a."isActive" = TRUE
        ORDER BY p."createdAt" ASC
        LIMIT 1
      `)[0];
    }
  }
  if (!row) return null;

  const out: ResolvedFbApp = {
    id: row.id,
    fbAppId: row.fbAppId,
    fbAppSecret: row.fbAppSecret,
    fbBmId: row.fbBmId,
    appName: row.appName,
    isDefault: row.isDefault
  };
  cache.set(k, { config: out, cachedAt: Date.now() });
  return out;
}

/** Lookup by row PK (used when caller has the app id in hand). */
export async function getById(userId: string, appRowId: string): Promise<SafeFbApp | null> {
  const r = (await prisma.$queryRaw<UserFbAppRow[]>`
    SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
           "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
    FROM "UserFacebookApp"
    WHERE "userId" = ${userId} AND "id" = ${appRowId}
    LIMIT 1
  `)[0];
  return r ? safeView(r) : null;
}

/**
 * Create or update the (userId, fbAppId) row. fbAppId is the natural key
 * here — pass it on insert. On update, partial patches preserve existing
 * fields.
 */
export async function upsert(userId: string, input: {
  fbAppId: string;
  fbAppSecret?: string;
  fbBmId?: string | null;
  appName?: string | null;
  makeDefault?: boolean;
}): Promise<SafeFbApp> {
  const fbAppId = input.fbAppId.trim();
  if (!fbAppId) throw new Error('fbAppId is required');

  const existing = (await prisma.$queryRaw<UserFbAppRow[]>`
    SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
           "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
    FROM "UserFacebookApp"
    WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    LIMIT 1
  `)[0];

  const fbAppSecret = input.fbAppSecret ?? existing?.fbAppSecret;
  const fbBmId = input.fbBmId !== undefined ? input.fbBmId : existing?.fbBmId ?? null;
  const appName = input.appName !== undefined ? input.appName : existing?.appName ?? null;

  if (!fbAppSecret) {
    throw new Error('fbAppSecret is required when creating a new FB app');
  }

  if (existing) {
    await prisma.$executeRaw`
      UPDATE "UserFacebookApp"
      SET "fbAppSecret" = ${fbAppSecret},
          "fbBmId"      = ${fbBmId},
          "appName"     = ${appName},
          "isActive"    = TRUE,
          "lastError"   = NULL,
          "updatedAt"   = NOW()
      WHERE "id" = ${existing.id}
    `;
  } else {
    const id = crypto.randomUUID();
    // First app for the user → make it default automatically.
    const userHasOther = (await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "UserFacebookApp" WHERE "userId" = ${userId}
    `)[0].count > 0n;
    const isDefault = !userHasOther;
    await prisma.$executeRaw`
      INSERT INTO "UserFacebookApp"
        ("id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
         "isActive", "isDefault", "createdAt", "updatedAt")
      VALUES
        (${id}, ${userId}, ${fbAppId}, ${fbAppSecret}, ${fbBmId}, ${appName},
         TRUE, ${isDefault}, NOW(), NOW())
    `;
  }

  if (input.makeDefault) {
    await setDefault(userId, fbAppId);
  }

  invalidateCache(userId);
  const fresh = (await prisma.$queryRaw<UserFbAppRow[]>`
    SELECT "id", "userId", "fbAppId", "fbAppSecret", "fbBmId", "appName",
           "isActive", "isDefault", "lastError", "createdAt", "updatedAt"
    FROM "UserFacebookApp"
    WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    LIMIT 1
  `)[0];
  return safeView(fresh);
}

/** Pick which app the user wants to act as their primary. Idempotent. */
export async function setDefault(userId: string, fbAppId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE "UserFacebookApp"
      SET "isDefault" = FALSE, "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "isDefault" = TRUE
    `;
    await tx.$executeRaw`
      UPDATE "UserFacebookApp"
      SET "isDefault" = TRUE, "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
  });
  invalidateCache(userId);
}

/** Delete a single app (cascades the matching FB connection via FK-by-value). */
export async function deleteApp(userId: string, fbAppId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    // Remove the connection first — there's no DB cascade since fbAppId is
    // a value FK across two tables, not a real FK relation.
    await tx.$executeRaw`
      DELETE FROM "UserFacebookConnection"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
    await tx.$executeRaw`
      DELETE FROM "UserFacebookApp"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
    // If we just deleted the default, promote the oldest surviving app.
    const remaining = (await tx.$queryRaw<UserFbAppRow[]>`
      SELECT "id", "fbAppId", "isDefault"
      FROM "UserFacebookApp"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" ASC
    ` as Array<Pick<UserFbAppRow, 'id' | 'fbAppId' | 'isDefault'>>);
    if (remaining.length > 0 && !remaining.some(r => r.isDefault)) {
      await tx.$executeRaw`
        UPDATE "UserFacebookApp"
        SET "isDefault" = TRUE, "updatedAt" = NOW()
        WHERE "id" = ${remaining[0].id}
      `;
    }
  });
  invalidateCache(userId);
}

export async function markError(userId: string, fbAppIdOrError: string, maybeError?: string): Promise<void> {
  // Two signatures:
  //   markError(userId, fbAppId, error)  — new, scopes the error to one app.
  //   markError(userId, error)           — legacy, marks the user's default app.
  //
  // The legacy shape is detected by the absence of `maybeError`. Typical
  // legacy callers pass long error strings, never bare FB App IDs, so
  // there's no realistic ambiguity.
  let fbAppId: string;
  let error: string;
  if (maybeError === undefined) {
    error = fbAppIdOrError;
    const def = await resolveForUser(userId, null);
    if (!def) return; // No app to mark.
    fbAppId = def.fbAppId;
  } else {
    fbAppId = fbAppIdOrError;
    error = maybeError;
  }
  await prisma.$executeRaw`
    UPDATE "UserFacebookApp"
    SET "lastError" = ${error.slice(0, 500)}, "updatedAt" = NOW()
    WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
  `;
  invalidateCache(userId);
}

export function invalidateCache(userId?: string): void {
  if (!userId) { cache.clear(); return; }
  for (const k of cache.keys()) {
    if (k.startsWith(`${userId}:`)) cache.delete(k);
  }
}

// ─── Compat shims (legacy single-app callers) ─────────────────────────────
//
// Older callers used `getForUser(userId)` returning {fbAppId, fbAppSecret,
// fbBmId, source}. Map them to the user's default app so existing code
// keeps working until callers are updated to pass an explicit fbAppId.

export interface LegacyResolvedFbApp {
  fbAppId: string | null;
  fbAppSecret: string | null;
  fbBmId: string | null;
  source: 'user' | 'none';
}

export async function getForUser(userId: string): Promise<LegacyResolvedFbApp> {
  const r = await resolveForUser(userId, null);
  if (!r) {
    return { fbAppId: null, fbAppSecret: null, fbBmId: null, source: 'none' };
  }
  return {
    fbAppId: r.fbAppId,
    fbAppSecret: r.fbAppSecret,
    fbBmId: r.fbBmId,
    source: 'user'
  };
}

/**
 * Legacy single-row "effective app" view.
 *
 * Returns the user's default app — first by checking their own
 * UserFacebookApp rows (admins / legacy installs), then falling back to
 * `resolveForUser` which consults the FacebookAppUserAccess pivot. This
 * lets non-admin users see the App ID the admin has assigned them so
 * Facebook SDK init + /facebook UI render the right info.
 */
export async function getOwnAppSafe(userId: string): Promise<{
  hasOwnApp: boolean;
  fbAppId: string | null;
  fbBmId: string | null;
  appName: string | null;
  secretFingerprint: string | null;
  isActive: boolean;
  lastError: string | null;
}> {
  const apps = await listForUser(userId);
  const def = apps.find(a => a.isDefault) || apps[0];
  if (def) {
    return {
      hasOwnApp: true,
      fbAppId: def.fbAppId,
      fbBmId: def.fbBmId,
      appName: def.appName,
      secretFingerprint: def.secretFingerprint,
      isActive: def.isActive,
      lastError: def.lastError
    };
  }
  // Pivot fallback — user has no row of their own; surface whichever app
  // the admin has assigned them so the SDK + UI can still render.
  const resolved = await resolveForUser(userId, null);
  if (!resolved) {
    return {
      hasOwnApp: false, fbAppId: null, fbBmId: null, appName: null,
      secretFingerprint: null, isActive: false, lastError: null
    };
  }
  return {
    hasOwnApp: true,
    fbAppId: resolved.fbAppId,
    fbBmId: resolved.fbBmId,
    appName: resolved.appName,
    secretFingerprint: fingerprint(resolved.fbAppSecret),
    isActive: true,
    lastError: null
  };
}

/**
 * Legacy upsert from the singleton `MyFacebookAppCard` UI.
 *
 * That card pretends "1 user = 1 FB App", so any fbAppId it sends is THE
 * app the user wants to use. We honour that by always promoting the
 * incoming row to default — without this step, typing a new App ID in
 * the form just inserted a non-default row and `getOwnAppSafe` kept
 * returning the OLD default ("admin thêm app nhưng không được, cứ bị
 * reset" was the symptom).
 *
 * The multi-app `/my-apps` endpoints don't go through here.
 */
export async function upsertForUser(userId: string, input: {
  fbAppId?: string;
  fbAppSecret?: string;
  fbBmId?: string | null;
  appName?: string | null;
}): Promise<void> {
  if (!input.fbAppId) {
    // Old UI treated the row as singleton — fall back to the existing default
    // when caller didn't specify which app to update.
    const existing = await resolveForUser(userId, null);
    if (!existing) throw new Error('fbAppId is required when registering a new FB app');
    await upsert(userId, {
      fbAppId: existing.fbAppId,
      fbAppSecret: input.fbAppSecret,
      fbBmId: input.fbBmId,
      appName: input.appName,
      makeDefault: true
    });
    return;
  }
  await upsert(userId, {
    fbAppId: input.fbAppId,
    fbAppSecret: input.fbAppSecret,
    fbBmId: input.fbBmId,
    appName: input.appName,
    makeDefault: true       // singleton UI → make this THE default app
  });
}

/** Legacy delete — drops the user's default app. */
export async function deleteForUser(userId: string): Promise<void> {
  const def = await resolveForUser(userId, null);
  if (def) await deleteApp(userId, def.fbAppId);
}
