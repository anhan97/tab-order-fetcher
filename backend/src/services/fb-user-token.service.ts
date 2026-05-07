/**
 * Per-user, per-app FB SDK login token. DB-backed (encrypted at rest is
 * not currently applied; we store the long-lived token plaintext, server-
 * only access). One row per (userId, fbAppId).
 *
 * Migration: prior shape was 1 row per user. We now scope by fbAppId so
 * one logged-in user can connect multiple FB nicks (one per app they
 * registered). Legacy callers that don't know about fbAppId resolve to
 * the user's default app (UserFacebookApp.isDefault = TRUE).
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { resolveForUser as resolveUserApp } from './user-fb-app.service';
import { FACEBOOK_CONFIG } from '../config/facebook';

const prisma = new PrismaClient();
const FB_API_VER = FACEBOOK_CONFIG.version;

/** Detect rows still using the old `enc:` format from when we encrypted at rest. */
function isLegacyEncrypted(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith('enc:');
}

export interface ConnectionStatus {
  connected: boolean;
  fbAppId: string | null;
  fbUserId: string | null;
  fbUserName: string | null;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  lastRefreshedAt: Date | null;
  needsReconnect: boolean;
  daysUntilExpiry: number | null;
}

interface RawConnectionRow {
  id: string;
  userId: string;
  fbAppId: string;
  fbUserId: string;
  fbUserName: string | null;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string | null;
  lastRefreshedAt: Date | null;
  lastError: string | null;
}

/**
 * Exchange short-lived → long-lived (~60d) using a specific app's secret.
 * Throws with a rich error if the secret is wrong (FB code 1).
 */
async function exchangeForLongLivedToken(userId: string, fbAppId: string | null, shortToken: string): Promise<{ token: string; appId: string }> {
  const cfg = await resolveUserApp(userId, fbAppId);
  if (!cfg) {
    throw new Error(
      'No FB app credentials configured for this user. Open Settings → Facebook App and add your App ID + Secret.'
    );
  }
  const url = `https://graph.facebook.com/${FB_API_VER}/oauth/access_token?` +
    `grant_type=fb_exchange_token&client_id=${encodeURIComponent(cfg.fbAppId)}` +
    `&client_secret=${encodeURIComponent(cfg.fbAppSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const fbMsg = parsed?.error?.message || text.slice(0, 200);
    const fbCode = parsed?.error?.code;
    if (fbCode === 1 || /client secret/i.test(fbMsg)) {
      throw new Error(
        `FB rejected app credentials. Code ${fbCode}: ${fbMsg} | ` +
        `app_id=${cfg.fbAppId} | secret_len=${cfg.fbAppSecret.length} | ` +
        `Verify against https://developers.facebook.com/apps/${cfg.fbAppId}/settings/basic/ — ` +
        `the App Secret may have been rotated. Update via Settings → Facebook App.`
      );
    }
    throw new Error(`Token exchange failed: ${fbMsg}`);
  }
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error('Token exchange returned no access_token');
  return { token: json.access_token, appId: cfg.fbAppId };
}

async function inspectToken(token: string): Promise<{
  fbUserId: string | null;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
}> {
  const url = `https://graph.facebook.com/${FB_API_VER}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return { fbUserId: null, expiresAt: null, dataAccessExpiresAt: null, scopes: [] };
  const json = await res.json() as { data?: any };
  const d = json.data || {};
  return {
    fbUserId: d.user_id || null,
    expiresAt: d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null,
    dataAccessExpiresAt: d.data_access_expires_at && d.data_access_expires_at > 0 ? new Date(d.data_access_expires_at * 1000) : null,
    scopes: d.scopes || []
  };
}

async function fetchUserName(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${FB_API_VER}/me?fields=name&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const json = await res.json() as { name?: string };
    return json.name || null;
  } catch { return null; }
}

/**
 * Connect: take a fresh SDK token for a specific FB app, exchange to
 * long-lived, store. Idempotent on (userId, fbAppId). If `fbAppId` is
 * omitted, resolves to the user's default app.
 */
export async function connect(userId: string, shortToken: string, fbAppId?: string | null): Promise<ConnectionStatus> {
  const exchanged = await exchangeForLongLivedToken(userId, fbAppId ?? null, shortToken);
  const meta = await inspectToken(exchanged.token);
  const userName = await fetchUserName(exchanged.token);

  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "UserFacebookConnection"
      ("id", "userId", "fbAppId", "accessToken", "fbUserId", "fbUserName",
       "expiresAt", "dataAccessExpiresAt", "scopes", "lastRefreshedAt", "updatedAt")
    VALUES
      (${id}, ${userId}, ${exchanged.appId}, ${exchanged.token},
       ${meta.fbUserId || ''}, ${userName},
       ${meta.expiresAt}, ${meta.dataAccessExpiresAt}, ${JSON.stringify(meta.scopes)}, NOW(), NOW())
    ON CONFLICT ("userId", "fbAppId") DO UPDATE SET
      "accessToken"         = EXCLUDED."accessToken",
      "fbUserId"            = EXCLUDED."fbUserId",
      "fbUserName"          = EXCLUDED."fbUserName",
      "expiresAt"           = EXCLUDED."expiresAt",
      "dataAccessExpiresAt" = EXCLUDED."dataAccessExpiresAt",
      "scopes"              = EXCLUDED."scopes",
      "lastRefreshedAt"     = NOW(),
      "lastError"           = NULL,
      "updatedAt"           = NOW()
  `;
  return getStatus(userId, exchanged.appId);
}

