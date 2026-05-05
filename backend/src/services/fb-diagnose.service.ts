/**
 * Per-account FB diagnostic — answers "why does this ad account fail?".
 *
 * For each account the user can see in /me/adaccounts:
 *   1. Pull metadata (owner, business, status, disable_reason).
 *   2. Probe a tiny insights call to see whether the user's token can
 *      actually read this account's ads data.
 *   3. Map the result into one of a small set of typed `kind` values so
 *      the frontend can render a deterministic action card per row.
 *
 * Stays read-only — no campaign mutations, no token refreshes. Safe to
 * run as often as the user wants.
 */

import { FACEBOOK_CONFIG } from '../config/facebook';

const FB_BASE = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

export type DiagnosisKind =
  | 'ok'                          // account loads insights cleanly
  | 'app_not_in_bm'               // BM-owned, app not assigned to this account
  | 'app_not_advanced_access'     // personal-owned, app missing Advanced Access for ads_*
  | 'account_disabled'            // FB disabled the account (status != 1)
  | 'account_unsettled'           // pending billing / unsettled / restricted
  | 'access_denied'               // some other 403/200 — generic
  | 'token_expired'               // #190 not categorised above
  | 'unknown_error';              // anything else

export interface DiagnosisRow {
  accountId: string;              // no 'act_' prefix
  name: string;
  accountStatus: number | null;   // FB's account_status enum (1 = active)
  disableReason: number | null;   // FB's disable_reason enum (0 = none)
  ownerType: 'personal' | 'business' | 'unknown';
  business: { id: string; name: string } | null;
  currency: string | null;
  timezone: string | null;
  accessible: boolean;
  fbErrorCode: number | null;
  fbErrorMessage: string | null;
  kind: DiagnosisKind;
  suggestion: string;
  fixUrl: string | null;          // deep-link to the right Meta dashboard
}

export interface DiagnoseInput {
  accessToken: string;
  /** App ID of the FB App being used — fed into deep-link URLs in suggestions. */
  fbAppId: string;
  /** When set, restrict the probe to these account IDs; otherwise probe /me/adaccounts. */
  accountIds?: string[];
}

interface RawAccount {
  id: string;                     // act_<n>
  name?: string;
  account_status?: number;
  disable_reason?: number;
  business?: { id: string; name: string };
  owner?: string;                 // user id of personal owner (when no BM)
  currency?: string;
  timezone_name?: string;
}

/**
 * Diagnose every account the caller can see, or just the supplied subset.
 * Concurrency is capped at 5 — FB's per-app QPS is small and a fan-out of
 * 50 ad accounts would burn through it instantly.
 */
export async function diagnoseAccounts(input: DiagnoseInput): Promise<DiagnosisRow[]> {
  const accounts = input.accountIds
    ? input.accountIds.map(id => ({ id: id.startsWith('act_') ? id : `act_${id}` }))
    : await listAdAccounts(input.accessToken);

  const rows: DiagnosisRow[] = [];
  const queue = [...accounts];
  const concurrency = 5;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const acc = queue.shift();
      if (!acc) break;
      rows.push(await diagnoseOne(acc.id, input.accessToken, input.fbAppId));
    }
  });
  await Promise.all(workers);
  // Stable order: accessible first, then disabled, then errors.
  rows.sort((a, b) => rankKind(a.kind) - rankKind(b.kind));
  return rows;
}

function rankKind(k: DiagnosisKind): number {
  if (k === 'ok') return 0;
  if (k === 'app_not_in_bm' || k === 'app_not_advanced_access') return 1;
  if (k === 'account_disabled' || k === 'account_unsettled') return 2;
  return 3;
}

async function listAdAccounts(token: string): Promise<Array<{ id: string }>> {
  const url = `${FB_BASE}/me/adaccounts?fields=id&limit=200&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FB /me/adaccounts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  return (json.data || []).map((a: any) => ({ id: a.id }));
}

async function diagnoseOne(rawId: string, token: string, fbAppId: string): Promise<DiagnosisRow> {
  const accountId = rawId.replace(/^act_/, '');
  // Step 1 — metadata. No insights yet; this call is cheap and rarely fails.
  let meta: RawAccount | null = null;
  let metaError: { code: number | null; message: string | null } = { code: null, message: null };
  try {
    const url = `${FB_BASE}/act_${accountId}?fields=id,name,account_status,disable_reason,business,owner,currency,timezone_name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!res.ok) {
      metaError = { code: parsed?.error?.code ?? null, message: parsed?.error?.message ?? text.slice(0, 200) };
    } else {
      meta = parsed;
    }
  } catch (e: any) {
    metaError = { code: null, message: e?.message || String(e) };
  }

  // Step 2 — access probe. /act_X?fields= can succeed even when the
  // user can't read insights (read vs ads scope). Hit insights with a
  // small window so failure surfaces precisely.
  let probe: { ok: boolean; code: number | null; message: string | null } = { ok: false, code: null, message: null };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${FB_BASE}/act_${accountId}/insights?fields=spend&time_range=${encodeURIComponent(JSON.stringify({ since: today, until: today }))}&limit=1&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    probe = res.ok
      ? { ok: true, code: null, message: null }
      : { ok: false, code: parsed?.error?.code ?? null, message: parsed?.error?.message ?? text.slice(0, 200) };
  } catch (e: any) {
    probe = { ok: false, code: null, message: e?.message || String(e) };
  }

  // Compose a row. Even when meta failed, surface what we know.
  const ownerType: DiagnosisRow['ownerType'] = meta?.business
    ? 'business'
    : (meta?.owner ? 'personal' : 'unknown');
  const business = meta?.business ? { id: meta.business.id, name: meta.business.name } : null;
  const accessible = probe.ok;
  const fbErrorCode = probe.code ?? metaError.code;
  const fbErrorMessage = probe.message ?? metaError.message;

  const { kind, suggestion, fixUrl } = classify({
    meta,
    accessible,
    probeError: probe,
    metaError,
    ownerType,
    fbAppId
  });

  return {
    accountId,
    name: meta?.name || `act_${accountId}`,
    accountStatus: meta?.account_status ?? null,
    disableReason: meta?.disable_reason ?? null,
    ownerType,
    business,
    currency: meta?.currency || null,
    timezone: meta?.timezone_name || null,
    accessible,
    fbErrorCode,
    fbErrorMessage,
    kind,
    suggestion,
    fixUrl
  };
}

