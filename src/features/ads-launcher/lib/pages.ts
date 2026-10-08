/**
 * Facebook pages for the picker. A business can reach hundreds of pages
 * (promote_pages ∪ /me/accounts ∪ the BM's owned + client pages, linked
 * first), so the picker searches and renders a capped list. Pure.
 */
import type { LauncherPage } from '@contract/ads-launcher';

/** Rows rendered at once; typing narrows the rest down. */
export const PAGE_LIST_LIMIT = 100;

/**
 * The page to select when an account's options arrive:
 * exactly one page → it; else exactly one linked page → it; else the
 * remembered page if it is still offered; else none.
 */
export function initialPageId(pages: LauncherPage[], remembered: string): string {
  if (pages.length === 1) return pages[0].externalId;
  const linked = pages.filter(p => p.linked);
  if (linked.length === 1) return linked[0].externalId;
  return pages.some(p => p.externalId === remembered) ? remembered : '';
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Pages matching a name or id fragment (all words must match), linked first, capped. */
export function filterPages(pages: LauncherPage[], query: string, limit = PAGE_LIST_LIMIT): { items: LauncherPage[]; total: number } {
  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  const matches = words.length
    ? pages.filter(p => {
        const hay = norm(`${p.name} ${p.externalId}`);
        return words.every(w => hay.includes(w));
      })
    : pages;
  const sorted = [...matches].sort((a, b) => Number(b.linked) - Number(a.linked));
  return { items: sorted.slice(0, limit), total: matches.length };
}