/**
 * Re-extend a long-lived token by re-running fb_exchange_token with the
 * existing token as input. Returns a fresh ~60d token. Caller scopes by
 * (userId, fbAppId); when the cron walks expiring rows it iterates by
 * connection id, so we accept that shape too.
 */
export async function extend(userId: string, fbAppId?: string | null): Promise<{ expiresAt: Date | null; fbAppId: string } | null> {
  const current = await getRawTokenForApp(userId, fbAppId ?? null);
  if (!current) return null;
  const exchanged = await exchangeForLongLivedToken(userId, current.fbAppId, current.token);
  const meta = await inspectToken(exchanged.token);
  await prisma.$executeRaw`
    UPDATE "UserFacebookConnection" SET
      "accessToken"     = ${exchanged.token},
      "expiresAt"       = ${meta.expiresAt},
      "dataAccessExpiresAt" = ${meta.dataAccessExpiresAt},
      "scopes"          = ${JSON.stringify(meta.scopes)},
      "lastRefreshedAt" = NOW(),
      "lastError"       = NULL,
      "updatedAt"       = NOW()
    WHERE "userId" = ${userId} AND "fbAppId" = ${exchanged.appId}
  `;
  return { expiresAt: meta.expiresAt, fbAppId: exchanged.appId };
}

/** Cron sweep helper: rows whose token expires within `windowDays`. */
export async function listExpiringSoon(windowDays: number = 14): Promise<Array<{ userId: string; fbAppId: string; expiresAt: Date | null }>> {
  return prisma.$queryRaw<Array<{ userId: string; fbAppId: string; expiresAt: Date | null }>>`
    SELECT "userId", "fbAppId", "expiresAt"
    FROM "UserFacebookConnection"
    WHERE "expiresAt" IS NULL
       OR "expiresAt" < NOW() + (${windowDays} || ' days')::interval
  `;
}

/**
 * Read the user's stored FB token for a specific app. Returns null if
 * absent or in legacy encrypted format. If `fbAppId` is null, picks the
 * user's default app.
 */
export async function getRawTokenForApp(userId: string, fbAppId: string | null): Promise<{ token: string; fbAppId: string } | null> {
  let row: { accessToken: string; fbAppId: string } | undefined;
  if (fbAppId) {
    row = (await prisma.$queryRaw<Array<{ accessToken: string; fbAppId: string }>>`
      SELECT "accessToken", "fbAppId" FROM "UserFacebookConnection"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
      LIMIT 1
    `)[0];
  } else {
    // Default app's connection (joined to UserFacebookApp.isDefault).
    row = (await prisma.$queryRaw<Array<{ accessToken: string; fbAppId: string }>>`
      SELECT c."accessToken", c."fbAppId"
      FROM "UserFacebookConnection" c
      JOIN "UserFacebookApp" a ON a."userId" = c."userId" AND a."fbAppId" = c."fbAppId"
      WHERE c."userId" = ${userId}
      ORDER BY a."isDefault" DESC, c."lastRefreshedAt" DESC NULLS LAST, c."createdAt" DESC
      LIMIT 1
    `)[0];
  }
  if (!row) return null;
  if (isLegacyEncrypted(row.accessToken)) {
    console.warn('[fb-user-token] legacy encrypted token found — user must reconnect');
    return null;
  }
  return { token: row.accessToken, fbAppId: row.fbAppId };
}

/** Legacy single-token getter — returns just the token string or null. */
export async function getRawToken(userId: string, fbAppId?: string | null): Promise<string | null> {
  const r = await getRawTokenForApp(userId, fbAppId ?? null);
  return r ? r.token : null;
}

/** List every connection the user has (for the multi-app UI). */
export async function listConnections(userId: string): Promise<ConnectionStatus[]> {
  const rows = await prisma.$queryRaw<RawConnectionRow[]>`
    SELECT "id", "userId", "fbAppId", "fbUserId", "fbUserName",
           "expiresAt", "dataAccessExpiresAt", "scopes",
           "lastRefreshedAt", "lastError"
    FROM "UserFacebookConnection"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" ASC
  `;
  return rows.map(r => buildStatus(r));
}