interface ClassifyInput {
  meta: RawAccount | null;
  accessible: boolean;
  probeError: { ok: boolean; code: number | null; message: string | null };
  metaError: { code: number | null; message: string | null };
  ownerType: DiagnosisRow['ownerType'];
  fbAppId: string;
}

/**
 * Pure mapping from probe result → suggestion text + fix URL.
 * Exposed so the test suite can pin every branch.
 */
export function classify(c: ClassifyInput): { kind: DiagnosisKind; suggestion: string; fixUrl: string | null } {
  // 1. Account is disabled — different fix from auth issues.
  if (c.meta && c.meta.account_status !== undefined && c.meta.account_status !== 1) {
    if (c.meta.account_status === 3 || c.meta.account_status === 9 || c.meta.account_status === 100 || c.meta.account_status === 101 || c.meta.account_status === 102) {
      return {
        kind: 'account_disabled',
        suggestion: `Account đã bị FB disable (status=${c.meta.account_status}, reason=${c.meta.disable_reason ?? 'unknown'}). Liên hệ FB Support để khôi phục — không fix bằng code được.`,
        fixUrl: `https://www.facebook.com/business/help/`
      };
    }
    if (c.meta.account_status === 2 || c.meta.account_status === 7) {
      return {
        kind: 'account_unsettled',
        suggestion: `Account chưa settled / billing issue (status=${c.meta.account_status}). Setup payment method và pay outstanding balance.`,
        fixUrl: `https://business.facebook.com/billing_hub/payment_settings`
      };
    }
  }

  if (c.accessible) {
    return { kind: 'ok', suggestion: 'OK — token đọc được account này.', fixUrl: null };
  }

  // 2. App not in BM — most precise message FB returns.
  const errMsg = (c.probeError.message || c.metaError.message || '').toLowerCase();
  if (/application does not belong to system user/i.test(errMsg)) {
    return {
      kind: 'app_not_in_bm',
      suggestion: c.meta?.business
        ? `App ${c.fbAppId} chưa được install vào BM "${c.meta.business.name}" hoặc chưa assign cho account này. Mở Business Settings của BM đó → Apps → add app + assign quyền Advertise/Manage.`
        : `App ${c.fbAppId} chưa được BM-owner của account này authorize.`,
      fixUrl: c.meta?.business
        ? `https://business.facebook.com/settings/apps?business_id=${c.meta.business.id}`
        : `https://business.facebook.com/settings/apps`
    };
  }

  // 3. The classic #200 "Ad account owner has NOT grant".
  if (c.probeError.code === 200 || /ad account owner has not grant/i.test(errMsg)) {
    if (c.ownerType === 'business' && c.meta?.business) {
      return {
        kind: 'app_not_in_bm',
        suggestion: `BM "${c.meta.business.name}" chưa assign app ${c.fbAppId} cho account này. Mở account settings → Assigned partners → add app với quyền Advertise/Manage.`,
        fixUrl: `https://business.facebook.com/settings/ad-accounts/${c.meta?.id?.replace(/^act_/, '') ?? ''}?business_id=${c.meta.business.id}`
      };
    }
    return {
      kind: 'app_not_advanced_access',
      suggestion: `App ${c.fbAppId} chưa có Advanced Access cho ads_read/ads_management, hoặc bạn chưa là Admin/Developer/Tester của app. Vào App Review → Permissions and Features và bật Advanced Access (hoặc add yourself vào App Roles).`,
      fixUrl: `https://developers.facebook.com/apps/${c.fbAppId}/app-review/permissions/`
    };
  }

  // 4. Token expired / invalid.
  if (c.probeError.code === 190 || c.metaError.code === 190) {
    return {
      kind: 'token_expired',
      suggestion: 'Token FB hết hạn hoặc không còn valid. Vào Facebook → Disconnect, rồi connect lại.',
      fixUrl: null
    };
  }

  // 5. Other — pass through the FB message.
  return {
    kind: 'unknown_error',
    suggestion: `FB error code ${c.probeError.code ?? c.metaError.code ?? 'n/a'}: ${c.probeError.message || c.metaError.message || 'no detail'}`,
    fixUrl: null
  };
}
