/**
 * Regression tests for the cross-account store leak.
 *
 * Symptom: user B logs in on a browser that user A had used, and the
 * dashboard opens on A's store — sometimes permanently (B has no store of
 * their own, or B is still PENDING so the store list is never fetched).
 *
 * Cause: `new ShopifyApiClient(...)` persisted storeUrl + accessToken into
 * localStorage as a constructor side effect, `auth.clear()` did not remove
 * them on logout, and AppContext booted its `shopifyConfig` from that pair.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ShopifyApiClient } from './shopifyApi';
import { auth } from './apiClient';

const LEGACY_DOMAIN_KEY = 'shopify_store_url';
const LEGACY_TOKEN_KEY = 'shopify_access_token';

describe('store isolation between accounts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not persist store credentials when a client is constructed', () => {
    new ShopifyApiClient({ storeUrl: 'merchant-a.myshopify.com', accessToken: 'shpat_secret' });

    expect(localStorage.getItem(LEGACY_DOMAIN_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it('auth.clear() evicts credentials left behind by an older build', () => {
    // Simulate a browser that ran the previous version.
    localStorage.setItem(LEGACY_DOMAIN_KEY, 'merchant-a.myshopify.com');
    localStorage.setItem(LEGACY_TOKEN_KEY, 'shpat_secret');
    auth.setToken('jwt-for-a');
    auth.setActiveStore('merchant-a.myshopify.com');

    auth.clear();

    expect(auth.getToken()).toBeNull();
    expect(auth.getActiveStore()).toBeNull();
    expect(localStorage.getItem(LEGACY_DOMAIN_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it('clearLocalStorage() purges the retired pair', () => {
    localStorage.setItem(LEGACY_DOMAIN_KEY, 'merchant-a.myshopify.com');
    localStorage.setItem(LEGACY_TOKEN_KEY, 'shpat_secret');

    ShopifyApiClient.clearLocalStorage();

    expect(localStorage.getItem(LEGACY_DOMAIN_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it('buildHeaders only ever advertises the active store, never a legacy one', async () => {
    const { buildHeaders } = await import('./apiClient');
    localStorage.setItem(LEGACY_DOMAIN_KEY, 'merchant-a.myshopify.com');
    auth.setToken('jwt-for-b');
    auth.setActiveStore('merchant-b.myshopify.com');

    const headers = buildHeaders();

    expect(headers['X-Shopify-Store-Domain']).toBe('merchant-b.myshopify.com');
    expect(headers['Authorization']).toBe('Bearer jwt-for-b');
  });
});
