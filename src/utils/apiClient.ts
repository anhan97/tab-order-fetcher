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
// Retired keys from the pre-JWT "paste your Admin API token" flow. Nothing
// writes them any more, but a browser that ran an older build still holds
// them — and they used to survive logout, leaking the previous merchant's
// store (and token) into the next session. clear() evicts them for good.
const LEGACY_KEYS = ['shopify_store_url', 'shopify_access_token'];

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

/**
 * Headers for the call sites that still use bare `fetch` against store-scoped
 * backend routes.
 *
 * Those sites used to authenticate purely by echoing the store's Admin API
 * token in `X-Shopify-Access-Token`. That silently stopped working for anyone
 * operating a store granted to them rather than owned: they hold no token, so
 * the header went out EMPTY and the backend answered 401 on every call. The
 * Bearer JWT is the identity now; the legacy token is only sent when we
 * actually have one, because an empty value reads as a failed legacy attempt.
 *
 * Prefer apiFetch for new code — it adds refresh-and-retry on top of this.
 */
export function storeHeaders(
  cfg?: { storeUrl?: string | null; accessToken?: string | null } | null,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (cfg?.storeUrl) {
    headers['X-Shopify-Store-Domain'] = cfg.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  if (cfg?.accessToken) {
    headers['X-Shopify-Access-Token'] = cfg.accessToken;
  }
  // Fills in Authorization, plus the active-store domain if not set above.
  return buildHeaders(headers);
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Session refresh. The access JWT lives ~15 minutes; the refresh token 30
 * days, renewed on every refresh — so a session only ends after 30 days
 * without use, or on logout / admin suspend.
 *
 * People used to be signed out after minutes, from three holes:
 *   • a 401 on ANY /api/auth/* call skipped the refresh, and /api/auth/me is
 *     what every page load asks first → reload after 15 min = signed out;
 *   • any failed refresh wiped the session — a 502 while the backend
 *     redeployed, or a second tab losing the race to rotate the token;
 *   • bare fetch() call sites (charts, P&L) never refresh at all.
 *
 * Now: only login/register/refresh/logout skip the retry; the session is
 * dropped only when the server definitively rejects the refresh token AND no
 * other tab has replaced it; refreshes are serialised across tabs (Web
 * Locks); and keepSessionFresh() renews the token before it expires, so bare
 * fetch() calls always carry a valid one.
 */
const NO_REFRESH = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  const sent = localStorage.getItem(REFRESH_KEY);
  if (!sent) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: sent })
    });
    if (res.ok) {
      const body = await res.json();
      if (body?.token) localStorage.setItem(TOKEN_KEY, body.token);
      if (body?.refreshToken) localStorage.setItem(REFRESH_KEY, body.refreshToken);
      return !!body?.token;
    }
    // Another tab rotated the token meanwhile: its fresh pair is in storage.
    if (localStorage.getItem(REFRESH_KEY) !== sent) return true;
    // Only a definitive "this refresh token is no good" ends the session —
    // never a 5xx / 502 while the backend restarts.
    if (res.status === 400 || res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
    return false;
  } catch {
    return false; // offline — keep the session, try again later
  }
}

/**
 * Single-flight per tab, serialised across tabs. `staleToken` is the access
 * token that just failed: if storage already holds another one, a different
 * tab refreshed while we waited and there is nothing to do.
 */
function tryRefresh(staleToken?: string | null): Promise<boolean> {
  if (!refreshInFlight) {
    const run = async () => {
      if (staleToken !== undefined && localStorage.getItem(TOKEN_KEY) && localStorage.getItem(TOKEN_KEY) !== staleToken) return true;
      return refreshOnce();
    };
    const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
    refreshInFlight = (locks?.request ? (locks.request('auth-refresh', run) as Promise<boolean>) : run())
      .catch(() => false)
      .finally(() => {
        // Allow the next 401 to trigger a fresh attempt.
        setTimeout(() => { refreshInFlight = null; }, 0);
      });
  }
  return refreshInFlight;
}

function jwtTimes(token: string | null): { iat: number | null; exp: number | null } {
  if (!token) return { iat: null, exp: null };
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      iat: typeof json?.iat === 'number' ? json.iat * 1000 : null,
      exp: typeof json?.exp === 'number' ? json.exp * 1000 : null
    };
  } catch {
    return { iat: null, exp: null };
  }
}

/** Expiry (ms epoch) of an access JWT, null when it cannot be read. */
export function tokenExpiry(token: string | null): number | null {
  return jwtTimes(token).exp;
}

const RENEW_BEFORE_MS = 60_000;
const MIN_RENEW_WAIT_MS = 5_000;
const RETRY_RENEW_MS = 30_000;

/**
 * When to renew: a minute before expiry, or half-way through a token that
 * lives under two minutes — never a refresh loop.
 */
export function renewDelay(token: string | null, now = Date.now()): number | null {
  const { iat, exp } = jwtTimes(token);
  if (!exp) return null;
  const lead = iat ? Math.min(RENEW_BEFORE_MS, (exp - iat) / 2) : RENEW_BEFORE_MS;
  return Math.max(exp - lead - now, exp > now ? MIN_RENEW_WAIT_MS : 0);
}

/**
 * Renew the access token a minute before it expires — and right away when a
 * tab comes back from the background with an expired one. Returns a stop
 * function. AuthProvider runs it while someone is signed in.
 */
export function keepSessionFresh(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const renewAfter = (token: string | null, wait: number) => {
    timer = setTimeout(async () => {
      if (await tryRefresh(token)) schedule();
      // Offline or the backend is down: try again later, not in a loop.
      else if (localStorage.getItem(REFRESH_KEY)) renewAfter(localStorage.getItem(TOKEN_KEY), RETRY_RENEW_MS);
    }, wait);
  };
  const schedule = () => {
    clearTimeout(timer);
    const token = localStorage.getItem(TOKEN_KEY);
    const wait = renewDelay(token);
    if (wait == null || !localStorage.getItem(REFRESH_KEY)) return;
    renewAfter(token, wait);
  };
  const onWake = () => { if (document.visibilityState === 'visible') schedule(); };
  // Another tab refreshed (or signed out): follow its token.
  const onStorage = (e: StorageEvent) => { if (e.key === TOKEN_KEY) schedule(); };
  schedule();
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('storage', onStorage);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('storage', onStorage);
  };
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

  const sentToken = localStorage.getItem(TOKEN_KEY);
  let { res, body } = await doFetch();
  // Access tokens are short-lived (~15m) — transparently refresh + retry once.
  // /api/auth/me and /api/auth/stores too: they are what a page load asks first.
  if (res.status === 401 && !NO_REFRESH.some(p => path.split('?')[0].startsWith(p))) {
    if (await tryRefresh(sentToken)) {
      ({ res, body } = await doFetch());
    }
  }
  if (!res.ok) {
    // Take the most specific thing the server said. Some routes answer with a
    // generic `error` plus the real reason in `details`; showing only the
    // former turned every failure into "Failed to update order tracking".
    const obj = body && typeof body === 'object' ? body : null;
    const parts = [obj?.error, obj?.details, obj?.message]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const unique = parts.filter((v, i) => parts.findIndex(p => p === v || v.includes(p)) === i);
    const msg = unique.join(' — ') || `${res.status} ${res.statusText}`;
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
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
  }
};
