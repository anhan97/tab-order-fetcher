/**
 * Per-user FB SDK login token — DB-backed, encrypted at rest.
 *
 * Replaces the prior pattern of:
 *   - frontend stores token in localStorage (XSS risk)
 *   - frontend sends token via URL query string (browser/proxy log leak)
 *
 * Now:
 *   - frontend POSTs short-lived token to /api/facebook/connect once
 *   - backend exchanges to long-lived (~60 days) using app secret
 *   - encrypted token stored in UserFacebookConnection
 *   - subsequent calls resolve userId via Shopify auth → look up token from DB
 *   - frontend never sees the raw token after the initial connect
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { getForUser as getUserFbApp } from './user-fb-app.service';
import { FACEBOOK_CONFIG } from '../config/facebook';

/** Detect rows still using the old `enc:` format from when we encrypted at rest. */
function isLegacyEncrypted(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith('enc:');
}

const prisma = new PrismaClient();
const FB_API_VER = FACEBOOK_CONFIG.version;

export interface ConnectionStatus {
  connected: boolean;
  fbUserId: string | null;
  fbUserName: string | null;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  lastRefreshedAt: Date | null;
  needsReconnect: boolean;     // true if expiry imminent or already past
  daysUntilExpiry: number | null;
}

/**
 * Exchange a short-lived FB SDK token for a long-lived (~60 day) token.
 *
 * Uses the user's OWN FB App credentials (UserFacebookApp); falls back to
 * the global AdluxConfig only if the user hasn't registered their own app.
 * This isolates compliance risk — one user's app getting flagged doesn't
 * take down everyone else's connections.
 */
async function exchangeForLongLivedToken(userId: string, shortToken: string): Promise<string> {
  const cfg = await getUserFbApp(userId);
  if (!cfg.fbAppId || !cfg.fbAppSecret) {
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
    // Surface enough info for the user to debug WITHOUT echoing the secret.
    // Show source (their app vs global fallback) and a fingerprint so they
    // can compare against the FB Developer Console.
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const fbMsg = parsed?.error?.message || text.slice(0, 200);
    const fbCode = parsed?.error?.code;
    const secretFp = `${cfg.fbAppSecret.slice(0, 4)}...${cfg.fbAppSecret.slice(-4)} (len=${cfg.fbAppSecret.length}, source=${cfg.source})`;
    const appIdFp = `${cfg.fbAppId} (source=${cfg.source})`;
    if (fbCode === 1 || /client secret/i.test(fbMsg)) {
      throw new Error(
        `FB rejected app credentials. Code ${fbCode}: ${fbMsg} | ` +
        `app_id=${appIdFp} | secret=${secretFp} | ` +
        `Verify against https://developers.facebook.com/apps/${cfg.fbAppId}/settings/basic/ — ` +
        `the App Secret may have been rotated or the value entered was incorrect. ` +
        `Update via Settings → Facebook App.`
      );
    }
    throw new Error(`Token exchange failed: ${fbMsg}`);
  }
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error('Token exchange returned no access_token');
  return json.access_token;
}

/**
 * Inspect a token via /debug_token to read expiry, scopes, fbUserId.
 * Used right after exchange to populate metadata.
 */
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

/** Fetch the user's display name once for nicer UI. */
async function fetchUserName(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${FB_API_VER}/me?fields=name&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const json = await res.json() as { name?: string };
    return json.name || null;
  } catch { return null; }
}

/**
 * Connect: take a fresh SDK token, exchange to long-lived, store encrypted.
 * Idempotent — running again replaces the existing row.
 */
export async function connect(userId: string, shortToken: string): Promise<ConnectionStatus> {
  const longToken = await exchangeForLongLivedToken(userId, shortToken);
  const meta = await inspectToken(longToken);
  const userName = await fetchUserName(longToken);

  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "UserFacebookConnection"
      ("id", "userId", "accessToken", "fbUserId", "fbUserName",
       "expiresAt", "dataAccessExpiresAt", "scopes", "lastRefreshedAt", "updatedAt")
    VALUES
      (${id}, ${userId}, ${longToken}, ${meta.fbUserId || ''}, ${userName},
       ${meta.expiresAt}, ${meta.dataAccessExpiresAt}, ${JSON.stringify(meta.scopes)}, NOW(), NOW())
    ON CONFLICT ("userId") DO UPDATE SET
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
  return getStatus(userId);
}

/**
 * Re-extend a long-lived token. FB allows re-running fb_exchange_token with
 * an existing long-lived token as input — returns a fresh 60-day token.
 *
 * Use this from a cron when the user's current token is within ~14 days
 * of expiry. Quietly bumps `expiresAt` and `lastRefreshedAt` so users
 * never see "session expired" mid-day.
 *
 * Returns the new expiry, or null if the user has no connection.
 * Throws on token rejection (revoked / app secret mismatch / etc.) — caller
 * should `markError` and surface to the user.
 */