export async function markUsed(userId: string, fbAppId?: string | null): Promise<void> {
  if (fbAppId) {
    await prisma.$executeRaw`
      UPDATE "UserFacebookConnection" SET "lastUsedAt" = NOW()
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
  } else {
    // Touch every row — cheap, and avoids re-resolving the default app.
    await prisma.$executeRaw`
      UPDATE "UserFacebookConnection" SET "lastUsedAt" = NOW()
      WHERE "userId" = ${userId}
    `;
  }
}

export async function markError(userId: string, fbAppIdOrError: string, maybeError?: string): Promise<void> {
  // Two signatures (mirrors user-fb-app.service.markError):
  //   markError(userId, fbAppId, error)
  //   markError(userId, error)              — legacy, marks every row.
  let error: string;
  let fbAppId: string | null = null;
  if (maybeError === undefined) {
    error = fbAppIdOrError;
  } else {
    fbAppId = fbAppIdOrError;
    error = maybeError;
  }
  if (fbAppId) {
    await prisma.$executeRaw`
      UPDATE "UserFacebookConnection"
      SET "lastError" = ${error.slice(0, 500)}, "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE "UserFacebookConnection"
      SET "lastError" = ${error.slice(0, 500)}, "updatedAt" = NOW()
      WHERE "userId" = ${userId}
    `;
  }
}

/**
 * Disconnect:
 *   - With fbAppId  → drop only that connection.
 *   - Without       → drop ALL the user's connections (legacy "sign out of FB").
 */
export async function disconnect(userId: string, fbAppId?: string | null): Promise<void> {
  if (fbAppId) {
    await prisma.$executeRaw`
      DELETE FROM "UserFacebookConnection"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
    `;
  } else {
    await prisma.$executeRaw`
      DELETE FROM "UserFacebookConnection" WHERE "userId" = ${userId}
    `;
  }
}

function buildStatus(r: RawConnectionRow): ConnectionStatus {
  let scopes: string[] = [];
  if (r.scopes) { try { scopes = JSON.parse(r.scopes); } catch { /* keep [] */ } }
  const eff = [r.expiresAt, r.dataAccessExpiresAt].filter(d => d != null) as Date[];
  const earliest = eff.length > 0 ? new Date(Math.min(...eff.map(d => d.getTime()))) : null;
  const daysUntilExpiry = earliest ? Math.floor((earliest.getTime() - Date.now()) / 86_400_000) : null;
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
  const connected = !isExpired;
  const needsReconnect = (daysUntilExpiry !== null && daysUntilExpiry < 3) || !!r.lastError;
  return {
    connected,
    fbAppId: r.fbAppId,
    fbUserId: r.fbUserId,
    fbUserName: r.fbUserName,
    expiresAt: r.expiresAt,
    dataAccessExpiresAt: r.dataAccessExpiresAt,
    scopes,
    lastRefreshedAt: r.lastRefreshedAt,
    needsReconnect,
    daysUntilExpiry
  };
}

/**
 * Status for one connection. If `fbAppId` is null, returns the default
 * app's status (so legacy callers keep working). Returns the "not
 * connected" sentinel when the user has no rows.
 */
export async function getStatus(userId: string, fbAppId?: string | null): Promise<ConnectionStatus> {
  let row: RawConnectionRow | undefined;
  if (fbAppId) {
    row = (await prisma.$queryRaw<RawConnectionRow[]>`
      SELECT "id", "userId", "fbAppId", "fbUserId", "fbUserName",
             "expiresAt", "dataAccessExpiresAt", "scopes",
             "lastRefreshedAt", "lastError"
      FROM "UserFacebookConnection"
      WHERE "userId" = ${userId} AND "fbAppId" = ${fbAppId}
      LIMIT 1
    `)[0];
  } else {
    row = (await prisma.$queryRaw<RawConnectionRow[]>`
      SELECT c."id", c."userId", c."fbAppId", c."fbUserId", c."fbUserName",
             c."expiresAt", c."dataAccessExpiresAt", c."scopes",
             c."lastRefreshedAt", c."lastError"
      FROM "UserFacebookConnection" c
      JOIN "UserFacebookApp" a ON a."userId" = c."userId" AND a."fbAppId" = c."fbAppId"
      WHERE c."userId" = ${userId}
      ORDER BY a."isDefault" DESC, c."lastRefreshedAt" DESC NULLS LAST, c."createdAt" DESC
      LIMIT 1
    `)[0];
  }
  if (!row) {
    return {
      connected: false,
      fbAppId: null,
      fbUserId: null,
      fbUserName: null,
      expiresAt: null,
      dataAccessExpiresAt: null,
      scopes: [],
      lastRefreshedAt: null,
      needsReconnect: false,
      daysUntilExpiry: null
    };
  }
  return buildStatus(row);
}
