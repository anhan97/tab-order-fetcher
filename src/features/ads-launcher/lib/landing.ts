/**
 * Landing pages for one select, grouped by domain (§3.2 step 1, §12.2).
 *
 * Each store contributes its product page and its published store pages
 * (advertorials). Item ids are `<storeId>|<optionId>`; picking one fills the
 * store, the URL and the display link (hostname). Pure, no React.
 */
import type { LandingStore } from '@contract/ads-launcher';

export const PRODUCT_OPTION = 'product';
export const CUSTOM_LANDING = 'custom';
export const NOT_PUBLISHED_NOTE = 'product not published';

export interface LandingItem {
  /** `<storeId>|<optionId>` — optionId is `product` or the store page id. */
  id: string;
  storeId: string;
  kind: 'product' | 'page';
  url: string;
  label: string;
  note: string | null;
}

export interface LandingGroup {
  hostname: string;
  storeIds: string[];
  storeName: string | null;
  /** "product not published" when the product is not live on (one of) the group's stores. */
  note: string | null;
  items: LandingItem[];
}

export const landingItemId = (storeId: string, optionId: string) => `${storeId}|${optionId}`;

/** Path part of a URL (`/products/comb`); the raw string when it does not parse. */
export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/** Display link = hostname of the landing URL; '' when it does not parse. */
export function displayLinkFor(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return '';
  }
}

/** "Product page · /products/comb" or "Advertorial · /pages/story". */
export function landingItemLabel(kind: 'product' | 'page', url: string, title?: string | null): string {
  const name = kind === 'product' ? 'Product page' : title?.trim() || 'Store page';
  return `${name} · ${urlPath(url)}`;
}

export function landingGroups(stores: LandingStore[]): LandingGroup[] {
  const groups = new Map<string, LandingGroup>();
  for (const store of stores ?? []) {
    const hostname = (store.hostname || displayLinkFor(store.product?.url ?? '') || store.storeId).toLowerCase();
    let group = groups.get(hostname);
    if (!group) {
      group = { hostname, storeIds: [], storeName: store.storeName ?? null, note: null, items: [] };
      groups.set(hostname, group);
    }
    if (!group.storeIds.includes(store.storeId)) group.storeIds.push(store.storeId);

    const p = store.product;
    if (p?.url) {
      const unpublished = p.listingStatus !== 'active';
      if (unpublished) group.note = NOT_PUBLISHED_NOTE;
      group.items.push({
        id: landingItemId(store.storeId, PRODUCT_OPTION),
        storeId: store.storeId,
        kind: 'product',
        url: p.url,
        label: landingItemLabel('product', p.url),
        note: unpublished ? NOT_PUBLISHED_NOTE : null,
      });
    }
    for (const page of store.pages ?? []) {
      if (!page?.url) continue;
      group.items.push({
        id: landingItemId(store.storeId, page.id),
        storeId: store.storeId,
        kind: 'page',
        url: page.url,
        label: landingItemLabel('page', page.url, page.title),
        note: null,
      });
    }
  }
  return [...groups.values()].filter((g) => g.items.length > 0);
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

/** The item matching a URL, preferring the given store; null = custom URL. */
export function findLanding(groups: LandingGroup[], url: string, storeId?: string | null): LandingItem | null {
  if (!url?.trim()) return null;
  const all = groups.flatMap((g) => g.items);
  const matches = all.filter((i) => sameUrl(i.url, url));
  return matches.find((i) => storeId && i.storeId === storeId) ?? matches[0] ?? null;
}

export function landingById(groups: LandingGroup[], id: string): LandingItem | null {
  for (const g of groups) {
    const hit = g.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The page to pre-select: the remembered store's product page (else its
 * first page), else the only item there is. Null = let the user choose.
 */
export function defaultLanding(groups: LandingGroup[], rememberedStoreId?: string | null): LandingItem | null {
  const all = groups.flatMap((g) => g.items);
  if (rememberedStoreId) {
    const ofStore = all.filter((i) => i.storeId === rememberedStoreId);
    const pick = ofStore.find((i) => i.kind === 'product') ?? ofStore[0];
    if (pick) return pick;
  }
  return all.length === 1 ? all[0] : null;
}
