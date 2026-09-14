/**
 * Regression: a "manager" (someone granted a store they don't own) got 401 on
 * every store-scoped call.
 *
 * Those call sites authenticated by echoing the store's Admin API token back
 * in `X-Shopify-Access-Token`. Members hold no token by design — the backend
 * resolves the owner's token from the JWT — so the header went out EMPTY, the
 * server read that as a failed legacy-auth attempt, and answered
 *   401 {"error":"Authentication required (Bearer JWT or X-Shopify-Access-Token)"}
 * No `Authorization` header was ever attached by these clients.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storeHeaders, auth } from './apiClient';
import { ShopifyApiClient } from './shopifyApi';

describe('storeHeaders', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.setToken('jwt-for-the-member');
  });

  it('always attaches the Bearer token', () => {
    const h = storeHeaders({ storeUrl: 'shop.myshopify.com', accessToken: '' });
    expect(h['Authorization']).toBe('Bearer jwt-for-the-member');
  });

  it('omits X-Shopify-Access-Token entirely when there is none', () => {
    const h = storeHeaders({ storeUrl: 'shop.myshopify.com', accessToken: '' });
    // Present-but-empty is what caused the 401 — absent is the fix.
    expect('X-Shopify-Access-Token' in h).toBe(false);
  });

  it('still sends the legacy token for a store we own', () => {
    const h = storeHeaders({ storeUrl: 'shop.myshopify.com', accessToken: 'shpat_real' });
    expect(h['X-Shopify-Access-Token']).toBe('shpat_real');
    expect(h['Authorization']).toBe('Bearer jwt-for-the-member');
  });

  it('normalises the store domain and keeps extra headers', () => {
    const h = storeHeaders(
      { storeUrl: 'https://shop.myshopify.com/', accessToken: null },
      { 'X-Tz': 'America/Los_Angeles' }
    );
    expect(h['X-Shopify-Store-Domain']).toBe('shop.myshopify.com');
    expect(h['X-Tz']).toBe('America/Los_Angeles');
  });

  it('falls back to the active store when no config is given', () => {
    auth.setActiveStore('active.myshopify.com');
    const h = storeHeaders(null);
    expect(h['X-Shopify-Store-Domain']).toBe('active.myshopify.com');
    expect(h['Authorization']).toBe('Bearer jwt-for-the-member');
  });
});

describe('ShopifyApiClient authenticates as the signed-in user', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.setToken('jwt-for-the-member');
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ orders: [] })
    })) as any;
  });

  const sentHeaders = (): Record<string, string> => {
    const call = (global.fetch as any).mock.calls[0];
    return call[1].headers as Record<string, string>;
  };

  it('sends the Bearer token for a member with no store token', async () => {
    const client = new ShopifyApiClient({ storeUrl: 'granted.myshopify.com', accessToken: '' });
    await client.getOrders({ limit: 10 });

    const h = sentHeaders();
    expect(h['Authorization']).toBe('Bearer jwt-for-the-member');
    expect(h['X-Shopify-Store-Domain']).toBe('granted.myshopify.com');
    expect('X-Shopify-Access-Token' in h).toBe(false);
  });

  it('sends both for an owner', async () => {
    const client = new ShopifyApiClient({ storeUrl: 'owned.myshopify.com', accessToken: 'shpat_real' });
    await client.getOrders({ limit: 10 });

    const h = sentHeaders();
    expect(h['Authorization']).toBe('Bearer jwt-for-the-member');
    expect(h['X-Shopify-Access-Token']).toBe('shpat_real');
  });

  it('targets its own store, not whatever the active-store key says', async () => {
    auth.setActiveStore('some-other.myshopify.com');
    const client = new ShopifyApiClient({ storeUrl: 'granted.myshopify.com', accessToken: '' });
    await client.getOrders({ limit: 10 });

    expect(sentHeaders()['X-Shopify-Store-Domain']).toBe('granted.myshopify.com');
  });
});
