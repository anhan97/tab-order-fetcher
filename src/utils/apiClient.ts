/**
 * Tiny fetch wrapper that injects the auth Bearer token (when present) and
 * the active-store domain header on every API call. Acts as the single
 * source of truth for "how do I talk to our backend"; replaces the dozen
 * scattered `fetch('/api/...')` invocations spread through the codebase.
 *
 * Reads the JWT from localStorage `auth_token` and the active store from
 * `active_store_domain`. AuthContext owns both keys.
 */

const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'auth_refresh_token';
const STORE_KEY = 'active_store_domain';

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  const storeDomain = localStorage.getItem(STORE_KEY);
  if (storeDomain && !headers['X-Shopify-Store-Domain']) headers['X-Shopify-Store-Domain'] = storeDomain;
  return headers;
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Single-flight refresh: when a request 401s and we hold a refresh token,
 * every concurrent caller awaits the SAME /api/auth/refresh promise, then
 * retries once with the new access token. Refresh failure clears the
 * session (the refresh token was rotated/revoked/expired).
 */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (!refreshToken) return false;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
          return false;
        }
        const body = await res.json();
        if (body?.token) localStorage.setItem(TOKEN_KEY, body.token);
        if (body?.refreshToken) localStorage.setItem(REFRESH_KEY, body.refreshToken);
        return !!body?.token;
      } catch {
        return false;
      } finally {
        // Allow the next 401 to trigger a fresh attempt.
        setTimeout(() => { refreshInFlight = null; }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  // Don't set Content-Type for FormData — browser will set it (with the
  // multipart boundary). Setting it manually breaks the upload.
  const baseHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  const doFetch = async () => {
    const headers = buildHeaders({ ...baseHeaders, ...(init.headers as Record<string, string> || {}) });
    // Strip a stale explicit Authorization so the retry picks up the
    // refreshed token from localStorage via buildHeaders.
    const res = await fetch(path, { ...init, headers });
    const body = await parse(res);
    return { res, body };
  };

  let { res, body } = await doFetch();
  // Access tokens are short-lived (~15m) — transparently refresh + retry once.
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await tryRefresh()) {
      ({ res, body } = await doFetch());
    }
  }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && body.error) || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const auth = {
  setToken(token: string | null) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  },
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  setRefreshToken(token: string | null) {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  },
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  setActiveStore(domain: string | null) {
    if (domain) localStorage.setItem(STORE_KEY, domain);
    else localStorage.removeItem(STORE_KEY);
  },
  getActiveStore(): string | null {
    return localStorage.getItem(STORE_KEY);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(STORE_KEY);
  }
};
