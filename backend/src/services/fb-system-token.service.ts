/**
 * System User token pool — DB-backed.
 *
 * Tokens live in AdluxSystemToken table. Pool is loaded into memory at boot
 * and refreshed on demand (admin UI calls reload() after add/edit/delete).
 *
 * Why a pool not a single token:
 *   FB's app-level rate limit = 200 calls × users_active_in_last_hour.
 *   With 1 system-user token, FB sees ONE user → app budget = 200/hr — too
 *   tight for multi-tenant. With N system users, FB sees N users → budget
 *   = 200N/hr. We hash each ad account to a fixed pool slot so the same
 *   account always uses the same token (sticky assignment in BM, predictable
 *   quota usage).
 *
 * Falls back to env (FB_SYSTEM_TOKEN_1..N) if DB has no rows — so existing
 * deploys that set env vars still work during migration.
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Detect rows still using the old `enc:` format from when we encrypted at rest. */
function isLegacyEncrypted(v: string): boolean {
  return typeof v === 'string' && v.startsWith('enc:');
}

interface PoolMember {
  index: number;
  token: string;
  systemUserId?: string;
  dbId?: string;     // present when loaded from DB; absent when from env
  name?: string;
  isActive?: boolean;
}

let pool: PoolMember[] = [];
let lastLoad = 0;

function loadFromEnv(): PoolMember[] {
  const out: PoolMember[] = [];
  for (let i = 1; i <= 50; i++) {
    const tok = process.env[`FB_SYSTEM_TOKEN_${i}`];
    if (tok && tok.trim().length > 0) {
      out.push({ index: i, token: tok.trim(), name: `env-${i}`, isActive: true });
    }
  }
  return out;
}

async function loadFromDb(): Promise<PoolMember[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      poolIndex: number;
      name: string;
      token: string;
      systemUserId: string | null;
      isActive: boolean;
    }>>`
      SELECT "id", "poolIndex", "name", "token", "systemUserId", "isActive"
      FROM "AdluxSystemToken"
      WHERE "isActive" = true
      ORDER BY "poolIndex" ASC
    `;
    const out: PoolMember[] = [];
    for (const r of rows) {
      // Tokens are plaintext. Any row still in the legacy `enc:` format
      // (from the brief encryption-at-rest period) is unrecoverable — the
      // ephemeral key it was encrypted with is long gone. Skip + flag so
      // the admin sees it in the UI and can re-add.
      if (isLegacyEncrypted(r.token)) {
        console.error(`[fb-pool] token #${r.poolIndex} (${r.name}) is in legacy encrypted format — skipping`);
        try {
          await prisma.$executeRaw`
            UPDATE "AdluxSystemToken"
            SET "lastError" = 'Legacy encrypted token (unrecoverable). Re-add via Adlux Settings.',
                "updatedAt" = NOW()
            WHERE "id" = ${r.id}
          `;
        } catch { /* ignore */ }
        continue;
      }
      out.push({
        index: r.poolIndex,
        token: r.token,
        systemUserId: r.systemUserId || undefined,
        dbId: r.id,
        name: r.name,
        isActive: r.isActive
      });
    }
    return out;
  } catch (err) {
    console.warn('[fb-pool] DB read failed:', (err as Error).message);
    return [];
  }
}

// Encryption was removed — tokens stored plaintext. DB access (DATABASE_URL)
// is the trust boundary; encrypting at rest only added operational pain
// (lost keys = lost tokens) without raising the bar against any realistic
// attacker who already has DB access.

/**
 * Load (or reload) the pool. DB rows take priority; env is fallback when
 * DB is empty so the old deploy method still works.
 */
export async function reload(): Promise<number> {
  const dbPool = await loadFromDb();
  if (dbPool.length > 0) {
    pool = dbPool;
  } else {
    pool = loadFromEnv();
  }
  lastLoad = Date.now();
  return pool.length;
}

/** Trigger an initial load at module init. */
let initPromise: Promise<number> | null = null;
export function ensureLoaded(): Promise<number> {
  if (!initPromise) initPromise = reload();
  return initPromise;
}
ensureLoaded(); // fire and forget on import

export function poolSize(): number {
  return pool.length;
}

