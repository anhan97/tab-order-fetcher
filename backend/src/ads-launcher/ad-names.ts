/**
 * Keys that decide when ads share one Meta creative, and the name numbering
 * inside an ad set (§8.2 step 5). Pure.
 */
import type { AdCopy } from './meta-params';

/** JSON with sorted keys, so equal objects always give the same string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * Ads with the same key reuse ONE Meta creative — usually the same creative
 * in several ad sets, or repeated inside one ad set.
 */
export function creativeKey(k: {
  creativeId: string;
  pageId: string;
  instagramUserId: string;
  link: string;
  displayLink: string;
  callToAction: string;
  urlTags: string;
  copy: AdCopy;
}): string {
  return stableStringify(k);
}

export function postKey(postId: string, urlTags: string): string {
  return stableStringify({ post: postId, urlTags });
}

/**
 * Number names that repeat inside one ad set, in order; a name that appears
 * once is left alone: [A, A, B, A] → [A #1, A #2, B, A #3].
 */
export function numberDuplicateNames(names: string[], maxLength = 255): string[] {
  const totals = new Map<string, number>();
  for (const n of names) totals.set(n, (totals.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map(n => {
    if ((totals.get(n) ?? 0) < 2) return n.slice(0, maxLength);
    const i = (seen.get(n) ?? 0) + 1;
    seen.set(n, i);
    const suffix = ` #${i}`;
    return n.slice(0, maxLength - suffix.length) + suffix;
  });
}
