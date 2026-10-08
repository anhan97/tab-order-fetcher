/**
 * Pool items — what the user picked to launch, in selection order (§2).
 *
 * A creative's key is its uuid; a post's key is `post:<postId>`. Pure, no React.
 */
import type { CreativeDto, MediaType, PostRow } from '@contract/ads-launcher';
import { POST_ID_RE, postPermalink } from '@contract/ads-launcher';

export type PoolKind = 'creative' | 'post';

export interface PoolItem {
  key: string;
  kind: PoolKind;
  /** Library creative. For a post: the creative it was made from, if known (analytics link only). */
  creativeId: string | null;
  postId: string | null;
  /** Ad name: creative name, else `Post <postId>`. */
  name: string;
  angle: string;
  thumbUrl: string | null;
  mediaUrl: string | null;
  mediaType: MediaType;
  productId: string | null;
  productTitle: string | null;
  productCode: string | null;
  primaryText: string;
  headline: string;
  description: string;
  /** Posts only. */
  pageName?: string | null;
  link?: string | null;
  permalink?: string | null;
}

export const POST_KEY_PREFIX = 'post:';
export const postKey = (postId: string) => `${POST_KEY_PREFIX}${postId}`;
export const isPostKey = (key: string) => key.startsWith(POST_KEY_PREFIX);

export function creativeToPoolItem(c: CreativeDto): PoolItem {
  return {
    key: c.id,
    kind: 'creative',
    creativeId: c.id,
    postId: null,
    name: c.name,
    angle: c.angle ?? '',
    thumbUrl: c.thumbUrl ?? (c.mediaType === 'image' ? c.mediaUrl : null),
    mediaUrl: c.mediaUrl,
    mediaType: c.mediaType,
    productId: c.productId ?? null,
    productTitle: c.productTitle ?? null,
    productCode: c.productCode ?? null,
    primaryText: c.primaryText ?? '',
    headline: c.headline ?? '',
    description: c.description ?? ''
  };
}

export function postToPoolItem(p: PostRow): PoolItem {
  return {
    key: postKey(p.postId),
    kind: 'post',
    creativeId: p.creative?.id ?? null,
    postId: p.postId,
    name: p.creative?.name || `Post ${p.postId}`,
    angle: p.creative?.angle ?? '',
    thumbUrl: p.thumbnailUrl,
    mediaUrl: p.thumbnailUrl,
    mediaType: p.isVideo ? 'video' : 'image',
    productId: p.product?.id ?? null,
    productTitle: p.product?.title ?? null,
    productCode: p.product?.code ?? null,
    primaryText: p.primaryText ?? '',
    headline: p.headline ?? '',
    description: '',
    pageName: p.pageName,
    link: p.link,
    permalink: p.permalink
  };
}

/** A post the API does not know yet (any post ID may be launched, §3.2). */
export function barePostItem(postId: string): PoolItem {
  return {
    key: postKey(postId),
    kind: 'post',
    creativeId: null,
    postId,
    name: `Post ${postId}`,
    angle: '',
    thumbUrl: null,
    mediaUrl: null,
    mediaType: 'image',
    productId: null,
    productTitle: null,
    productCode: null,
    primaryText: '',
    headline: '',
    description: '',
    pageName: null,
    link: null,
    permalink: postPermalink(postId)
  };
}

/** Pasted text → valid, de-duplicated post IDs plus the tokens that were not. */
export function parsePostIds(text: string): { valid: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (POST_ID_RE.test(t)) {
      if (!valid.includes(t)) valid.push(t);
    } else if (!invalid.includes(t)) {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}

/** Append items keeping order and dropping keys already present. */
export function mergePool(pool: PoolItem[], add: PoolItem[]): PoolItem[] {
  const seen = new Set(pool.map(i => i.key));
  const out = [...pool];
  for (const item of add) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

/** The product a launch is for: the first item that knows its product (§3.2). */
export function poolProduct(pool: PoolItem[]): { id: string; title: string; code: string } | null {
  const first = pool.find(i => i.productId);
  if (!first) return null;
  return { id: first.productId!, title: first.productTitle ?? '', code: first.productCode ?? '' };
}
