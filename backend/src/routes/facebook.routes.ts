import express from 'express';
import { fetchFromFacebookApi } from '../services/facebook.service';
import { FACEBOOK_CONFIG } from '../config/facebook';
import { getAccountData, invalidateAccount } from '../services/fb-account-data.service';
import { getAllUsage } from '../services/fb-rate-limit.service';
import { stats as cacheStats } from '../services/fb-cache.service';
import * as pool from '../services/fb-system-token.service';
import { syncAndPersist, autoClaimForUser } from '../services/fb-adlux-orchestrator.service';
import {
  listUserAccounts, listUnclaimedAccounts, grantAccess, revokeAccess,
  setFavorite, getUserAccess
} from '../services/fb-access.service';
import { snapshotAccountDay, queryHistoricalSnapshots } from '../services/fb-snapshot.service';
import { getSchedulerStatus } from '../jobs/fb-adlux-scheduler';
import { resolveStore } from '../middleware/resolve-store';
import { getConfig as getAdluxConfig, setConfig as setAdluxConfig, maskSecret } from '../services/adlux-config.service';
import {
  listCampaignsForUser, setMapping, bulkAssignByPattern, getStoreAdSpend,
  saveCampaignsForStore, recomputeStoreSpend, computeStoreFbSpendForDay
} from '../services/campaign-mapping.service';
import * as userToken from '../services/fb-user-token.service';
import * as userFbApp from '../services/user-fb-app.service';
import { PrismaClient } from '@prisma/client';

const prismaForRoutes = new PrismaClient();
import fetch from 'node-fetch';

const router = express.Router();