export function isPoolConfigured(): boolean {
  return pool.length > 0;
}

/**
 * Pick a stable pool slot for a given account id. Same account → same
 * pool position, regardless of how the underlying tokens are ordered in
 * the DB. We hash, then map into the *current* pool length.
 */
export function poolIndexForAccount(accountId: string): number {
  if (pool.length === 0) throw new Error('System token pool empty — configure via Adlux Settings UI or set FB_SYSTEM_TOKEN_N env vars');
  const hash = crypto.createHash('sha1').update(accountId).digest();
  const n = hash.readUInt32BE(0);
  return n % pool.length;
}

export function tokenForAccount(accountId: string): string {
  return pool[poolIndexForAccount(accountId)].token;
}

export function memberByIndex(idx: number): PoolMember | null {
  return pool[idx] || null;
}

export function allMembers(): readonly PoolMember[] {
  return pool;
}

/**
 * Return safe-to-display pool info (token redacted, just shows last 6 chars).
 * Used by admin UI to render the pool list.
 */
export function listSafe(): Array<{
  index: number;
  name: string;
  tokenTail: string;
  systemUserId: string | null;
  source: 'db' | 'env';
}> {
  return pool.map(m => ({
    index: m.index,
    name: m.name || `pool-${m.index}`,
    tokenTail: m.token.slice(-8),
    systemUserId: m.systemUserId || null,
    source: m.dbId ? 'db' : 'env'
  }));
}

/**
 * Look up the system_user_id for a pool slot by calling /me with the token.
 * Cached on the pool entry after first call.
 */
