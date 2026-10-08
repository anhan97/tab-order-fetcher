/**
 * The bits of a Shopify store the launcher needs: products (for the creative
 * library) and landing pages (product page + published store pages, §7.2).
 *
 * Shopify is the source of truth, cached 5 minutes per store. When Shopify is
 * unreachable (token revoked, outage) products fall back to the variants this
 * app already synced, so the library keeps working.
 */
import { PrismaClient } from '@prisma/client';
import { decryptToken } from '../lib/token-crypto';
import type { LandingStore, ProductOption } from './contract';
import { prisma } from './prisma-launch-repo';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const TTL_MS = 5 * 60_000;

export interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  code: string;
  imageUrl: string | null;
  status: string;
  publishedAt: string | null;
}

interface StoreRef {
  id: string;
  storeDomain: string;
  accessToken: string;
  name: string | null;
}

const FAIL_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value?: unknown; error?: Error }>();

/** Successes are kept 5 min; failures 1 min, so a dead store isn't re-asked on every click. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && !hit.error && Date.now() - hit.at < TTL_MS) return hit.value as T;
  if (hit?.error && Date.now() - hit.at < FAIL_TTL_MS) throw hit.error;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    cache.set(key, { at: Date.now(), error: e as Error });
    throw e;
  }
}

export function clearCatalogCache(): void {
  cache.clear();
}

async function shopifyGet(store: StoreRef, pathAndQuery: string): Promise<{ json: any; link: string | null }> {
  const res = await fetch(`https://${store.storeDomain}/admin/api/${API_VERSION}/${pathAndQuery}`, {
    headers: { 'X-Shopify-Access-Token': decryptToken(store.accessToken), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res) throw new Error('Shopify unreachable');
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${pathAndQuery.split('?')[0]}`);
  return { json: await res.json(), link: res.headers.get('link') };
}

/**
 * Product code for creative names: the common prefix of the variant SKUs
 * ("SINLTB071SHNA-S", "SINLTB071SHNA-M" → "SINLTB071SHNA"), else the first SKU,
 * else the handle.
 */
export function productCode(skus: Array<string | null | undefined>, handle: string): string {
  const list = skus.map(s => (s || '').trim()).filter(Boolean);
  let code = '';
  if (list.length > 0) {
    let prefix = list[0];
    for (const s of list.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
      prefix = prefix.slice(0, i);
    }
    prefix = prefix.replace(/[-_\s./]+$/, '');
    code = prefix.length >= 3 ? prefix : list[0];
  }
  if (!code) code = handle.toUpperCase();
  return code.replace(/\|/g, '/').slice(0, 64);
}

function toProduct(p: any): CatalogProduct {
  return {
    id: String(p.id),
    title: p.title || String(p.id),
    handle: p.handle || '',
    code: productCode((p.variants || []).map((v: any) => v.sku), p.handle || String(p.id)),
    imageUrl: p.image?.src ?? p.images?.[0]?.src ?? null,
    status: p.status || 'active',
    publishedAt: p.published_at ?? null
  };
}

const PRODUCT_FIELDS = 'id,title,handle,status,published_at,image,variants';

async function shopifyProducts(store: StoreRef): Promise<CatalogProduct[]> {
  const out: CatalogProduct[] = [];
  let next: string | null = `products.json?limit=250&fields=${PRODUCT_FIELDS}`;
  while (next && out.length < 2000) {
    const { json, link } = await shopifyGet(store, next);
    out.push(...(json.products || []).map(toProduct));
    const m = link ? /<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/.exec(link) : null;
    next = m ? `products.json?limit=250&fields=${PRODUCT_FIELDS}&page_info=${m[1]}` : null;
  }
  return out;
}

/** Products this app already knows from synced variants (Shopify fallback). */
async function localProducts(storeId: string, db: PrismaClient = prisma): Promise<CatalogProduct[]> {
  const rows = await db.productVariant.findMany({
    where: { storeId },
    select: { productId: true, title: true, sku: true, imageUrl: true },
    orderBy: { productId: 'asc' }
  });
  const byProduct = new Map<string, { title: string; skus: string[]; imageUrl: string | null }>();
  for (const r of rows) {
    const id = r.productId.toString();
    const p = byProduct.get(id) ?? { title: r.title.split(' - ')[0] || r.title, skus: [], imageUrl: r.imageUrl };
    if (r.sku) p.skus.push(r.sku);
    if (!p.imageUrl && r.imageUrl) p.imageUrl = r.imageUrl;
    byProduct.set(id, p);
  }
  return [...byProduct.entries()].map(([id, p]) => ({
    id,
    title: p.title,
    handle: '',
    code: productCode(p.skus, id),
    imageUrl: p.imageUrl,
    status: 'active',
    publishedAt: null
  }));
}

