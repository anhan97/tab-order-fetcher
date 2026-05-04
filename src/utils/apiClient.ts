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

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
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

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  // Don't set Content-Type for FormData — browser will set it (with the
  // multipart boundary). Setting it manually breaks the upload.
  const baseHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  const headers = buildHeaders({ ...baseHeaders, ...(init.headers as Record<string, string> || {}) });
  const res = await fetch(path, { ...init, headers });
  const body = await parse(res);
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
  setActiveStore(domain: string | null) {
    if (domain) localStorage.setItem(STORE_KEY, domain);
    else localStorage.removeItem(STORE_KEY);
  },
  getActiveStore(): string | null {
    return localStorage.getItem(STORE_KEY);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STORE_KEY);
  }
};