export async function getSystemUserId(idx: number, fetchFn: typeof fetch = fetch): Promise<string> {
  const member = pool[idx];
  if (!member) throw new Error(`Pool member ${idx} not configured`);
  if (member.systemUserId) return member.systemUserId;

  const res = await fetchFn(`https://graph.facebook.com/v23.0/me?access_token=${encodeURIComponent(member.token)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to identify system user for pool ${idx}: ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { id?: string };
  if (!data.id) throw new Error(`/me returned no id for pool ${idx}`);
  member.systemUserId = data.id;

  // Persist the cached system_user_id back to DB so the next reload doesn't
  // need to call /me again.
  if (member.dbId) {
    try {
      await prisma.$executeRaw`
        UPDATE "AdluxSystemToken"
        SET "systemUserId" = ${data.id}, "lastUsedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${member.dbId}
      `;
    } catch (err) {
      console.warn('[fb-pool] failed to cache systemUserId:', (err as Error).message);
    }
  }
  return data.id;
}

// CRUD helpers used by admin routes ----

export async function addToken(name: string, token: string): Promise<{ id: string; poolIndex: number }> {
  // Validate by calling /me first, so we don't store a dead token.
  const meRes = await fetch(`https://graph.facebook.com/v23.0/me?access_token=${encodeURIComponent(token)}`);
  if (!meRes.ok) {
    const text = await meRes.text();
    throw new Error(`Token validation failed: ${text.slice(0, 200)}`);
  }
  const me = await meRes.json() as { id?: string; name?: string };
  if (!me.id) throw new Error('Token /me returned no id');

  // Pick the next free poolIndex (max + 1, or 1 if none).
  const nextIdxRows = await prisma.$queryRaw<Array<{ next: number }>>`
    SELECT COALESCE(MAX("poolIndex"), 0) + 1 AS "next" FROM "AdluxSystemToken"
  `;
  const poolIndex = Number(nextIdxRows[0]?.next || 1);

  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "AdluxSystemToken"
      ("id", "poolIndex", "name", "token", "systemUserId", "isActive", "lastUsedAt", "updatedAt")
    VALUES
      (${id}, ${poolIndex}, ${name}, ${token}, ${me.id}, true, NOW(), NOW())
  `;
  // Populate expiry/scopes immediately so the admin sees correct info on
  // the very next list render — saves a manual "Refresh info" click.
  await refreshTokenInfo(id).catch(() => { /* don't block add on info fetch */ });
  await reload();
  return { id, poolIndex };
}

export async function removeToken(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "AdluxSystemToken" WHERE "id" = ${id}`;
  await reload();
}

export async function setActive(id: string, isActive: boolean): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AdluxSystemToken"
    SET "isActive" = ${isActive}, "updatedAt" = NOW()
    WHERE "id" = ${id}
  `;
  await reload();
}

export async function testToken(id: string): Promise<{ ok: boolean; systemUserId?: string; error?: string }> {
  const rows = await prisma.$queryRaw<Array<{ token: string }>>`
    SELECT "token" FROM "AdluxSystemToken" WHERE "id" = ${id} LIMIT 1
  `;
  if (!rows[0]) return { ok: false, error: 'token not found' };
  if (isLegacyEncrypted(rows[0].token)) return { ok: false, error: 'Legacy encrypted token — re-add' };

  try {
    const res = await fetch(`https://graph.facebook.com/v23.0/me?access_token=${encodeURIComponent(rows[0].token)}`);
    if (!res.ok) {
      const text = await res.text();
      const errMsg = text.slice(0, 200);
      await prisma.$executeRaw`
        UPDATE "AdluxSystemToken" SET "lastError" = ${errMsg}, "updatedAt" = NOW() WHERE "id" = ${id}
      `;
      return { ok: false, error: errMsg };
    }
    const me = await res.json() as { id?: string };
    await prisma.$executeRaw`
      UPDATE "AdluxSystemToken" SET "lastError" = NULL, "lastUsedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = ${id}
    `;
    // Piggyback an info refresh while we're at it — admin always wants
    // updated expiry numbers after a test.
    await refreshTokenInfo(id).catch(() => { /* swallow — main test already passed */ });
    return { ok: true, systemUserId: me.id };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Hit FB /debug_token to read the token's metadata: expiry, data-access
 * expiry, scopes, type. Caches result on the row so the admin UI can render
 * "expires in N days" without burning quota on every page load.
 *
 * Per Meta docs: expires_at = 0 means never (typical for system-user tokens).
 * data_access_expires_at is a separate clock — even if the token never
 * expires, FB requires re-authorization every ~90 days for data access.
 */
export async function refreshTokenInfo(id: string): Promise<{
  ok: boolean;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  tokenType: string | null;
  isValid: boolean;
  error?: string;
}> {
  const rows = await prisma.$queryRaw<Array<{ token: string }>>`
    SELECT "token" FROM "AdluxSystemToken" WHERE "id" = ${id} LIMIT 1
  `;
  if (!rows[0]) return { ok: false, expiresAt: null, dataAccessExpiresAt: null, scopes: [], tokenType: null, isValid: false, error: 'token not found' };
  if (isLegacyEncrypted(rows[0].token)) {
    return { ok: false, expiresAt: null, dataAccessExpiresAt: null, scopes: [], tokenType: null, isValid: false, error: 'Legacy encrypted token — re-add' };
  }
  const token = rows[0].token;

  // /debug_token requires either app access token or admin token; the
  // simplest reliable path is to inspect the token using itself (works for
  // system-user tokens since they're effectively their own admin).
  const url = `https://graph.facebook.com/v23.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, expiresAt: null, dataAccessExpiresAt: null, scopes: [], tokenType: null, isValid: false, error: text.slice(0, 200) };
  }
  const json = await res.json() as {
    data?: {
      app_id?: string;
      type?: string;
      application?: string;
      expires_at?: number;             // 0 = never
      data_access_expires_at?: number;
      is_valid?: boolean;
      issued_at?: number;
      scopes?: string[];
      user_id?: string;
    };
  };
  const d = json.data;
  if (!d) {
    return { ok: false, expiresAt: null, dataAccessExpiresAt: null, scopes: [], tokenType: null, isValid: false, error: 'debug_token returned no data' };
  }

  const expiresAt = d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null;
  const dataAccessExpiresAt = d.data_access_expires_at && d.data_access_expires_at > 0 ? new Date(d.data_access_expires_at * 1000) : null;
  const scopes = d.scopes || [];

  try {
    await prisma.$executeRaw`
      UPDATE "AdluxSystemToken"
      SET "expiresAt"           = ${expiresAt},
          "dataAccessExpiresAt" = ${dataAccessExpiresAt},
          "scopes"              = ${JSON.stringify(scopes)},
          "tokenType"           = ${d.type || null},
          "infoCheckedAt"       = NOW(),
          "updatedAt"           = NOW()
      WHERE "id" = ${id}
    `;
  } catch (err: any) {
    if (err?.meta?.code === '42703' || /column .* does not exist/i.test(err?.message || '')) {
      console.warn('[fb-pool] token info columns missing — run `npx prisma migrate deploy` to enable expiry tracking');
      // Don't throw — caller (addToken/testToken) shouldn't fail just because
      // expiry tracking isn't migrated yet.
    } else { throw err; }
  }

  return {
    ok: true,
    expiresAt,
    dataAccessExpiresAt,
    scopes,
    tokenType: d.type || null,
    isValid: !!d.is_valid
  };
}

/** Refresh info for ALL active tokens in one shot. */
export async function refreshAllTokenInfo(): Promise<{ done: number; failed: number }> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "AdluxSystemToken" WHERE "isActive" = true
  `;
  let done = 0, failed = 0;
  for (const r of rows) {
    try {
      const result = await refreshTokenInfo(r.id);
      if (result.ok) done++; else failed++;
    } catch { failed++; }
  }
  return { done, failed };
}

export async function listAll(): Promise<Array<{
  id: string;
  poolIndex: number;
  name: string;
  tokenTail: string;
  systemUserId: string | null;
  isActive: boolean;
  lastError: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  tokenType: string | null;
  infoCheckedAt: Date | null;
}>> {
  // Try the rich SELECT with all info columns. If the migration that adds
  // them hasn't been applied yet, Postgres errors with code 42703 ("column
  // does not exist") — we fall back to the basic SELECT so the admin UI
  // still works without losing access to the token list.
  type FullRow = {
    id: string; poolIndex: number; name: string; token: string;
    systemUserId: string | null; isActive: boolean;
    lastError: string | null; lastUsedAt: Date | null;
    expiresAt: Date | null; dataAccessExpiresAt: Date | null;
    scopes: string | null; tokenType: string | null; infoCheckedAt: Date | null;
  };
  let rows: FullRow[];
  try {
    rows = await prisma.$queryRaw<FullRow[]>`
      SELECT "id", "poolIndex", "name", "token", "systemUserId",
             "isActive", "lastError", "lastUsedAt",
             "expiresAt", "dataAccessExpiresAt", "scopes", "tokenType", "infoCheckedAt"
      FROM "AdluxSystemToken"
      ORDER BY "poolIndex" ASC
    `;
  } catch (err: any) {
    // 42703 = undefined_column. Migration 20260503160000_add_token_info_columns
    // hasn't been applied. Fall back to base columns; expiry shows as "—".
    if (err?.meta?.code === '42703' || /column .* does not exist/i.test(err?.message || '')) {
      console.warn('[fb-pool] token info columns missing — run `npx prisma migrate deploy`');
      const basic = await prisma.$queryRaw<Array<Omit<FullRow, 'expiresAt' | 'dataAccessExpiresAt' | 'scopes' | 'tokenType' | 'infoCheckedAt'>>>`
        SELECT "id", "poolIndex", "name", "token", "systemUserId",
               "isActive", "lastError", "lastUsedAt"
        FROM "AdluxSystemToken"
        ORDER BY "poolIndex" ASC
      `;
      rows = basic.map(r => ({
        ...r, expiresAt: null, dataAccessExpiresAt: null,
        scopes: null, tokenType: null, infoCheckedAt: null
      }));
    } else {
      throw err;
    }
  }

  return rows.map(r => {
    let scopes: string[] = [];
    if (r.scopes) {
      try { scopes = JSON.parse(r.scopes); } catch { /* keep [] */ }
    }
    return {
      id: r.id,
      poolIndex: r.poolIndex,
      name: r.name,
      tokenTail: r.token.slice(-8),
      systemUserId: r.systemUserId,
      isActive: r.isActive,
      lastError: r.lastError,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      dataAccessExpiresAt: r.dataAccessExpiresAt,
      scopes,
      tokenType: r.tokenType,
      infoCheckedAt: r.infoCheckedAt
    };
  });
}
