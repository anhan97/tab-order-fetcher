/**
 * BM (Business Manager) management for Adlux.
 *
 * Two responsibilities:
 *   1. DISCOVER: scan Adlux BM /client_ad_accounts to find ad accounts that
 *      a user has shared into our BM. The actual sharing happens on the
 *      user's side (their BM Settings → Partners → Share access) — FB has
 *      no API for us to trigger that. But once shared, the account appears
 *      in our /client_ad_accounts list immediately.
 *
 *   2. AUTO-ASSIGN: for each newly-discovered account, pick a pool slot via
 *      consistent hash, look up the system_user_id, and POST to the account's
 *      /assigned_users endpoint to grant the system user ANALYZE+ADVERTISE
 *      tasks. After this the system_user_token can fetch /act_<id>/insights.
 *
 * Errors are swallowed per-account so one bad account doesn't kill the whole
 * sweep — they're returned in the result so the caller can log/notify.
 */

import fetch from 'node-fetch';
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as pool from './fb-system-token.service';

const FB_API = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

export interface ClientAdAccount {
  id: string;            // FB account id WITH 'act_' prefix as returned
  account_id: string;    // numeric id without prefix
  name: string;
  account_status: number; // 1 = active, 2 = disabled, 3 = unsettled, 7 = pending review, 9 = grey, 100/101/102/103 = various closed
  currency?: string;
  timezone_name?: string;
}

export interface AssignmentResult {
  accountId: string;
  poolIndex: number;
  systemUserId: string;
  ok: boolean;
  error?: string;
}

/**
 * List every ad account currently shared TO Adlux BM (client + owned).
 *
 * Uses the FIRST pool token because /client_ad_accounts is a BM-level read
 * any system user in the BM can do — pool slot doesn't matter here.
 */
export async function listClientAdAccounts(adluxBmId: string): Promise<ClientAdAccount[]> {
  if (!pool.isPoolConfigured()) throw new Error('No system tokens configured');
  const token = pool.allMembers()[0].token;

  const all: ClientAdAccount[] = [];
  // Query BOTH client_ad_accounts (shared in via Partner) and owned_ad_accounts
  // (Adlux owns) — combined, that's everything reachable.
  const endpoints = ['client_ad_accounts', 'owned_ad_accounts'];

  for (const endpoint of endpoints) {
    const params = new URLSearchParams({
      fields: 'id,account_id,name,account_status,currency,timezone_name',
      limit: '500',
      access_token: token
    });
    let url: string | null = `${FB_API}/${adluxBmId}/${endpoint}?${params}`;
    let pages = 0;
    while (url && pages < 50) {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to list ${endpoint}: ${res.status} ${text.slice(0, 300)}`);
      }
      const json = await res.json() as { data?: ClientAdAccount[]; paging?: { next?: string } };
      if (json.data) all.push(...json.data);
      url = json.paging?.next || null;
      pages++;
    }
  }
  return all;
}

/**
 * Assign an ad account to a system user with the given tasks.
 * Tasks: ANALYZE (read insights), ADVERTISE (create campaigns), MANAGE (full edit).
 * Default ANALYZE+ADVERTISE — read & manage campaigns but no Business asset changes.
 */
export async function assignAccountToSystemUser(
  accountId: string,
  poolIndex: number,
  tasks: string[] = ['ANALYZE', 'ADVERTISE']
): Promise<AssignmentResult> {
  const member = pool.memberByIndex(poolIndex);
  if (!member) {
    return { accountId, poolIndex, systemUserId: '', ok: false, error: `Pool slot ${poolIndex} not configured` };
  }

  try {
    const systemUserId = await pool.getSystemUserId(poolIndex, fetch as any);
    const cleanAccount = accountId.replace(/^act_/, '');

    // POST act_<id>/assigned_users with user + tasks. The token used here
    // must belong to a BM admin or system user with manage rights — all
    // pool members have BM-level access so any works.
    const params = new URLSearchParams({
      user: systemUserId,
      tasks: JSON.stringify(tasks),
      access_token: member.token
    });
    const url = `${FB_API}/act_${cleanAccount}/assigned_users`;
    const res = await fetch(url, { method: 'POST', body: params });

    if (!res.ok) {
      const text = await res.text();
      // Idempotency: assigning an already-assigned account returns an error
      // we can safely ignore. Code 100 subcode 1487144 = "already assigned".
      let errBody: any;
      try { errBody = JSON.parse(text); } catch { /* ignore */ }
      const code = errBody?.error?.code;
      const sub = errBody?.error?.error_subcode;
      const msg = errBody?.error?.message || text.slice(0, 200);
      if (code === 100 && (sub === 1487144 || /already/.test(msg))) {
        return { accountId, poolIndex, systemUserId, ok: true, error: 'already_assigned' };
      }
      return { accountId, poolIndex, systemUserId, ok: false, error: `${code}/${sub}: ${msg}` };
    }

    return { accountId, poolIndex, systemUserId, ok: true };
  } catch (err: any) {
    return { accountId, poolIndex, systemUserId: '', ok: false, error: err.message || String(err) };
  }
}

/**
 * Top-level reconciliation:
 *   1. List all accounts visible to Adlux BM.
 *   2. For each, hash → pool slot → assign to system user.
 *   3. Return the full state so callers can persist to DB and notify users.
 *
 * Safe to call repeatedly — assignments are idempotent.
 */
export interface SyncResult {
  discovered: ClientAdAccount[];
  assignments: AssignmentResult[];
  poolSize: number;
}

export async function syncAdluxBm(adluxBmId: string): Promise<SyncResult> {
  if (!pool.isPoolConfigured()) {
    throw new Error('System token pool empty — set FB_SYSTEM_TOKEN_1..N before running BM sync');
  }

  const accounts = await listClientAdAccounts(adluxBmId);

  // Dedupe (an account could appear under both client and owned in some setups).
  const seen = new Set<string>();
  const unique = accounts.filter(a => {
    const key = a.account_id || a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const assignments: AssignmentResult[] = [];
  for (const acc of unique) {
    const accId = acc.account_id || acc.id.replace(/^act_/, '');
    const idx = pool.poolIndexForAccount(accId);
    const result = await assignAccountToSystemUser(accId, idx);
    assignments.push(result);
  }

  return {
    discovered: unique,
    assignments,
    poolSize: pool.poolSize()
  };
}