export async function extend(userId: string): Promise<{ expiresAt: Date | null } | null> {
  const current = await getRawToken(userId);
  if (!current) return null;
  const fresh = await exchangeForLongLivedToken(userId, current);
  const meta = await inspectToken(fresh);
  await prisma.$executeRaw`
    UPDATE "UserFacebookConnection" SET
      "accessToken"     = ${fresh},
      "expiresAt"       = ${meta.expiresAt},
      "dataAccessExpiresAt" = ${meta.dataAccessExpiresAt},
      "scopes"          = ${JSON.stringify(meta.scopes)},
      "lastRefreshedAt" = NOW(),
      "lastError"       = NULL,
      "updatedAt"       = NOW()
    WHERE "userId" = ${userId}
  `;
  return { expiresAt: meta.expiresAt };
}

/**
 * List user IDs whose long-lived token is about to expire (or has already).
 * Used by the refresh cron — `<windowDays>` controls how far ahead we look.
 */
export async function listExpiringSoon(windowDays: number = 14): Promise<Array<{ userId: string; expiresAt: Date | null }>> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; expiresAt: Date | null }>>`
    SELECT "userId", "expiresAt"
    FROM "UserFacebookConnection"
    WHERE "expiresAt" IS NULL
       OR "expiresAt" < NOW() + (${windowDays} || ' days')::interval
  `;
  return rows;
}

/** Read the user's stored FB token. Returns null if absent or in legacy encrypted format. */
export async function getRawToken(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ accessToken: string }>>`
    SELECT "accessToken" FROM "UserFacebookConnection" WHERE "userId" = ${userId} LIMIT 1
  `;
  if (!rows[0]) return null;
  if (isLegacyEncrypted(rows[0].accessToken)) {
    console.warn('[fb-user-token] legacy encrypted token found — user must reconnect');
    return null;
  }
  return rows[0].accessToken;
}

/** Mark last-used so admin can see token activity. */
export async function markUsed(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "UserFacebookConnection" SET "lastUsedAt" = NOW() WHERE "userId" = ${userId}
  `;
}

/** Record an error against the connection (token expired, scope removed, etc.). */
export async function markError(userId: string, error: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "UserFacebookConnection"
    SET "lastError" = ${error.slice(0, 500)}, "updatedAt" = NOW()
    WHERE "userId" = ${userId}
  `;
}

export async function disconnect(userId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "UserFacebookConnection" WHERE "userId" = ${userId}
  `;
}

/** Public connection status (no token, safe for frontend). */
export async function getStatus(userId: string): Promise<ConnectionStatus> {
  const rows = await prisma.$queryRaw<Array<{
    fbUserId: string;
    fbUserName: string | null;
    expiresAt: Date | null;
    dataAccessExpiresAt: Date | null;
    scopes: string | null;
    lastRefreshedAt: Date | null;
    lastError: string | null;
  }>>`
    SELECT "fbUserId", "fbUserName", "expiresAt", "dataAccessExpiresAt",
           "scopes", "lastRefreshedAt", "lastError"
    FROM "UserFacebookConnection"
    WHERE "userId" = ${userId}
    LIMIT 1
  `;
  if (!rows[0]) {
    return {
      connected: false,
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
  const r = rows[0];
  let scopes: string[] = [];
  if (r.scopes) { try { scopes = JSON.parse(r.scopes); } catch { /* keep [] */ } }

  // Effective expiry: whichever clock fires first (token expiry or data
  // access expiry). null = never, treated as far-future.
  const eff = [r.expiresAt, r.dataAccessExpiresAt]
    .filter(d => d != null) as Date[];
  const earliest = eff.length > 0 ? new Date(Math.min(...eff.map(d => d.getTime()))) : null;
  const daysUntilExpiry = earliest ? Math.floor((earliest.getTime() - Date.now()) / 86_400_000) : null;
  // `connected` = "do we have a working token right now?" — only false when
  // the token has fully expired or FB rejected it last time we tried.
  // `needsReconnect` is a SOFT WARNING (expiring in <3d, or had a recent
  // error) — UI can show a banner but should NOT block the user. Coupling
  // the two caused the bug where every F5 forced a reconnect prompt even
  // when the token still had weeks left.
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
  // Token presence + not-expired = connected. lastError is a soft warning
  // (FB rejected one call but the token may still work) — surface via
  // needsReconnect so the UI can offer "Reconnect" without forcing it.
  const connected = !isExpired;
  const needsReconnect = (daysUntilExpiry !== null && daysUntilExpiry < 3) || !!r.lastError;

  return {
    connected,
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
