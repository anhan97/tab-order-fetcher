/**
 * Singleton Adlux config (BM id + FB app id/secret), DB-backed with env
 * fallback for backwards compat. Admin UI writes through here.
 *
 * Read pattern: aggressive in-memory cache (1 min TTL or until invalidate).
 * The values change rarely — admin sets them once at install. We keep an
 * env fallback so existing deployments that wrote FB_ADLUX_BM_ID etc. into
 * .env keep working without manual migration.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Detect rows still using the old `enc:` format from the encryption-at-rest experiment. */
function isLegacyEncrypted(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith('enc:');
}

export interface AdluxConfig {
  fbAppId: string | null;
  fbAppSecret: string | null;
  adluxBmId: string | null;
  source: { fbAppId: 'db' | 'env' | 'none'; fbAppSecret: 'db' | 'env' | 'none'; adluxBmId: 'db' | 'env' | 'none' };
}

let cache: AdluxConfig | null = null;
let cacheAt = 0;
const TTL_MS = 60_000;

interface ConfigRow {
  fbAppId: string | null;
  fbAppSecret: string | null;
  adluxBmId: string | null;
}

async function loadFromDb(): Promise<ConfigRow | null> {
  try {
    const rows = await prisma.$queryRaw<ConfigRow[]>`
      SELECT "fbAppId", "fbAppSecret", "adluxBmId"
      FROM "AdluxConfig"
      WHERE "id" = 'singleton'
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (err) {
    // Most likely cause: migration not yet run. Return null to fall through
    // to env, so the app keeps booting on a fresh DB.
    console.warn('[adlux-config] DB read failed, falling back to env:', (err as Error).message);
    return null;
  }
}

export async function getConfig(): Promise<AdluxConfig> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;

  const dbRow = await loadFromDb();

  const pickWithSource = (dbVal: string | null | undefined, envVal: string | undefined) => {
    if (dbVal && dbVal.trim()) return { value: dbVal.trim(), source: 'db' as const };
    if (envVal && envVal.trim()) return { value: envVal.trim(), source: 'env' as const };
    return { value: null, source: 'none' as const };
  };

  // Legacy `enc:`-prefixed secrets from the encrypted-at-rest experiment
  // are unrecoverable (ephemeral key lost). Treat as missing so we fall
  // back to env until admin re-enters via the UI.
  const dbSecret = dbRow?.fbAppSecret;
  const usableDbSecret = isLegacyEncrypted(dbSecret) ? null : dbSecret;

  const appId = pickWithSource(dbRow?.fbAppId, process.env.FACEBOOK_APP_ID);
  const appSecret = pickWithSource(usableDbSecret, process.env.FACEBOOK_APP_SECRET);
  const bmId = pickWithSource(dbRow?.adluxBmId, process.env.FB_ADLUX_BM_ID);

  cache = {
    fbAppId: appId.value,
    fbAppSecret: appSecret.value,
    adluxBmId: bmId.value,
    source: { fbAppId: appId.source, fbAppSecret: appSecret.source, adluxBmId: bmId.source }
  };
  cacheAt = Date.now();
  return cache;
}

/** Sync getter — returns cached value or null. Use in synchronous code paths. */
export function getConfigSync(): AdluxConfig | null {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  return null;
}

export function invalidateCache(): void {
  cache = null;
  cacheAt = 0;
}

export async function setConfig(updates: Partial<{ fbAppId: string; fbAppSecret: string; adluxBmId: string }>): Promise<AdluxConfig> {
  await prisma.$executeRaw`
    INSERT INTO "AdluxConfig" ("id", "fbAppId", "fbAppSecret", "adluxBmId", "updatedAt")
    VALUES ('singleton', ${updates.fbAppId ?? null}, ${updates.fbAppSecret ?? null}, ${updates.adluxBmId ?? null}, NOW())
    ON CONFLICT ("id") DO UPDATE SET
      "fbAppId"     = COALESCE(${updates.fbAppId ?? null}, "AdluxConfig"."fbAppId"),
      "fbAppSecret" = COALESCE(${updates.fbAppSecret ?? null}, "AdluxConfig"."fbAppSecret"),
      "adluxBmId"   = COALESCE(${updates.adluxBmId ?? null}, "AdluxConfig"."adluxBmId"),
      "updatedAt"   = NOW()
  `;
  invalidateCache();
  return getConfig();
}

/**
 * Mask the secret when returning to the frontend — never expose the raw
 * value. Show a fingerprint so the admin can verify it changed.
 */
export function maskSecret(s: string | null): string | null {
  if (!s) return null;
  if (s.length < 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}
