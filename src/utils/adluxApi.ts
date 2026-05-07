/**
 * Frontend client for Adlux multi-tenant FB endpoints.
 *
 * All routes go through Vite's `/api` proxy → Express backend → FB API,
 * so no FB tokens ever touch the browser. The backend's `resolveStore`
 * middleware uses the Shopify connection headers to identify the user, so
 * the same auth works here as elsewhere in the app.
 */

export interface AdluxAdAccount {
  accountId: string;       // act_id WITHOUT 'act_' prefix
  accountName: string;
  poolIndex: number;
  status: string;          // assigned | pending | failed | removed
  accountStatus: number | null;  // FB code: 1=ACTIVE, 2=DISABLED, ...
  currency: string | null;
  timezone: string | null;
  role: string;            // viewer | manager | admin
  isFavorite: boolean;
}

export interface AdluxSyncReport {
  poolSize: number;
  discovered: number;
  assigned: number;
  alreadyAssigned: number;
  failed: number;
  errors: Array<{ accountId: string; error: string }>;
}

export interface AdluxSyncStatus {
  cache: { size: number; entries: Array<{ key: string; expiresInMs: number }> };
  quota: Record<string, any>;
  pool: { size: number; configured: boolean };
  scheduler: {
    bmId: string | null;
    poolSize: number;
    syncIntervalSec: number;
    syncInProgress: boolean;
    lastSyncReport: any;
    lastSnapshotReport: any;
    nextSnapshotInMs: number | null;
  };
}

interface ShopifyAuth {
  storeUrl: string;
  accessToken: string;
}

function authHeaders(auth: ShopifyAuth): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Store-Domain': auth.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    'X-Shopify-Access-Token': auth.accessToken
  };
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body as T;
}

export const AdluxApi = {
  /** List ad accounts the current user has been granted access to. */
  async myAccounts(auth: ShopifyAuth): Promise<{ accounts: AdluxAdAccount[] }> {
    const res = await fetch('/api/facebook/my-accounts', { headers: authHeaders(auth) });
    return jsonOrThrow(res);
  },

  /** Manually claim one account (admin onboarding). */
  async claim(auth: ShopifyAuth, accountId: string, role: string = 'admin'): Promise<{ ok: true }> {
    const res = await fetch('/api/facebook/claim-account', {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({ accountId, role })
    });
    return jsonOrThrow(res);
  },

  /** List every ad account in Adlux BM, with hasAccess flag for current user. */
  async adluxAccounts(auth: ShopifyAuth): Promise<{
    accounts: Array<{
      accountId: string;
      accountName: string;
      status: string;
      accountStatus: number | null;
      currency: string | null;
      hasAccess: boolean;
    }>;
  }> {
    const res = await fetch('/api/facebook/adlux-accounts', { headers: authHeaders(auth) });
    return jsonOrThrow(res);
  },

  /** Bulk-claim multiple accounts at once. */
  async claimBulk(auth: ShopifyAuth, accountIds: string[]): Promise<{ ok: true; claimed: number }> {
    const res = await fetch('/api/facebook/claim-accounts-bulk', {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({ accountIds })
    });
    return jsonOrThrow(res);
  },

  /** Auto-claim every account from the user's own FB Business. */
  async autoClaim(auth: ShopifyAuth, fbBusinessId: string): Promise<{
    claimed: Array<{ accountId: string; accountName: string }>;
    totalScanned: number;
  }> {
    const res = await fetch('/api/facebook/auto-claim', {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({ fbBusinessId })
    });
    return jsonOrThrow(res);
  },

  async unclaim(auth: ShopifyAuth, accountId: string): Promise<{ ok: true }> {
    const res = await fetch(`/api/facebook/unclaim-account?accountId=${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
      headers: authHeaders(auth)
    });
    return jsonOrThrow(res);
  },

  async setFavorite(auth: ShopifyAuth, accountId: string, isFavorite: boolean): Promise<{ ok: true }> {
    const res = await fetch('/api/facebook/account-favorite', {
      method: 'PUT',
      headers: authHeaders(auth),
      body: JSON.stringify({ accountId, isFavorite })
    });
    return jsonOrThrow(res);
  },

  /** Force a BM sync immediately (admin / manual onboarding). */
  async syncBm(): Promise<AdluxSyncReport> {
    const res = await fetch('/api/facebook/sync-bm', { method: 'POST' });
    return jsonOrThrow(res);
  },

  /** Diagnostics + scheduler status. */
  async syncStatus(): Promise<AdluxSyncStatus> {
    const res = await fetch('/api/facebook/sync-status');
    return jsonOrThrow(res);
  }
};
