/**
 * Thin typed HTTP layer for the Ads Launcher + creative library (no React).
 *
 * Every endpoint answers `{ success: true, data }` or
 * `{ success: false, error: { code, message, details? } }` (§7); `call`
 * unwraps the data and turns the error envelope into a readable ApiError.
 */
import { apiFetch, ApiError } from '@/utils/apiClient';
import type {
  CreativeDto,
  LandingStore,
  LaunchPreset,
  LaunchPresetInput,
  LaunchRequest,
  LaunchResult,
  LauncherAdAccount,
  LauncherOptions,
  PostsPage,
  ProductOption,
  RefreshPostsResult
} from '@contract/ads-launcher';

export class LauncherApiError extends ApiError {
  code: string;
  details: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    const err = (body as { error?: { code?: string; details?: unknown } } | null)?.error;
    this.code = err?.code ?? 'error';
    this.details = err?.details;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const body = await apiFetch<{ success: boolean; data: T }>(path, init);
    return body?.data as T;
  } catch (e) {
    if (e instanceof ApiError) {
      const msg = typeof e.body?.error?.message === 'string' ? e.body.error.message : e.message;
      throw new LauncherApiError(msg, e.status, e.body);
    }
    throw e;
  }
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

// ─── Launcher ───────────────────────────────────────────────────────────────

export const launcherApi = {
  accounts: () => call<{ items: LauncherAdAccount[] }>('/api/ads-launcher/accounts'),
  options: (adAccountId: string) => call<LauncherOptions>(`/api/ads-launcher/options${qs({ adAccountId })}`),
  landing: (productId: string) => call<{ items: LandingStore[] }>(`/api/ads-launcher/landing${qs({ productId })}`),
  /** One request = one campaign (§7.3). */
  launch: (request: LaunchRequest) => call<LaunchResult>('/api/ads-launcher/launch', json('POST', request)),
  posts: (params: {
    q?: string; productId?: string; creativeId?: string; adAccountId?: string;
    status?: 'active' | 'all'; source?: 'library' | 'all'; range?: '7d' | '30d' | '90d' | 'lifetime';
    sort?: 'spend' | 'purchases' | 'roas' | 'recent'; postIds?: string[]; page?: number; pageSize?: number;
  }) => call<PostsPage>(`/api/ads-launcher/posts${qs({ ...params, postIds: params.postIds?.join(',') })}`),
  refreshPosts: (body: { adAccountId?: string; productId?: string; creativeId?: string }) =>
    call<RefreshPostsResult>('/api/ads-launcher/posts/refresh', json('POST', body))
};

// ─── Presets ────────────────────────────────────────────────────────────────

export const presetsApi = {
  list: () => call<{ items: LaunchPreset[] }>('/api/launch-presets'),
  create: (input: LaunchPresetInput) => call<LaunchPreset>('/api/launch-presets', json('POST', input)),
  update: (id: string, input: LaunchPresetInput) => call<LaunchPreset>(`/api/launch-presets/${id}`, json('PUT', input)),
  remove: (id: string) => call<{ ok: true }>(`/api/launch-presets/${id}`, { method: 'DELETE' }),
  restoreStarters: () => call<{ items: LaunchPreset[] }>('/api/launch-presets/restore-starters', { method: 'POST' })
};

// ─── Creative library ───────────────────────────────────────────────────────

export interface CreativeListParams {
  productId?: string;
  status?: 'active' | 'archived';
  /** `not` = no ad made from it yet. */
  launched?: 'not' | 'all';
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface CreativeUploadInput {
  file: Blob;
  fileName: string;
  /** JPEG thumbnail / video poster generated in the browser. */
  poster?: Blob | null;
  productId: string;
  productCode?: string;
  angle: string;
  primaryText?: string;
  headline?: string;
  description?: string;
  width?: number | null;
  height?: number | null;
}

export const creativesApi = {
  products: () => call<{ items: ProductOption[] }>('/api/creatives/products'),
  list: (params: CreativeListParams) =>
    call<{ items: CreativeDto[]; total: number; notLaunched: number }>(`/api/creatives${qs({ ...params })}`),
  /** Several ids at once (pool restore / deep links). Unknown ids are left out. */
  byIds: (ids: string[]) => call<{ items: CreativeDto[] }>(`/api/creatives${qs({ ids: ids.join(','), pageSize: 100 })}`),
  get: (id: string) => call<CreativeDto>(`/api/creatives/${id}`),
  upload: (input: CreativeUploadInput) => {
    const fd = new FormData();
    fd.append('file', input.file, input.fileName);
    if (input.poster) fd.append('poster', input.poster, 'poster.jpg');
    fd.append('productId', input.productId);
    fd.append('angle', input.angle);
    for (const k of ['productCode', 'primaryText', 'headline', 'description'] as const) {
      const v = input[k];
      if (v) fd.append(k, v);
    }
    if (input.width) fd.append('width', String(input.width));
    if (input.height) fd.append('height', String(input.height));
    return call<CreativeDto>('/api/creatives', { method: 'POST', body: fd });
  },
  update: (id: string, body: { angle: string; primaryText?: string | null; headline?: string | null; description?: string | null }) =>
    call<CreativeDto>(`/api/creatives/${id}`, json('PUT', body)),
  archive: (id: string) => call<CreativeDto>(`/api/creatives/${id}/archive`, { method: 'POST' }),
  restore: (id: string) => call<CreativeDto>(`/api/creatives/${id}/restore`, { method: 'POST' }),
  remove: (id: string) => call<{ ok: true }>(`/api/creatives/${id}`, { method: 'DELETE' })
};