// Exchange short-lived token for long-lived token
router.post('/exchange-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/oauth/access_token`;
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: FACEBOOK_CONFIG.appId,
      client_secret: FACEBOOK_CONFIG.appSecret,
      fb_exchange_token: token,
    });

    const response = await fetch(`${url}?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Facebook API proxy endpoint
router.get('/proxy', async (req, res) => {
  try {
    const { url, access_token } = req.query;

    if (!url || !access_token) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: {
          url: !url,
          access_token: !access_token
        }
      });
    }

    const urlStr = url as string;
    const tokenStr = access_token as string;

    // Add access token to URL if not already present
    const finalUrl = urlStr.includes('access_token=')
      ? urlStr
      : `${urlStr}${urlStr.includes('?') ? '&' : '?'}access_token=${tokenStr}`;

    const response = await fetch(finalUrl);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Facebook API proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch from Facebook API',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Single endpoint that returns campaigns + adsets + ads + insights for an
 * account/date-range. Heavy lifting in fb-account-data.service: 1 cached
 * structure call + 1 paginated level=ad insights call, with multi-tenant
 * sharing and adaptive backoff.
 *
 * Query params: accountId (required), since (ISO), until (ISO), accessToken (required)
 */
router.get('/account-data', resolveStore, async (req, res) => {
  try {
    if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
    const accountId = String(req.query.accountId || '').replace(/^act_/, '');
    const sinceStr = String(req.query.since || '');
    const untilStr = String(req.query.until || '');

    if (!accountId || !sinceStr || !untilStr) {
      return res.status(400).json({
        error: 'Missing required params',
        required: ['accountId', 'since', 'until']
      });
    }

    // SECURITY: token is no longer passed via URL/query string. We resolve
    // it server-side based on the authenticated user. Adlux pool wins when
    // configured; falls back to per-user FB SDK token from DB.
    let accessToken = '';
    if (!pool.isPoolConfigured()) {
      const dbToken = await userToken.getRawToken(req.resolved.userId);
      if (!dbToken) {
        return res.status(401).json({
          error: 'No FB connection found. Connect Facebook via the Facebook tab.',
          reason: 'no_connection'
        });
      }
      accessToken = dbToken;
      await userToken.markUsed(req.resolved.userId);
    }

    const since = new Date(sinceStr);
    const until = new Date(untilStr);
    if (isNaN(since.getTime()) || isNaN(until.getTime())) {
      return res.status(400).json({ error: 'Invalid since/until date' });
    }

    const data = await getAccountData(accountId, accessToken, since, until);
    return res.json(data);
  } catch (err: any) {
    const fbCode = err.fbCode;
    const isExpiredToken = fbCode === 190;                // OAuthException: expired/invalid token
    const isPermission = fbCode === 200 || fbCode === 10; // missing permission / scope
    const isRateLimit = fbCode === 17 || fbCode === 4 || fbCode === 32 || fbCode === 613
      || /rate-limited|too many|throttle/i.test(err.message || '');

    let httpStatus = err.httpStatus || 500;
    if (isExpiredToken) httpStatus = 401;
    else if (isPermission) httpStatus = 403;
    else if (isRateLimit) httpStatus = 429;

    return res.status(httpStatus).json({
      error: err.message || 'Failed to fetch account data',
      fbCode: fbCode || null,
      fbSubcode: err.fbSubcode || null,
      reason: isExpiredToken ? 'expired_token'
            : isPermission ? 'missing_permission'
            : isRateLimit ? 'rate_limit'
            : 'unknown'
    });
  }
});

/** Force-refresh an account by clearing its cached entries. */
router.post('/invalidate', (req, res) => {
  const accountId = String(req.body?.accountId || '').replace(/^act_/, '');
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const cleared = invalidateAccount(accountId);
  res.json({ cleared });
});

/** Diagnostics: show current cache size + per-account quota usage. */
router.get('/sync-status', async (_req, res) => {
  res.json({
    cache: cacheStats(),
    quota: getAllUsage(),
    pool: { size: pool.poolSize(), configured: pool.isPoolConfigured() },
    scheduler: await getSchedulerStatus()
  });
});

// ----- Adlux multi-tenant routes -----

/**
 * Trigger an immediate BM sync (admin-style endpoint, no auth check yet).
 * Useful for manual onboarding before the cron tick fires.
 */
router.post('/sync-bm', async (_req, res) => {
  const cfg = await getAdluxConfig();
  if (!cfg.adluxBmId) return res.status(400).json({ error: 'Adlux BM ID not configured (Settings → Adlux)' });
  await pool.ensureLoaded();
  if (!pool.isPoolConfigured()) return res.status(400).json({ error: 'No system tokens configured (Settings → Adlux)' });
  try {
    const report = await syncAndPersist(cfg.adluxBmId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** List unclaimed accounts (admin / debugging). */
router.get('/unclaimed-accounts', async (_req, res) => {
  try {
    const accounts = await listUnclaimedAccounts();
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List every ad account in Adlux BM (owned + shared-in), each tagged with
 * whether the current user already has access. Powers the onboarding wizard's
 * primary view: "here's what's available, click to add".
 */
router.get('/adlux-accounts', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const userId = req.resolved.userId;
    const accounts = await prismaForRoutes.$queryRaw<Array<{
      accountId: string; accountName: string; status: string;
      accountStatus: number | null; currency: string | null;
      hasAccess: boolean;
    }>>`
      SELECT a."accountId", a."accountName", a."status", a."accountStatus", a."currency",
             CASE WHEN x."userId" IS NOT NULL THEN true ELSE false END AS "hasAccess"
      FROM "FacebookAdAccountAssignment" a
      LEFT JOIN "FacebookAdAccountAccess" x ON x."accountId" = a."accountId" AND x."userId" = ${userId}
      WHERE a."status" = 'assigned'
      ORDER BY a."accountName" ASC
    `;
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Bulk-grant access to multiple accounts at once. */
router.post('/claim-accounts-bulk', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const accountIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : null;
  if (!accountIds) return res.status(400).json({ error: 'accountIds[] required' });
  try {
    let claimed = 0;
    for (const aid of accountIds) {
      if (!aid) continue;
      await grantAccess(req.resolved.userId, String(aid).replace(/^act_/, ''), 'admin');
      claimed++;
    }
    res.json({ ok: true, claimed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** List accounts the resolved user has access to. */
router.get('/my-accounts', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const accounts = await listUserAccounts(req.resolved.userId);
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Grant the current user access to a specific account they own. Used during
 * onboarding when user manually picks accounts they shared.
 */
router.post('/claim-account', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { accountId, role } = req.body || {};
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  try {
    await grantAccess(req.resolved.userId, String(accountId).replace(/^act_/, ''), role || 'admin');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Auto-claim all accounts shared from the user's own FB Business. Reads
 * client_ad_accounts filtered by source business id.
 */
router.post('/auto-claim', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { fbBusinessId } = req.body || {};
  if (!fbBusinessId) return res.status(400).json({ error: 'fbBusinessId required' });
  const cfg = await getAdluxConfig();
  if (!cfg.adluxBmId) return res.status(400).json({ error: 'Adlux BM ID not configured' });
  try {
    const result = await autoClaimForUser(req.resolved.userId, String(fbBusinessId), cfg.adluxBmId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/unclaim-account', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const accountId = String(req.query.accountId || '').replace(/^act_/, '');
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  try {
    await revokeAccess(req.resolved.userId, accountId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/account-favorite', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { accountId, isFavorite } = req.body || {};
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  try {
    await setFavorite(req.resolved.userId, String(accountId).replace(/^act_/, ''), !!isFavorite);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Historical snapshot query — for date ranges entirely in the past.
 * Reads from FacebookAdInsightSnapshot, no FB call.
 */
router.get('/historical', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const accountId = String(req.query.accountId || '').replace(/^act_/, '');
  const since = new Date(String(req.query.since || ''));
  const until = new Date(String(req.query.until || ''));
  if (!accountId || isNaN(since.getTime()) || isNaN(until.getTime())) {
    return res.status(400).json({ error: 'accountId, since, until required' });
  }
  // Verify access
  const access = await getUserAccess(req.resolved.userId, accountId);
  if (!access) return res.status(403).json({ error: 'no access to this account' });

  try {
    const rows = await queryHistoricalSnapshots(accountId, since, until);
    res.json({ rows, fromSnapshots: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Manual snapshot trigger for a specific account+date. Useful for
 * back-filling after the snapshot cron failed.
 */
router.post('/snapshot-day', async (req, res) => {
  const { accountId, date } = req.body || {};
  if (!accountId || !date) return res.status(400).json({ error: 'accountId, date required' });
  try {
    const result = await snapshotAccountDay(String(accountId).replace(/^act_/, ''), new Date(date));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== User FB Connection (per-user token, DB-backed, encrypted) =====

/**
 * Connect: frontend POSTs short-lived SDK token. Backend exchanges to
 * long-lived (~60 days) using app secret, stores AES-encrypted in DB.
 * Returns safe metadata only — never echoes the token back.
 */
router.post('/connect', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { token, adAccounts } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token required in body (POST, not URL)' });
  }
  try {
    const status = await userToken.connect(req.resolved.userId, token);
    // adAccounts in body is now ignored — the per-user account list is
    // sourced from FacebookAdAccountAccess (joined with the Adlux-managed
    // FacebookAdAccountAssignment), populated by the BM sync job. The
    // legacy FacebookAdAccount cache table was dropped.
    void adAccounts;
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/connection-status', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const status = await userToken.getStatus(req.resolved.userId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/connection', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    await userToken.disconnect(req.resolved.userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Full FB sign-out — wipes BOTH per-user connection types so the user can
 * cleanly switch between modes:
 *   - UserFacebookConnection (user-token / FB SDK login)
 *   - FacebookAdAccountAccess rows (Adlux BM claims)
 *
 * Front-end calls this when the merchant picks "Switch FB mode" so they
 * land back on the mode-picker with a clean slate.
 */
router.delete('/disconnect-all', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const userId = req.resolved.userId;
  const wiped = { userToken: false, adluxAccounts: 0 };
  try {
    try {
      await userToken.disconnect(userId);
      wiped.userToken = true;
    } catch (e: any) {
      // userToken.disconnect is idempotent — but treat unexpected DB errors as fatal.
      console.warn('[fb] disconnect-all: userToken.disconnect failed:', e?.message);
    }
    const del = await prismaForRoutes.facebookAdAccountAccess.deleteMany({ where: { userId } });
    wiped.adluxAccounts = del.count;
    res.json({ ok: true, ...wiped });
  } catch (err: any) {
    res.status(500).json({ error: err.message, ...wiped });
  }
});

// ============================================================================
// Per-user Facebook App credentials
// ============================================================================
// Each user brings their own FB App so one compliance flag doesn't take down
// everyone. The /my-app endpoints CRUD these per-user credentials. The
// frontend consults /my-app first; if no row exists, it shows a setup card
// nudging the user to create their own FB App on developers.facebook.com
// and paste the App ID + Secret here.

/** GET own app (masked secret) — used by Settings UI + frontend SDK init. */
router.get('/my-app', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    res.json(await userFbApp.getOwnAppSafe(req.resolved.userId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT own app — create or update per-user FB App credentials. */
router.put('/my-app', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { fbAppId, fbAppSecret, fbBmId, appName } = req.body || {};
  // Light validation only — FB rejects bad creds at exchange time, which gives
  // a richer error than we could produce here.
  if (fbAppId !== undefined && (typeof fbAppId !== 'string' || !/^\d{8,20}$/.test(fbAppId.trim()))) {
    return res.status(400).json({ error: 'fbAppId must be a numeric FB App ID (8-20 digits)' });
  }
  if (fbAppSecret !== undefined && (typeof fbAppSecret !== 'string' || fbAppSecret.length < 16)) {
    return res.status(400).json({ error: 'fbAppSecret looks too short — paste the full App Secret from FB' });
  }
  try {
    await userFbApp.upsertForUser(req.resolved.userId, {
      fbAppId: fbAppId?.trim(),
      fbAppSecret: fbAppSecret?.trim(),
      fbBmId: fbBmId !== undefined ? (fbBmId?.trim() || null) : undefined,
      appName: appName !== undefined ? (appName?.trim() || null) : undefined
    });
    res.json(await userFbApp.getOwnAppSafe(req.resolved.userId));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE own app — falls back to global config until they re-add. */
router.delete('/my-app', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    await userFbApp.deleteForUser(req.resolved.userId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Test the user's app credentials against FB by calling /oauth/access_token
 * with grant_type=client_credentials (returns an app token if creds work).
 * Doesn't burn rate limit for the user's account.
 */
router.post('/my-app/test', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const cfg = await userFbApp.getForUser(req.resolved.userId);
    if (!cfg.fbAppId || !cfg.fbAppSecret) {
      return res.status(400).json({ ok: false, error: 'No FB app credentials set yet.' });
    }
    const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/oauth/access_token?` +
      `client_id=${encodeURIComponent(cfg.fbAppId)}` +
      `&client_secret=${encodeURIComponent(cfg.fbAppSecret)}` +
      `&grant_type=client_credentials`;
    const r = await fetch(url);
    const text = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    if (!r.ok) {
      const msg = parsed?.error?.message || text.slice(0, 200);
      await userFbApp.markError(req.resolved.userId, msg);
      return res.status(400).json({ ok: false, error: msg, source: cfg.source });
    }
    res.json({ ok: true, source: cfg.source, hasAppToken: !!parsed?.access_token });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * List the user's accessible ad accounts.
 *
 * Resolution order (first non-empty wins):
 *   1. Adlux-managed: FacebookAdAccountAccess × Assignment (multi-tenant pool)
 *   2. Legacy: GET /me/adaccounts via the user's own FB SDK token, so the
 *      list survives F5 without forcing the user to reconnect just to see
 *      their accounts again.
 *
 * Without (2), legacy users (who use their own FB App + token) had no row
 * in FacebookAdAccountAccess and the page bounced them to the connect
 * screen on every reload.
 */
router.get('/connection-accounts', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const userId = req.resolved.userId;
  try {
    // 1. Adlux path
    const adluxRows = await prismaForRoutes.$queryRaw<Array<{ accountId: string; name: string }>>`
      SELECT a."accountId", a."accountName" AS "name"
      FROM "FacebookAdAccountAccess" x
      JOIN "FacebookAdAccountAssignment" a ON a."accountId" = x."accountId"
      WHERE x."userId" = ${userId}
        AND a."status" = 'assigned'
      ORDER BY a."accountName" ASC
    `;
    if (adluxRows.length > 0) {
      return res.json({ accounts: adluxRows, source: 'adlux' });
    }

    // 2. Legacy fallback: user's own FB token → /me/adaccounts
    const token = await userToken.getRawToken(userId);
    if (!token) return res.json({ accounts: [], source: 'none' });

    const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/me/adaccounts` +
      `?fields=id,name,account_status,currency,timezone_name` +
      `&limit=200&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text();
      console.warn(`[connection-accounts] /me/adaccounts failed: ${r.status} ${text.slice(0, 200)}`);
      return res.json({ accounts: [], source: 'fb-error' });
    }
    const json = await r.json() as { data?: Array<{ id: string; name: string; account_status?: number; currency?: string; timezone_name?: string }> };
    const accounts = (json.data || [])
      // Only ACTIVE (account_status=1) accounts — others are disabled or pending.
      .filter(a => a.account_status === undefined || a.account_status === 1)
      .map(a => ({
        accountId: a.id.replace(/^act_/, ''),
        name: a.name,
        currency: a.currency,
        timezone: a.timezone_name
      }));
    res.json({ accounts, source: 'fb-graph' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Adlux Admin: Config + Token Management =====

/**
 * GET current config (App ID, App Secret masked, BM ID). Includes source
 * indicator (db/env/none) so admin can see whether DB or env is in effect.
 */
router.get('/admin/config', async (_req, res) => {
  try {
    const cfg = await getAdluxConfig();
    res.json({
      fbAppId: cfg.fbAppId,
      fbAppSecret: maskSecret(cfg.fbAppSecret),
      adluxBmId: cfg.adluxBmId,
      hasSecret: !!cfg.fbAppSecret,
      secretLength: cfg.fbAppSecret?.length || 0,
      source: cfg.source
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Validate the configured App ID + App Secret by hitting FB's app endpoint.
 * Returns ok=false with FB's error message if the credentials are bad —
 * lets admins verify without going through a full user OAuth flow.
 */
router.post('/admin/config/test', async (_req, res) => {
  try {
    const cfg = await getAdluxConfig();
    if (!cfg.fbAppId || !cfg.fbAppSecret) {
      return res.json({ ok: false, error: 'App ID or App Secret not configured' });
    }
    // Use grant_type=client_credentials which validates the app credentials
    // without requiring a user token. Returns a fresh app access token if OK.
    const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/oauth/access_token?` +
      `client_id=${encodeURIComponent(cfg.fbAppId)}` +
      `&client_secret=${encodeURIComponent(cfg.fbAppSecret)}` +
      `&grant_type=client_credentials`;
    const fbRes = await fetch(url);
    if (!fbRes.ok) {
      const text = await fbRes.text();
      let parsed: any; try { parsed = JSON.parse(text); } catch { /* keep raw */ }
      return res.json({
        ok: false,
        error: parsed?.error?.message || text.slice(0, 200),
        fbCode: parsed?.error?.code,
        appIdSource: cfg.source.fbAppId,
        secretSource: cfg.source.fbAppSecret,
        secretFingerprint: `${cfg.fbAppSecret.slice(0, 4)}...${cfg.fbAppSecret.slice(-4)} (len=${cfg.fbAppSecret.length})`
      });
    }
    const json = await fbRes.json() as { access_token?: string };
    res.json({
      ok: true,
      hasAppToken: !!json.access_token,
      appIdSource: cfg.source.fbAppId,
      secretSource: cfg.source.fbAppSecret
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT config — accepts any of {fbAppId, fbAppSecret, adluxBmId}. Empty
 * string explicitly clears that field; missing field keeps existing value.
 */
router.put('/admin/config', async (req, res) => {
  const updates: any = {};
  if ('fbAppId' in req.body)     updates.fbAppId     = String(req.body.fbAppId || '').trim() || null;
  if ('fbAppSecret' in req.body) updates.fbAppSecret = String(req.body.fbAppSecret || '').trim() || null;
  if ('adluxBmId' in req.body)   updates.adluxBmId   = String(req.body.adluxBmId || '').trim() || null;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  try {
    const cfg = await setAdluxConfig(updates);
    res.json({
      fbAppId: cfg.fbAppId,
      fbAppSecret: maskSecret(cfg.fbAppSecret),
      adluxBmId: cfg.adluxBmId,
      source: cfg.source
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET system token pool — token values are redacted to last 8 chars. */
router.get('/admin/tokens', async (_req, res) => {
  try {
    await pool.ensureLoaded();
    const tokens = await pool.listAll();
    res.json({ tokens, poolSize: pool.poolSize() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST add a new token. Backend validates with /me before storing. */
router.post('/admin/tokens', async (req, res) => {
  const { name, token } = req.body || {};
  if (!name || !token) return res.status(400).json({ error: 'name + token required' });
  try {
    const result = await pool.addToken(String(name).trim(), String(token).trim());
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/admin/tokens/:id', async (req, res) => {
  try {
    await pool.removeToken(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/tokens/:id/active', async (req, res) => {
  const isActive = !!req.body?.isActive;
  try {
    await pool.setActive(req.params.id, isActive);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST test a token — calls FB /me; updates lastError on failure. */
router.post('/admin/tokens/:id/test', async (req, res) => {
  try {
    const result = await pool.testToken(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST refresh debug_token info (expiry, scopes, type) for a single token. */
router.post('/admin/tokens/:id/refresh-info', async (req, res) => {
  try {
    const result = await pool.refreshTokenInfo(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST refresh info for ALL active tokens in one shot. */
router.post('/admin/tokens/refresh-info-all', async (_req, res) => {
  try {
    const result = await pool.refreshAllTokenInfo();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Campaign ↔ Store Mapping =====

/** List user's Shopify stores (for the dropdown when assigning campaigns). */
router.get('/my-stores', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const stores = await prismaForRoutes.shopifyStore.findMany({
      where: { userId: req.resolved.userId, isActive: true },
      select: { id: true, storeDomain: true, name: true }
    });
    res.json({ stores });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** List all campaigns the user can see, with current mapping decoration. */
router.get('/campaigns', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const campaigns = await listCampaignsForUser(req.resolved.userId);
    res.json({ campaigns });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bridge endpoint for legacy FB-SDK-login users (no Adlux pool yet).
 *
 * SECURITY: token is read from DB (UserFacebookConnection) based on the
 * authenticated user, never accepted from the request. Frontend just
 * passes the ad-account list it wants campaigns for; backend's user
 * token authorises the FB API calls.
 */
router.post('/campaigns/bridge', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
  if (accounts.length === 0) return res.json({ campaigns: [] });

  const dbToken = await userToken.getRawToken(req.resolved.userId);
  if (!dbToken) {
    return res.status(401).json({
      error: 'No FB connection. Connect Facebook first.',
      reason: 'no_connection'
    });
  }

  const out: any[] = [];
  for (const acc of accounts) {
    if (!acc?.accountId) continue;
    const accId = String(acc.accountId).replace(/^act_/, '');
    try {
      const fields = 'id,name,status,effective_status,objective';
      const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/act_${accId}/campaigns?fields=${fields}&limit=500&access_token=${encodeURIComponent(dbToken)}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const json = await r.json() as { data?: any[] };
      for (const c of json.data || []) {
        out.push({
          campaignId: c.id,
          campaignName: c.name,
          accountId: accId,
          accountName: acc.accountName || null,
          status: c.status || null,
          effectiveStatus: c.effective_status || null,
          objective: c.objective || null,
          storeId: null,
          storeDomain: null
        });
      }
    } catch (err) {
      console.warn(`[campaigns/bridge] ${accId} failed:`, (err as Error).message);
    }
  }
  await userToken.markUsed(req.resolved.userId);

  // Decorate with current store mappings (same as Adlux path).
  if (out.length > 0) {
    const ids = out.map(c => c.campaignId);
    const mappings = await prismaForRoutes.$queryRaw<Array<{ campaignId: string; storeId: string; storeDomain: string }>>`
      SELECT m."campaignId", m."storeId", s."storeDomain"
      FROM "CampaignStoreMapping" m
      JOIN "ShopifyStore" s ON s."id" = m."storeId"
      WHERE m."userId" = ${req.resolved.userId} AND m."campaignId" = ANY(${ids}::text[])
    `;
    const byId = new Map(mappings.map(m => [m.campaignId, { storeId: m.storeId, storeDomain: m.storeDomain }]));
    for (const c of out) {
      const m = byId.get(c.campaignId);
      if (m) { c.storeId = m.storeId; c.storeDomain = m.storeDomain; }
    }
  }

  res.json({ campaigns: out });
});

/** Upsert mapping for a single campaign. storeId=null clears the mapping. */
router.put('/campaign-mapping', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { campaignId, campaignName, accountId, storeId } = req.body || {};
  if (!campaignId || !accountId) {
    return res.status(400).json({ error: 'campaignId + accountId required' });
  }
  try {
    await setMapping({
      userId: req.resolved.userId,
      campaignId: String(campaignId),
      campaignName,
      accountId: String(accountId).replace(/^act_/, ''),
      storeId: storeId ? String(storeId) : null
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Set-semantics save for one store: replace the store's mapping with the
 * given campaign list atomically. Used by the Facebook tab's mapping panel.
 */
router.post('/campaign-mapping/save-for-store', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { storeId, campaigns } = req.body || {};
  if (!storeId || !Array.isArray(campaigns)) {
    return res.status(400).json({ error: 'storeId + campaigns[] required' });
  }
  // Sanitise each row.
  const cleaned = campaigns
    .filter((c: any) => c && c.campaignId && c.accountId)
    .map((c: any) => ({
      campaignId: String(c.campaignId),
      campaignName: c.campaignName ? String(c.campaignName) : null,
      accountId: String(c.accountId).replace(/^act_/, '')
    }));
  try {
    const result = await saveCampaignsForStore({
      userId: req.resolved.userId,
      storeId: String(storeId),
      campaigns: cleaned
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Bulk-map every campaign whose name matches the given pattern. */
router.post('/campaign-mapping/bulk', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { storeId, pattern, patternType } = req.body || {};
  if (!storeId || !pattern) return res.status(400).json({ error: 'storeId + pattern required' });
  try {
    const result = await bulkAssignByPattern(
      req.resolved.userId,
      String(storeId),
      String(pattern),
      patternType === 'regex' ? 'regex' : 'contains'
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Force a refresh: backfill missing snapshots for the store's mapped
 * campaigns + recompute P&L snapshots for the same range. Use when the
 * mapping changed and the user wants P&L numbers to update immediately
 * instead of waiting for the daily 00:15 cron.
 */
router.post('/recompute-store-spend', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { storeId, since, until } = req.body || {};
  if (!storeId || !since || !until) {
    return res.status(400).json({ error: 'storeId + since + until required' });
  }
  const sinceD = new Date(since);
  const untilD = new Date(until);
  if (isNaN(sinceD.getTime()) || isNaN(untilD.getTime())) {
    return res.status(400).json({ error: 'Invalid since/until' });
  }
  try {
    const spendResult = await recomputeStoreSpend(req.resolved.userId, String(storeId), sinceD, untilD);
    const { recomputeRange } = await import('../services/daily-pl.service');
    const plResult = await recomputeRange(req.resolved.userId, String(storeId), sinceD, untilD);
    res.json({ spend: spendResult, pl: plResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Quick: today's spend for a single store from mapping (live FB call). */
router.get('/store-spend-today', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const storeId = String(req.query.storeId || '');
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const spend = await computeStoreFbSpendForDay(req.resolved.userId, storeId, today);
    res.json({ date: today.toISOString().slice(0, 10), spend });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Wipe + re-snapshot ALL past days in a wide window for the store's mapped
 * accounts. Use when prior snapshots are known wrong (mapping changed,
 * snapshot job failed earlier, FB data was late). Defaults to 90 days back.
 *
 * Burns N days × M accounts insights reads, sequential — sized for "fix it
 * once" not "background loop".
 */
router.post('/backfill-store-spend', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const { storeId, daysBack } = req.body || {};
  if (!storeId) return res.status(400).json({ error: 'storeId required' });
  const days = Math.min(Math.max(parseInt(String(daysBack ?? 90), 10) || 90, 1), 365);
  const until = new Date();
  until.setUTCHours(0, 0, 0, 0);
  // until = today; recomputeStoreSpend skips today (it's mutable, served live).
  const since = new Date(until.getTime() - days * 86400000);
  try {
    const spendResult = await recomputeStoreSpend(req.resolved.userId, String(storeId), since, until);
    const { recomputeRange } = await import('../services/daily-pl.service');
    const plResult = await recomputeRange(req.resolved.userId, String(storeId), since, until);
    res.json({ daysRequested: days, since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10), spend: spendResult, pl: plResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Compute ad spend attributed to a single store over a date range. Sums
 * across all campaigns mapped to that store. Snapshot for past dates,
 * live for today.
 */
router.get('/store-ad-spend', resolveStore, async (req, res) => {
  if (!req.resolved?.userId) return res.status(401).json({ error: 'unauthenticated' });
  const storeId = String(req.query.storeId || '');
  const since = new Date(String(req.query.since || ''));
  const until = new Date(String(req.query.until || ''));
  if (!storeId || isNaN(since.getTime()) || isNaN(until.getTime())) {
    return res.status(400).json({ error: 'storeId, since, until required' });
  }
  try {
    const result = await getStoreAdSpend(req.resolved.userId, storeId, since, until);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;