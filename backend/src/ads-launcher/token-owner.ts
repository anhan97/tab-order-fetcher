/**
 * Which ad accounts may this person launch into, and with which token (§8.1
 * steps 2 and 5, §11).
 *
 * Tokens tried, in order: the caller's own Facebook connection, then the
 * store owner's (members operate the owner's ad stack — same as the existing
 * campaign builder), then the system-user pool. The pool reaches every
 * account in the business, so it is only offered to admins and to people
 * with an explicit FacebookAdAccountAccess row for that account.
 *
 * Personal tokens prove access by themselves: if Meta lets that token read the
 * account, the account is theirs to use.
 */
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as userToken from '../services/fb-user-token.service';
import * as pool from '../services/fb-system-token.service';
import type { LauncherAdAccount } from './contract';
import { DEMO_AD_ACCOUNT, FakeMetaAdsWriter, isDemoAccount } from './fake-meta-ads-writer';
import { FbMetaAdsWriter } from './fb-meta-ads-writer';
import type { MetaAdsWriter } from './meta-ads-writer';
import * as breaker from './meta-breaker';
import { prisma } from './prisma-launch-repo';

export interface Caller {
  actorId: string;
  ownerId: string;
  isAdmin: boolean;
}

export class AccessError extends Error {
  constructor(readonly status: 403 | 502, readonly code: string, message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

/** Demo account: on outside production, or when ADS_LAUNCHER_DEMO=1. */
export function demoEnabled(): boolean {
  if (process.env.ADS_LAUNCHER_DEMO === '0') return false;
  return process.env.ADS_LAUNCHER_DEMO === '1' || process.env.NODE_ENV !== 'production';
}

async function safeToken(userId: string): Promise<string | null> {
  try {
    return await userToken.getRawToken(userId);
  } catch {
    return null;
  }
}

async function personalTokens(c: Caller): Promise<string[]> {
  const ids = c.actorId === c.ownerId ? [c.actorId] : [c.actorId, c.ownerId];
  const tokens = await Promise.all(ids.map(safeToken));
  return [...new Set(tokens.filter((t): t is string => !!t))];
}

async function hasAccessRow(c: Caller, adAccountId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "FacebookAdAccountAccess"
    WHERE "accountId" = ${adAccountId} AND "userId" IN (${c.actorId}, ${c.ownerId})
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

function poolToken(adAccountId: string): string | null {
  if (!pool.isPoolConfigured()) return null;
  try {
    return pool.tokenForAccount(adAccountId);
  } catch {
    return null;
  }
}

// Short memory of "this caller reaches this account with this token".
const resolved = new Map<string, { token: string; at: number }>();
const RESOLVE_TTL_MS = 10 * 60_000;

async function canRead(token: string, adAccountId: string): Promise<boolean> {
  if (breaker.check(breaker.breakerKey(token))) return true; // let the writer report the outage
  try {
    const res = await fetch(`https://graph.facebook.com/${FACEBOOK_CONFIG.version}/act_${adAccountId}?fields=id&access_token=${encodeURIComponent(token)}`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The writer for this launch, or AccessError (403: no access / no token;
 * 502: Meta breaker open for the chosen token).
 */
export async function resolveWriter(c: Caller, adAccountId: string): Promise<{ writer: MetaAdsWriter; isDemo: boolean }> {
  if (isDemoAccount(adAccountId)) {
    if (!demoEnabled()) throw new AccessError(403, 'demo_disabled', 'The demo account is disabled on this server');
    return { writer: new FakeMetaAdsWriter(), isDemo: true };
  }

  const cacheKey = `${c.actorId}:${c.ownerId}:${adAccountId}`;
  const hit = resolved.get(cacheKey);
  let token: string | null = hit && Date.now() - hit.at < RESOLVE_TTL_MS ? hit.token : null;

  if (!token) {
    const personal = await personalTokens(c);
    const candidates = [...personal];
    await pool.ensureLoaded().catch(() => 0);
    const pooled = poolToken(adAccountId);
    if (pooled && (c.isAdmin || (await hasAccessRow(c, adAccountId)))) candidates.push(pooled);
    if (candidates.length === 0) {
      throw new AccessError(403, 'facebook_not_connected', 'Connect Facebook first');
    }
    for (const t of candidates) {
      if (await canRead(t, adAccountId)) {
        token = t;
        break;
      }
    }
    if (!token) {
      throw new AccessError(403, 'ad_account_forbidden', 'None of your Facebook connections can reach this ad account');
    }
    resolved.set(cacheKey, { token, at: Date.now() });
  }

  const writer = new FbMetaAdsWriter(token, { adAccountId });
  try {
    writer.assertAvailable();
  } catch (e: any) {
    throw new AccessError(502, 'meta_unavailable', e?.message || 'Meta is unavailable, try again in a few minutes');
  }
  return { writer, isDemo: false };
}

export function forgetResolved(): void {
  resolved.clear();
}

// ─── Account list for the picker ────────────────────────────────────────────

const accountsCache = new Map<string, { at: number; items: LauncherAdAccount[] }>();
const ACCOUNTS_TTL_MS = 2 * 60_000;

async function meAdAccounts(token: string): Promise<LauncherAdAccount[]> {
  const out: LauncherAdAccount[] = [];
  let url: string | null = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/me/adaccounts?fields=id,name,currency,account_status&limit=200&access_token=${encodeURIComponent(token)}`;
  while (url && out.length < 1000) {
    const res: Response = await fetch(url);
    if (!res.ok) break;
    const json: any = await res.json();
    for (const a of json.data || []) {
      out.push({ id: String(a.id).replace(/^act_/, ''), name: a.name || a.id, currency: a.currency ?? null, accountStatus: a.account_status ?? null, isDemo: false });
    }
    url = json?.paging?.next || null;
  }
  return out;
}

/**
 * Admin: every account the system knows + their own. Others: accounts with an
 * access row for them (or the store owner), plus what their / the owner's
 * Facebook login can see.
 */
export async function listLauncherAccounts(c: Caller): Promise<LauncherAdAccount[]> {
  const key = `${c.actorId}:${c.ownerId}:${c.isAdmin}`;
  const hit = accountsCache.get(key);
  if (hit && Date.now() - hit.at < ACCOUNTS_TTL_MS) return hit.items;

  const rows = c.isAdmin
    ? await prisma.$queryRaw<Array<{ accountId: string; accountName: string; currency: string | null; accountStatus: number | null }>>`
        SELECT "accountId", "accountName", "currency", "accountStatus" FROM "FacebookAdAccountAssignment"
        WHERE "status" = 'assigned' ORDER BY "accountName" ASC`
    : await prisma.$queryRaw<Array<{ accountId: string; accountName: string; currency: string | null; accountStatus: number | null }>>`
        SELECT DISTINCT a."accountId", a."accountName", a."currency", a."accountStatus"
        FROM "FacebookAdAccountAccess" x
        JOIN "FacebookAdAccountAssignment" a ON a."accountId" = x."accountId"
        WHERE x."userId" IN (${c.actorId}, ${c.ownerId}) AND a."status" = 'assigned'
        ORDER BY a."accountName" ASC`;

  const byId = new Map<string, LauncherAdAccount>();
  for (const r of rows) {
    byId.set(r.accountId, { id: r.accountId, name: r.accountName, currency: r.currency, accountStatus: r.accountStatus, isDemo: false });
  }
  for (const token of await personalTokens(c)) {
    try {
      for (const a of await meAdAccounts(token)) if (!byId.has(a.id)) byId.set(a.id, a);
    } catch {
      /* one dead token must not hide the others */
    }
  }
  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (demoEnabled()) {
    items.push({ id: DEMO_AD_ACCOUNT.id, name: DEMO_AD_ACCOUNT.name, currency: DEMO_AD_ACCOUNT.currency, accountStatus: 1, isDemo: true });
  }
  accountsCache.set(key, { at: Date.now(), items });
  return items;
}
