/**
 * Sessions must last as long as the refresh token (30 days, renewed on use).
 * These pin the ways people used to get signed out after minutes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, renewDelay, tokenExpiry } from './apiClient';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const jwtWithExp = (expSec: number) => `h.${btoa(JSON.stringify({ id: 'u1', exp: expSec }))}.s`;

const fetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>;
const calls = () => fetchMock().mock.calls.map(c => String(c[0]));

beforeEach(async () => {
  // The single-flight refresh is released on the next tick: let the previous test's go.
  await new Promise(r => setTimeout(r, 0));
  localStorage.clear();
  fetchMock().mockReset();
  localStorage.setItem('auth_token', 'old-access');
  localStorage.setItem('auth_refresh_token', 'refresh-1');
});

describe('apiFetch session refresh', () => {
  it('/api/auth/me refreshes on 401 instead of ending the session (page reload after 15 min)', async () => {
    fetchMock()
      .mockResolvedValueOnce(json(401, { error: 'expired' }))
      .mockResolvedValueOnce(json(200, { token: 'new-access', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(200, { user: { id: 'u1' } }));
    await expect(apiFetch('/api/auth/me')).resolves.toEqual({ user: { id: 'u1' } });
    expect(calls()).toEqual(['/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
    expect(localStorage.getItem('auth_token')).toBe('new-access');
    expect(localStorage.getItem('auth_refresh_token')).toBe('refresh-2');
    const retry = fetchMock().mock.calls[2][1] as RequestInit;
    expect((retry.headers as Record<string, string>).Authorization).toBe('Bearer new-access');
  });

  it('a wrong password on login is not "refreshed"', async () => {
    fetchMock().mockResolvedValueOnce(json(401, { error: 'Invalid credentials' }));
    await expect(apiFetch('/api/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow(/Invalid credentials/);
    expect(calls()).toEqual(['/api/auth/login']);
  });

  it('a 502 while the backend redeploys keeps the session', async () => {
    fetchMock()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(502, { error: 'Bad gateway' }));
    await expect(apiFetch('/api/orders')).rejects.toBeTruthy();
    expect(localStorage.getItem('auth_refresh_token')).toBe('refresh-1');
  });

  it('a rejected refresh token ends the session', async () => {
    fetchMock()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(401, { code: 'invalid_refresh' }));
    await expect(apiFetch('/api/orders')).rejects.toBeTruthy();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_refresh_token')).toBeNull();
  });

  it('another tab rotated the token meanwhile: use its token, do not sign out', async () => {
    fetchMock()
      .mockResolvedValueOnce(json(401, {}))
      .mockImplementationOnce(async () => {
        // The other tab won the race and stored its fresh pair first.
        localStorage.setItem('auth_token', 'tab2-access');
        localStorage.setItem('auth_refresh_token', 'refresh-2');
        return json(401, { code: 'invalid_refresh' });
      })
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(apiFetch('/api/orders')).resolves.toEqual({ ok: true });
    expect(localStorage.getItem('auth_refresh_token')).toBe('refresh-2');
    expect(((fetchMock().mock.calls[2][1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer tab2-access');
  });

  it('several 401s at once share one refresh', async () => {
    fetchMock().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') return json(200, { token: 'new-access', refreshToken: 'refresh-2' });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-access' ? json(200, { url }) : json(401, {});
    });
    await Promise.all([apiFetch('/api/a'), apiFetch('/api/b'), apiFetch('/api/c')]);
    expect(calls().filter(u => u === '/api/auth/refresh')).toHaveLength(1);
  });
});

describe('renewDelay', () => {
  const tok = (iatSec: number, expSec: number) => `h.${btoa(JSON.stringify({ iat: iatSec, exp: expSec }))}.s`;
  it('a minute before expiry for a normal 15-minute token', () => {
    expect(renewDelay(tok(1000, 1900), 1000_000)).toBe(840_000);
  });
  it('half-way through a short token — never an immediate loop', () => {
    expect(renewDelay(tok(1000, 1060), 1000_000)).toBe(30_000);
    expect(renewDelay(tok(1000, 1060), 1055_000)).toBe(5_000);
  });
  it('right away when already expired; null without a readable token', () => {
    expect(renewDelay(tok(1000, 1060), 2000_000)).toBe(0);
    expect(renewDelay('garbage')).toBeNull();
  });
});

describe('tokenExpiry', () => {
  it('reads exp from the JWT, null when unreadable', () => {
    expect(tokenExpiry(jwtWithExp(1_800_000_000))).toBe(1_800_000_000_000);
    expect(tokenExpiry('garbage')).toBeNull();
    expect(tokenExpiry(null)).toBeNull();
  });
});