async function loadStore(storeId: string): Promise<StoreRef> {
  const s = await prisma.shopifyStore.findUnique({ where: { id: storeId }, select: { id: true, storeDomain: true, accessToken: true, name: true } });
  if (!s) throw new Error('Store not found');
  return s;
}

export async function listProducts(storeId: string): Promise<{ items: CatalogProduct[]; source: 'shopify' | 'local' }> {
  const store = await loadStore(storeId);
  try {
    const items = await cached(`products:${storeId}`, () => shopifyProducts(store));
    return { items, source: 'shopify' };
  } catch (e) {
    console.warn('[ads-launcher] Shopify products failed, using synced variants:', (e as Error).message);
    return { items: await localProducts(storeId), source: 'local' };
  }
}

export async function findProduct(storeId: string, productId: string): Promise<CatalogProduct | null> {
  const { items } = await listProducts(storeId);
  return items.find(p => p.id === productId) ?? null;
}

export function productOptions(items: CatalogProduct[], creativeCounts: Map<string, number>): ProductOption[] {
  return items
    .map(p => ({ id: p.id, title: p.title, handle: p.handle, code: p.code, imageUrl: p.imageUrl, status: p.status, creatives: creativeCounts.get(p.id) ?? 0 }))
    .sort((a, b) => b.creatives - a.creatives || a.title.localeCompare(b.title));
}

// ─── Landing pages (§7.2) ───────────────────────────────────────────────────

async function storeLanding(store: StoreRef, match: { productId?: string; handle?: string | null }): Promise<LandingStore> {
  const [shop, products, pages] = await Promise.all([
    cached(`shop:${store.id}`, () => shopifyGet(store, 'shop.json?fields=domain,myshopify_domain,name').then(r => r.json.shop)).catch(() => null),
    cached(`products:${store.id}`, () => shopifyProducts(store)).catch(() => null),
    cached(`pages:${store.id}`, () =>
      shopifyGet(store, 'pages.json?published_status=published&fields=id,title,handle&limit=50').then(r => r.json.pages || [])
    ).catch(() => [] as any[])
  ]);
  const hostname = String(shop?.domain || store.storeDomain).toLowerCase();
  const product = products
    ? products.find(p => (match.productId && p.id === match.productId) || (!!match.handle && p.handle === match.handle)) ?? null
    : null;
  const handle = product?.handle || match.handle || null;
  const listingStatus = product
    ? product.status !== 'active' ? (product.status === 'archived' ? 'archived' : 'draft') : product.publishedAt ? 'active' : 'unpublished'
    : 'active';
  return {
    storeId: store.id,
    storeName: store.name ?? shop?.name ?? null,
    hostname,
    product: handle && (product || match.productId)
      ? {
        productId: product?.id ?? match.productId ?? '',
        handle,
        title: product?.title ?? handle,
        url: `https://${hostname}/products/${handle}`,
        listingStatus
      }
      : null,
    pages: (pages as any[]).map(p => ({ id: String(p.id), title: p.title || p.handle, url: `https://${hostname}/pages/${p.handle}` }))
  };
}

/**
 * Landing pages for a product: the active store first (matched by id), then
 * every other store the caller can open that sells the same handle (stores
 * often carry clones of one product).
 */
export async function landingFor(input: {
  activeStoreId: string;
  productId: string;
  knownHandle?: string | null;
  otherStores: Array<{ id: string; storeDomain: string; accessToken: string; name: string | null }>;
}): Promise<LandingStore[]> {
  const active = await loadStore(input.activeStoreId);
  const first = await storeLanding(active, { productId: input.productId, handle: input.knownHandle });
  const handle = first.product?.handle ?? input.knownHandle ?? null;
  const others = handle
    ? await Promise.all(
      input.otherStores
        .filter(s => s.id !== input.activeStoreId)
        .slice(0, 10)
        .map(s => storeLanding(s, { handle }).catch(() => null))
    )
    : [];
  return [first, ...others.filter((s): s is LandingStore => !!s && !!s.product)];
}
