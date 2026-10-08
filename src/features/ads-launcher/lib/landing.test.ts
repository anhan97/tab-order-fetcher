import { describe, expect, it } from 'vitest';
import type { LandingStore } from '@contract/ads-launcher';
import {
  NOT_PUBLISHED_NOTE,
  defaultLanding,
  displayLinkFor,
  findLanding,
  landingById,
  landingGroups,
  landingItemLabel
} from './landing';

const store = (over: Partial<LandingStore> & { storeId: string; hostname: string }): LandingStore => ({
  storeName: null,
  product: { productId: 'p1', handle: 'comb', title: 'Comb', url: `https://${over.hostname}/products/comb`, listingStatus: 'active' },
  pages: [],
  ...over
});

const STORES: LandingStore[] = [
  store({ storeId: 's1', hostname: 'shop-a.com', pages: [{ id: 'pg1', title: 'Advertorial', url: 'https://shop-a.com/pages/story' }] }),
  store({
    storeId: 's2',
    hostname: 'shop-b.com',
    product: { productId: 'p1', handle: 'comb-2', title: 'Comb', url: 'https://shop-b.com/products/comb-2', listingStatus: 'draft' }
  }),
  store({ storeId: 's3', hostname: 'shop-c.com', pages: [{ id: 'pg3', title: '', url: 'https://shop-c.com/pages/faq' }] })
];

describe('landingGroups', () => {
  it('groups by hostname with ids <storeId>|<optionId>', () => {
    const groups = landingGroups(STORES);
    expect(groups.map(g => g.hostname)).toEqual(['shop-a.com', 'shop-b.com', 'shop-c.com']);
    expect(groups[0].items.map(i => i.id)).toEqual(['s1|product', 's1|pg1']);
    expect(groups[0].items.map(i => i.label)).toEqual(['Product page · /products/comb', 'Advertorial · /pages/story']);
  });

  it('notes a product that is not published on that store', () => {
    const groups = landingGroups(STORES);
    expect(groups[0].note).toBeNull();
    expect(groups[1].note).toBe(NOT_PUBLISHED_NOTE);
    expect(groups[1].items[0].note).toBe('product not published');
  });

  it('merges stores that share a hostname and skips empty stores', () => {
    const groups = landingGroups([
      store({ storeId: 'x1', hostname: 'Shop.com' }),
      store({ storeId: 'x2', hostname: 'shop.com', product: null, pages: [{ id: 'p', title: 'Story', url: 'https://shop.com/pages/s' }] }),
      store({ storeId: 'x3', hostname: 'empty.com', product: null, pages: [] })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].storeIds).toEqual(['x1', 'x2']);
    expect(groups[0].items.map(i => i.id)).toEqual(['x1|product', 'x2|p']);
  });

  it('labels untitled pages', () => {
    expect(landingGroups(STORES)[2].items[1].label).toBe('Store page · /pages/faq');
    expect(landingItemLabel('page', 'https://a.com/pages/x', 'Story')).toBe('Story · /pages/x');
  });
});

describe('findLanding', () => {
  const groups = landingGroups(STORES);
  it('matches a URL, ignoring a trailing slash and case', () => {
    expect(findLanding(groups, 'https://shop-b.com/products/comb-2/', null)?.id).toBe('s2|product');
    expect(findLanding(groups, 'https://SHOP-A.com/pages/story', 's1')?.id).toBe('s1|pg1');
  });
  it('prefers the given store when two stores share a URL', () => {
    const shared = landingGroups([
      store({ storeId: 'a', hostname: 'same.com' }),
      store({ storeId: 'b', hostname: 'same.com' })
    ]);
    expect(findLanding(shared, 'https://same.com/products/comb', 'b')?.id).toBe('b|product');
    expect(findLanding(shared, 'https://same.com/products/comb', null)?.id).toBe('a|product');
  });
  it('returns null for a custom URL', () => {
    expect(findLanding(groups, 'https://elsewhere.com/x', 's1')).toBeNull();
    expect(findLanding(groups, '', 's1')).toBeNull();
  });
  it('looks items up by id', () => {
    expect(landingById(groups, 's3|pg3')?.url).toBe('https://shop-c.com/pages/faq');
    expect(landingById(groups, 'nope')).toBeNull();
  });
});

describe('defaultLanding / displayLinkFor', () => {
  const groups = landingGroups(STORES);
  it('picks the remembered store product page, else the only item', () => {
    expect(defaultLanding(groups, 's2')?.id).toBe('s2|product');
    expect(defaultLanding(groups, 'gone')).toBeNull();
    expect(defaultLanding(landingGroups([store({ storeId: 'z', hostname: 'z.com' })]), null)?.id).toBe('z|product');
  });
  it('uses the hostname as display link', () => {
    expect(displayLinkFor('https://www.shop-a.com/products/comb?x=1')).toBe('www.shop-a.com');
    expect(displayLinkFor('not a url')).toBe('');
  });
});
