/**
 * TanStack Query hooks for the launcher + creative library.
 *
 * Keys are hierarchical (all → lists() → list(params) → detail(id)) so one
 * invalidate after a launch refreshes everything below it (§12.1, §12.3).
 * Everything is store-scoped server-side; the active store domain is part of
 * each key so switching store never shows the previous store's data.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import type { LaunchPresetInput } from '@contract/ads-launcher';
import { creativesApi, launcherApi, presetsApi, type CreativeListParams, type CreativeUploadInput } from '../api/ads-launcher-api';

export const launcherKeys = {
  all: ['ads-launcher'] as const,
  accounts: (store: string) => [...launcherKeys.all, store, 'accounts'] as const,
  options: (store: string, adAccountId: string) => [...launcherKeys.all, store, 'options', adAccountId] as const,
  landing: (store: string, productId: string) => [...launcherKeys.all, store, 'landing', productId] as const,
  posts: (store: string) => [...launcherKeys.all, store, 'posts'] as const,
  postList: (store: string, params: object) => [...launcherKeys.posts(store), params] as const,
  interests: (store: string, adAccountId: string, q: string) => [...launcherKeys.all, store, 'interests', adAccountId, q] as const,
  history: (store: string, params: object) => [...launcherKeys.all, store, 'history', params] as const
};

export const INTEREST_MIN_QUERY = 2;

export const presetKeys = {
  all: ['launch-presets'] as const,
  list: () => [...presetKeys.all, 'list'] as const
};

export const creativeKeys = {
  all: ['creatives'] as const,
  store: (store: string) => [...creativeKeys.all, store] as const,
  lists: (store: string) => [...creativeKeys.store(store), 'list'] as const,
  list: (store: string, params: CreativeListParams) => [...creativeKeys.lists(store), params] as const,
  byIds: (store: string, ids: string[]) => [...creativeKeys.store(store), 'ids', ids] as const,
  detail: (store: string, id: string) => [...creativeKeys.store(store), 'detail', id] as const,
  products: (store: string) => [...creativeKeys.store(store), 'products'] as const
};

/** Active store domain — part of every store-scoped key. */
export function useStoreKey(): string {
  const { activeStore } = useAuth();
  return activeStore?.storeDomain ?? 'none';
}

// ─── Launcher ───────────────────────────────────────────────────────────────

export function useLauncherAccounts() {
  const store = useStoreKey();
  return useQuery({ queryKey: launcherKeys.accounts(store), queryFn: () => launcherApi.accounts().then(r => r.items), staleTime: 60_000 });
}

export function useLauncherOptions(adAccountId: string | null | undefined) {
  const store = useStoreKey();
  return useQuery({
    queryKey: launcherKeys.options(store, adAccountId ?? ''),
    queryFn: () => launcherApi.options(adAccountId!),
    enabled: !!adAccountId,
    // Each load costs Meta ~8-10 calls against the ad account's rate limit:
    // keep it, don't refetch on window focus, never auto-retry a rate limit
    // (502) or a permission error (403). "Reload" asks for fresh data.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: (count, err) => count < 1 && ![403, 502].includes((err as { status?: number })?.status ?? 0)
  });
}

/** Fetch options bypassing the server cache (after linking a page in Meta, etc.). */
export function useReloadOptions(adAccountId: string | null | undefined) {
  const qc = useQueryClient();
  const store = useStoreKey();
  return useMutation({
    mutationFn: () => launcherApi.options(adAccountId!, true),
    onSuccess: data => qc.setQueryData(launcherKeys.options(store, adAccountId ?? ''), data)
  });
}

export function useLanding(productId: string | null | undefined) {
  const store = useStoreKey();
  return useQuery({
    queryKey: launcherKeys.landing(store, productId ?? ''),
    queryFn: () => launcherApi.landing(productId!).then(r => r.items),
    enabled: !!productId,
    staleTime: 5 * 60_000
  });
}

export function usePosts(params: Parameters<typeof launcherApi.posts>[0], enabled = true) {
  const store = useStoreKey();
  return useQuery({ queryKey: launcherKeys.postList(store, params), queryFn: () => launcherApi.posts(params), enabled, placeholderData: prev => prev });
}

/** Interest search; give it an already-debounced query. */
export function useInterestSearch(adAccountId: string | null | undefined, q: string) {
  const store = useStoreKey();
  const query = q.trim();
  return useQuery({
    queryKey: launcherKeys.interests(store, adAccountId ?? '', query.toLowerCase()),
    queryFn: () => launcherApi.interests(adAccountId!, query).then(r => r.items),
    enabled: !!adAccountId && query.length >= INTEREST_MIN_QUERY,
    staleTime: 10 * 60_000,
    placeholderData: prev => prev,
    retry: 1
  });
}

export function useLaunchHistory(params: { page: number; pageSize: number }, enabled = true) {
  const store = useStoreKey();
  return useQuery({
    queryKey: launcherKeys.history(store, params),
    queryFn: () => launcherApi.history(params),
    enabled,
    placeholderData: prev => prev
  });
}

export function useRefreshPosts() {
  const qc = useQueryClient();
  const store = useStoreKey();
  return useMutation({
    mutationFn: launcherApi.refreshPosts,
    onSuccess: () => qc.invalidateQueries({ queryKey: launcherKeys.posts(store) })
  });
}

// ─── Presets ────────────────────────────────────────────────────────────────

export function usePresets() {
  return useQuery({ queryKey: presetKeys.list(), queryFn: () => presetsApi.list().then(r => r.items) });
}

export function usePresetMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: presetKeys.all });
  return {
    create: useMutation({ mutationFn: (input: LaunchPresetInput) => presetsApi.create(input), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: LaunchPresetInput }) => presetsApi.update(id, input), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => presetsApi.remove(id), onSuccess: done }),
    restoreStarters: useMutation({ mutationFn: () => presetsApi.restoreStarters(), onSuccess: done })
  };
}

// ─── Creatives ──────────────────────────────────────────────────────────────

export function useProducts() {
  const store = useStoreKey();
  return useQuery({ queryKey: creativeKeys.products(store), queryFn: () => creativesApi.products().then(r => r.items), staleTime: 5 * 60_000 });
}

export function useCreatives(params: CreativeListParams, enabled = true) {
  const store = useStoreKey();
  return useQuery({ queryKey: creativeKeys.list(store, params), queryFn: () => creativesApi.list(params), enabled, placeholderData: prev => prev });
}

export function useCreativesByIds(ids: string[]) {
  const store = useStoreKey();
  return useQuery({
    queryKey: creativeKeys.byIds(store, ids),
    queryFn: () => creativesApi.byIds(ids).then(r => r.items),
    enabled: ids.length > 0
  });
}

export function useCreativeMutations() {
  const qc = useQueryClient();
  const store = useStoreKey();
  const done = () => qc.invalidateQueries({ queryKey: creativeKeys.store(store) });
  return {
    upload: useMutation({ mutationFn: (input: CreativeUploadInput) => creativesApi.upload(input), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Parameters<typeof creativesApi.update>[1] }) => creativesApi.update(id, body),
      onSuccess: done
    }),
    archive: useMutation({ mutationFn: (id: string) => creativesApi.archive(id), onSuccess: done }),
    restore: useMutation({ mutationFn: (id: string) => creativesApi.restore(id), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => creativesApi.remove(id), onSuccess: done })
  };
}

/** After a launch: creatives (launched counts), launcher options, posts (§12.3). */
export function useInvalidateAfterLaunch() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: creativeKeys.all }),
    qc.invalidateQueries({ queryKey: launcherKeys.all })
  ]);
}
