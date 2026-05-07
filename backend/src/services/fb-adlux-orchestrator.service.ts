/**
 * High-level orchestrator that ties BM sync + DB persistence together.
 *
 * Two top-level operations:
 *   - syncAndPersist: pull /client_ad_accounts, auto-assign each to a pool
 *     slot, and upsert the result into FacebookAdAccountAssignment so the
 *     frontend can list them.
 *   - autoClaimForUser: given a user + their FB business id, find every
 *     account in our BM that came from that business and grant the user
 *     access. Lets users self-onboard once they've shared their BM.
 */

import { syncAdluxBm, listClientAdAccounts } from './fb-bm-management.service';
import { upsertAssignment, grantAccess } from './fb-access.service';
import * as pool from './fb-system-token.service';
import fetch from 'node-fetch';
import { FACEBOOK_CONFIG } from '../config/facebook';

const FB_API = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

export interface SyncReport {
  poolSize: number;
  discovered: number;
  assigned: number;
  alreadyAssigned: number;
  failed: number;
  errors: Array<{ accountId: string; error: string }>;
}

/**
 * Run the BM sync + persist results to DB. Idempotent — safe to run on a
 * loop. Errors per-account don't abort the sweep.
 */
export async function syncAndPersist(adluxBmId: string): Promise<SyncReport> {
  const result = await syncAdluxBm(adluxBmId);

  const report: SyncReport = {
    poolSize: result.poolSize,
    discovered: result.discovered.length,
    assigned: 0,
    alreadyAssigned: 0,
    failed: 0,
    errors: []
  };

  for (let i = 0; i < result.discovered.length; i++) {
    const acc = result.discovered[i];
    const assignment = result.assignments[i];

    if (!assignment.ok) {
      report.failed++;
      report.errors.push({ accountId: acc.account_id || acc.id, error: assignment.error || 'unknown' });
      // Still upsert, just with failed status so we can retry later.
      try {
        await upsertAssignment({
          accountId: acc.account_id || acc.id.replace(/^act_/, ''),
          accountName: acc.name,
          poolIndex: assignment.poolIndex,
          systemUserId: assignment.systemUserId || '',
          status: 'failed',
          accountStatus: acc.account_status,
          currency: acc.currency,
          timezone: acc.timezone_name,
          lastError: assignment.error
        });
      } catch (dbErr: any) {
        report.errors.push({ accountId: acc.account_id || acc.id, error: `DB: ${dbErr.message}` });
      }
      continue;
    }

    if (assignment.error === 'already_assigned') report.alreadyAssigned++;
    else report.assigned++;

    try {
      await upsertAssignment({
        accountId: acc.account_id || acc.id.replace(/^act_/, ''),
        accountName: acc.name,
        poolIndex: assignment.poolIndex,
        systemUserId: assignment.systemUserId,
        status: 'assigned',
        accountStatus: acc.account_status,
        currency: acc.currency,
        timezone: acc.timezone_name
      });
    } catch (dbErr: any) {
      report.errors.push({ accountId: acc.account_id || acc.id, error: `DB upsert: ${dbErr.message}` });
    }
  }

  return report;
}

/**
 * Find every account in our BM whose source `business.id` matches the user's
 * own FB Business ID, and grant them access. Used during user onboarding
 * after they share their BM to Adlux.
 *
 * Returns list of accounts auto-claimed.
 */
export async function autoClaimForUser(userId: string, userFbBusinessId: string, adluxBmId: string): Promise<{
  claimed: Array<{ accountId: string; accountName: string }>;
  totalScanned: number;
}> {
  if (!pool.isPoolConfigured()) throw new Error('System token pool empty');
  const token = pool.allMembers()[0].token;

  // Re-query with the source business field — needed to filter to this user's
  // BM-shared accounts only.
  const params = new URLSearchParams({
    fields: 'id,account_id,name,business{id}',
    limit: '500',
    access_token: token
  });
  const url = `${FB_API}/${adluxBmId}/client_ad_accounts?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list client accounts: ${await res.text()}`);
  }
  const data = await res.json() as { data?: Array<{ id: string; account_id: string; name: string; business?: { id: string } }> };
  const all = data.data || [];

  const matching = all.filter(a => a.business?.id === userFbBusinessId);
  const claimed: Array<{ accountId: string; accountName: string }> = [];

  for (const acc of matching) {
    try {
      const cleanId = acc.account_id || acc.id.replace(/^act_/, '');
      await grantAccess(userId, cleanId, 'admin');
      claimed.push({ accountId: cleanId, accountName: acc.name });
    } catch (err) {
      console.warn(`Failed to grant access for ${acc.id}:`, err);
    }
  }

  return { claimed, totalScanned: all.length };
}

/**
 * Convenience alias used by the cron scheduler.
 */
export { listClientAdAccounts };
