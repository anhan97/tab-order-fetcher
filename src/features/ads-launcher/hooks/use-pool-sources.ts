/**
 * Data for the Creatives step: the product's creatives (filter + search),
 * its posts, and "Add by post ID" lookups.
 */
import { useCallback, useEffect, useState } from 'react';
import { LIMITS, type PostRow } from '@contract/ads-launcher';
import { launcherApi } from '../api/ads-launcher-api';
import { errorMessage } from '../lib/format';
import { barePostItem, postToPoolItem, type PoolItem } from '../lib/pool';
import { useCreatives, usePosts } from './queries';

export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Look post IDs up (100 per call); unknown ones become bare `Post <id>` items. */
export async function lookupPosts(postIds: string[]): Promise<{ items: PoolItem[]; found: PostRow[] }> {
  const found: PostRow[] = [];
  for (let i = 0; i < postIds.length; i += LIMITS.postIdsPerLookup) {
    const ids = postIds.slice(i, i + LIMITS.postIdsPerLookup);
    const page = await launcherApi.posts({ postIds: ids, range: 'lifetime', pageSize: 100 });
    found.push(...(page?.items ?? []));
  }
  const byId = new Map(found.map(p => [p.postId, p]));
  return { items: postIds.map(id => (byId.has(id) ? postToPoolItem(byId.get(id)!) : barePostItem(id))), found };
}

export function usePoolSources(productId: string | null, enabled = true) {
  const [filter, setFilter] = useState<'not' | 'all'>('not');
  const [query, setQuery] = useState('');
  const [postQuery, setPostQuery] = useState('');
  const q = useDebouncedValue(query.trim());
  const pq = useDebouncedValue(postQuery.trim());

  const creativesQ = useCreatives(
    { productId: productId ?? undefined, status: 'active', launched: filter, q: q || undefined, pageSize: 100 },
    enabled && !!productId
  );
  const postsQ = usePosts({ productId: productId ?? undefined, q: pq || undefined, range: 'lifetime', sort: 'recent', pageSize: 50 }, enabled);

  // placeholderData keeps the previous list while a new product loads: never show another product's creatives.
  const creatives = (creativesQ.data?.items ?? []).filter(c => !productId || c.productId === productId);
  const posts = postsQ.data?.items ?? [];

  const lookup = useCallback((postIds: string[]) => lookupPosts(postIds), []);

  return {
    creatives: {
      creatives,
      total: creativesQ.data?.total ?? 0,
      notLaunched: creativesQ.data?.notLaunched ?? 0,
      loading: creativesQ.isFetching,
      error: creativesQ.isError ? errorMessage(creativesQ.error) : null,
      filter,
      onFilter: setFilter,
      query,
      onQuery: setQuery
    },
    posts: {
      posts,
      total: postsQ.data?.total ?? 0,
      loading: postsQ.isFetching,
      error: postsQ.isError ? errorMessage(postsQ.error) : null,
      query: postQuery,
      onQuery: setPostQuery
    },
    lookup
  };
}
