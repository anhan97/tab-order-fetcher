/**
 * Real Graph API adapter for MetaAdsWriter (§8.3).
 *
 * - Writes are form-urlencoded with objects as JSON strings.
 * - Creatives, ads and post-id reads go through the Graph batch endpoint,
 *   50 operations per HTTP request; one failed element only fails itself.
 * - Usage headers feed fb-rate-limit; token/app/rate-limit errors trip the
 *   breaker so we stop calling Meta for a while.
 */
import { FACEBOOK_CONFIG } from '../config/facebook';
import { recordUsageFromHeaders, shouldBackoff } from '../services/fb-rate-limit.service';
import type { ExistingCampaign, InterestOption, LauncherAudience, LauncherPage } from './contract';
import { LIMITS } from './contract';
import * as breaker from './meta-breaker';
import { actId, encodeForm, type MetaFields } from './meta-params';
import {
  type BatchResult,
  type MetaAdsWriter,
  type RemoteAdSet,
  type RemoteCampaign,
  MetaApiError,
  MetaUnavailableError,
  knownBidStrategy
} from './meta-ads-writer';

type FetchFn = typeof fetch;

interface GraphError {
  message?: string;
  error_user_msg?: string;
  error_user_title?: string;
  code?: number;
  error_subcode?: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The most useful thing Meta said, with the code for support. */
export function graphErrorMessage(err: GraphError | undefined, fallback: string): string {
  if (!err) return fallback;
  const text = err.error_user_msg || err.message || fallback;
  const code = err.code ? ` (#${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})` : '';
  return `${text}${code}`;
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

export class FbMetaAdsWriter implements MetaAdsWriter {
  readonly kind = 'meta' as const;
  private readonly base: string;
  private readonly key: string;

  constructor(
    private readonly token: string,
    private readonly opts: { fetch?: FetchFn; version?: string; adAccountId?: string } = {}
  ) {
    this.base = `https://graph.facebook.com/${opts.version ?? FACEBOOK_CONFIG.version}`;
    this.key = breaker.breakerKey(token);
  }

  private get fetchFn(): FetchFn {
    return this.opts.fetch ?? fetch;
  }

  /** Throws MetaUnavailableError when the breaker is open. */
  assertAvailable(): void {
    const open = breaker.check(this.key);
    if (open) {
      throw new MetaUnavailableError(
        `Meta is unavailable for this Facebook connection (${open.reason}). Try again in a few minutes.`,
        open.until - Date.now()
      );
    }
  }

  private async beforeCall(): Promise<void> {
    this.assertAvailable();
    const account = this.opts.adAccountId;
    if (!account) return;
    const wait = shouldBackoff(account);
    if (wait > 10_000) {
      breaker.trip(this.key, 'ad account rate limit', wait);
      this.assertAvailable();
    }
    if (wait > 0) await sleep(wait);
  }

  private afterResponse(res: Response): void {
    if (this.opts.adAccountId) recordUsageFromHeaders(this.opts.adAccountId, headersToRecord(res.headers));
  }

  private failFrom(err: GraphError | undefined, httpStatus: number, fallback: string): MetaApiError {
    const ms = breaker.tripDurationMs(err?.code, err?.error_subcode);
    if (ms > 0) breaker.trip(this.key, graphErrorMessage(err, 'Meta error'), ms);
    return new MetaApiError(graphErrorMessage(err, fallback), err?.code, err?.error_subcode, httpStatus);
  }

  private async call<T = any>(method: 'GET' | 'POST', path: string, params: MetaFields = {}, body?: BodyInit): Promise<T> {
    await this.beforeCall();
    let res: Response;
    if (method === 'GET') {
      const qs = encodeForm({ ...params, access_token: this.token });
      res = await this.fetchFn(`${this.base}/${path}${path.includes('?') ? '&' : '?'}${qs}`);
    } else {
      let payload: BodyInit;
      if (body) {
        payload = body;
      } else {
        const form = encodeForm(params);
        form.set('access_token', this.token);
        payload = form;
      }
      res = await this.fetchFn(`${this.base}/${path}`, { method: 'POST', body: payload });
    }
    this.afterResponse(res);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok || json?.error) {
      throw this.failFrom(json?.error, res.status, `Meta returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return json as T;
  }

  /**
   * Graph batch, chunked by 50. A whole chunk failing (network, HTTP error)
   * fails only that chunk's operations; earlier chunks keep their results.
   */
  private async batch(ops: Array<{ method: 'GET' | 'POST'; relative_url: string; body?: string }>): Promise<Array<{ ok: boolean; body: any; error?: string }>> {
    const out: Array<{ ok: boolean; body: any; error?: string }> = [];
    for (let i = 0; i < ops.length; i += LIMITS.metaBatchSize) {
      const chunk = ops.slice(i, i + LIMITS.metaBatchSize);
      try {
        await this.beforeCall();
        const form = new URLSearchParams();
        form.set('access_token', this.token);
        form.set('include_headers', 'false');
        form.set('batch', JSON.stringify(chunk));
        const res = await this.fetchFn(`${this.base}/`, { method: 'POST', body: form });
        this.afterResponse(res);
        const text = await res.text();
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        if (!res.ok || !Array.isArray(json)) {
          throw this.failFrom(json?.error, res.status, `Meta batch failed with HTTP ${res.status}`);
        }
        chunk.forEach((_, j) => {
          const item = json[j];
          if (!item) {
            out.push({ ok: false, body: null, error: 'Meta did not finish this operation (batch timed out). Try again.' });
            return;
          }
          let body: any = null;
          try { body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body; } catch { body = null; }
          if (item.code >= 200 && item.code < 300 && !body?.error) {
            out.push({ ok: true, body });
          } else {
            const err = this.failFrom(body?.error, item.code, `Meta returned HTTP ${item.code}`);
            out.push({ ok: false, body, error: err.message });
          }
        });
      } catch (e: any) {
        const message = e?.message || String(e);
        chunk.forEach(() => out.push({ ok: false, body: null, error: message }));
        if (e instanceof MetaUnavailableError) {
          // Breaker opened mid-launch: fail the rest fast instead of calling on.
          for (let k = i + LIMITS.metaBatchSize; k < ops.length; k++) out.push({ ok: false, body: null, error: message });
          break;
        }
      }
    }
    return out;
  }

  private async createMany(adAccountId: string, edge: string, items: MetaFields[]): Promise<BatchResult[]> {
    const results = await this.batch(items.map(fields => ({
      method: 'POST' as const,
      relative_url: `${actId(adAccountId)}/${edge}`,
      body: encodeForm(fields).toString()
    })));
    return results.map(r => (r.ok && r.body?.id ? { id: String(r.body.id) } : { error: r.error || 'Meta returned no id' }));
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  async createCampaign(adAccountId: string, fields: MetaFields) {
    const r = await this.call<{ id: string }>('POST', `${actId(adAccountId)}/campaigns`, fields);
    return { id: String(r.id) };
  }

  async createAdSet(adAccountId: string, fields: MetaFields) {
    const r = await this.call<{ id: string }>('POST', `${actId(adAccountId)}/adsets`, fields);
    return { id: String(r.id) };
  }

  async uploadImage(adAccountId: string, input: { bytes: Buffer; name: string }) {
    const r = await this.call<{ images?: Record<string, { hash: string }> }>('POST', `${actId(adAccountId)}/adimages`, {
      bytes: input.bytes.toString('base64'),
      name: input.name
    });
    const first = Object.values(r.images || {})[0];
    if (!first?.hash) throw new MetaApiError('Meta accepted the image but returned no hash');
    return { hash: first.hash };
  }

  async uploadVideo(adAccountId: string, input: { name: string; fileUrl?: string; bytes?: Buffer }) {
    let r: { id?: string };
    if (input.fileUrl) {
      r = await this.call('POST', `${actId(adAccountId)}/advideos`, { file_url: input.fileUrl, name: input.name });
    } else if (input.bytes) {
      const fd = new FormData();
      fd.append('access_token', this.token);
      fd.append('name', input.name);
      fd.append('source', new Blob([new Uint8Array(input.bytes)]), input.name);
      r = await this.call('POST', `${actId(adAccountId)}/advideos`, {}, fd);
    } else {
      throw new Error('uploadVideo needs fileUrl or bytes');
    }
    if (!r.id) throw new MetaApiError('Meta accepted the video but returned no id');
    return { id: String(r.id) };
  }

  async getVideoStatus(videoId: string) {
    const r = await this.call<{ status?: { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } } } }>(
      'GET', videoId, { fields: 'status' }
    );
    const vs = r.status?.video_status;
    if (vs === 'ready') return { status: 'ready' as const };
    if (vs === 'error' || vs === 'upload_failed') {
      return { status: 'error' as const, detail: r.status?.processing_phase?.error?.message || vs };
    }
    return { status: 'processing' as const };
  }

  async getVideoThumbnailUrl(videoId: string) {
    const r = await this.call<{ data?: Array<{ uri: string; is_preferred?: boolean }> }>('GET', `${videoId}/thumbnails`, { fields: 'uri,is_preferred' });
    const list = r.data || [];
    return (list.find(t => t.is_preferred) || list[0])?.uri || null;
  }

  createCreatives(adAccountId: string, items: MetaFields[]) {
    return this.createMany(adAccountId, 'adcreatives', items);
  }

  createAds(adAccountId: string, items: MetaFields[]) {
    return this.createMany(adAccountId, 'ads', items);
  }

  async readCreativePostIds(creativeIds: string[]) {
    const results = await this.batch(creativeIds.map(id => ({ method: 'GET' as const, relative_url: `${id}?fields=effective_object_story_id` })));
    return results.map(r => (r.ok && typeof r.body?.effective_object_story_id === 'string' ? r.body.effective_object_story_id as string : null));
  }

  async readAdPostIds(adIds: string[]) {
    const results = await this.batch(adIds.map(id => ({ method: 'GET' as const, relative_url: `${id}?fields=creative{effective_object_story_id}` })));
    return results.map(r =>
      r.ok
        ? { postId: typeof r.body?.creative?.effective_object_story_id === 'string' ? r.body.creative.effective_object_story_id as string : null }
        : { postId: null, error: r.error }
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private async getOrNull<T>(path: string, fields: string): Promise<T | null> {
    try {
      return await this.call<T>('GET', path, { fields });
    } catch (e) {
      // #100/33: object does not exist or this token cannot see it.
      if (e instanceof MetaApiError && e.code === 100) return null;
      throw e;
    }
  }

  async getCampaign(campaignId: string): Promise<RemoteCampaign | null> {
    const r = await this.getOrNull<any>(campaignId, 'id,account_id,name,status,objective,daily_budget,lifetime_budget,bid_strategy');
    if (!r) return null;
    return {
      id: String(r.id),
      accountId: String(r.account_id || ''),
      name: r.name || '',
      status: r.status || 'UNKNOWN',
      objective: r.objective ?? null,
      dailyBudget: r.daily_budget && r.daily_budget !== '0' ? String(r.daily_budget) : null,
      lifetimeBudget: r.lifetime_budget && r.lifetime_budget !== '0' ? String(r.lifetime_budget) : null,
      bidStrategy: knownBidStrategy(r.bid_strategy)
    };
  }

  async getAdSet(adsetId: string): Promise<RemoteAdSet | null> {
    const r = await this.getOrNull<any>(adsetId, 'id,campaign_id,name,status,daily_budget');
    if (!r) return null;
    return {
      id: String(r.id),
      campaignId: String(r.campaign_id || ''),
      name: r.name || '',
      status: r.status || 'UNKNOWN',
      dailyBudget: r.daily_budget && r.daily_budget !== '0' ? String(r.daily_budget) : null
    };
  }

  async getAdAccount(adAccountId: string) {
    const r = await this.call<any>('GET', actId(adAccountId), { fields: 'id,name,currency,account_status' });
    return {
      id: String(r.id || '').replace(/^act_/, ''),
      name: r.name || adAccountId,
      currency: r.currency ?? null,
      accountStatus: typeof r.account_status === 'number' ? r.account_status : null
    };
  }

  /**
   * Follow `paging.next` until `max` rows. Next links already carry the token,
   * so they are fetched as-is.
   */
  private async listAll<T = any>(path: string, params: MetaFields, max = 500): Promise<T[]> {
    const out: T[] = [];
    let page = await this.call<{ data?: T[]; paging?: { next?: string } }>('GET', path, { ...params, limit: params.limit ?? 100 });
    out.push(...(page.data || []));
    while (page.paging?.next && out.length < max) {
      await this.beforeCall();
      const res = await this.fetchFn(page.paging.next);
      this.afterResponse(res);
      const json: any = await res.json().catch(() => null);
      if (!res.ok || json?.error) throw this.failFrom(json?.error, res.status, `Meta returned HTTP ${res.status}`);
      page = json;
      out.push(...(page.data || []));
    }
    return out.slice(0, max);
  }

  /**
   * Every page this connection can advertise with (§3.2 step 1). Four
   * sources, merged and de-duplicated, linked pages first:
   *   1. act_X/promote_pages       — pages already added to the ad account
   *   2. me/accounts               — pages the user has a role on
   *   3. <business>/owned_pages    — pages the ad account's business owns
   *   4. <business>/client_pages   — pages shared with that business
   * This used to stop at (1) whenever it returned anything, so an ad account
   * with one linked page showed exactly one page out of a whole BM.
   * Each source is best effort; failures come back as warnings.
   */
  async listPages(adAccountId: string) {
    const warnings: string[] = [];
    const withIg = 'id,name,picture{url},instagram_business_account';
    const plain = 'id,name,picture{url}';
    const source = async (label: string, path: string): Promise<any[]> => {
      try {
        return await this.listAll(path, { fields: withIg });
      } catch (e) {
        if (e instanceof MetaUnavailableError) throw e;
        // Some tokens may list pages but not read their Instagram link.
        try {
          return await this.listAll(path, { fields: plain });
        } catch (e2) {
          if (e2 instanceof MetaUnavailableError) throw e2;
          warnings.push(`${label}: ${(e2 as Error).message}`);
          return [];
        }
      }
    };

    const businessId = await this.call<any>('GET', actId(adAccountId), { fields: 'business' })
      .then(r => (r?.business?.id ? String(r.business.id) : null))
      .catch(e => {
        if (e instanceof MetaUnavailableError) throw e;
        return null;
      });

    const [linked, mine, owned, client] = await Promise.all([
      source('Pages linked to the ad account', `${actId(adAccountId)}/promote_pages`),
      source('Your pages', 'me/accounts'),
      businessId ? source('Business pages', `${businessId}/owned_pages`) : Promise.resolve([]),
      businessId ? source('Client pages', `${businessId}/client_pages`) : Promise.resolve([])
    ]);

    const byId = new Map<string, LauncherPage>();
    const add = (p: any, isLinked: boolean) => {
      const id = String(p.id);
      const prev = byId.get(id);
      const igId = p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null;
      byId.set(id, {
        externalId: id,
        name: p.name || prev?.name || id,
        pictureUrl: p.picture?.data?.url ?? prev?.pictureUrl ?? null,
        instagramUserId: igId ?? prev?.instagramUserId ?? null,
        linked: isLinked || !!prev?.linked
      });
    };
    linked.forEach(p => add(p, true));
    [...mine, ...owned, ...client].forEach(p => add(p, false));

    const pages = [...byId.values()].sort((a, b) => Number(b.linked) - Number(a.linked) || a.name.localeCompare(b.name));
    return { pages, warnings };
  }

  async listCustomAudiences(adAccountId: string): Promise<LauncherAudience[]> {
    const rows = await this.listAll(`${actId(adAccountId)}/customaudiences`, {
      fields: 'id,name,subtype,approximate_count_lower_bound'
    });
    return rows.map((a: any) => ({
      externalId: String(a.id),
      name: a.name || String(a.id),
      subtype: a.subtype ?? null,
      approximateCount: typeof a.approximate_count_lower_bound === 'number' && a.approximate_count_lower_bound >= 0 ? a.approximate_count_lower_bound : null
    }));
  }

  async searchInterests(query: string): Promise<InterestOption[]> {
    const r = await this.call<any>('GET', 'search', { type: 'adinterest', q: query, limit: 25 });
    return (r.data || []).map((i: any) => ({
      id: String(i.id),
      name: i.name || String(i.id),
      audienceSizeLower: typeof i.audience_size_lower_bound === 'number' ? i.audience_size_lower_bound : null,
      audienceSizeUpper: typeof i.audience_size_upper_bound === 'number' ? i.audience_size_upper_bound : null,
      path: Array.isArray(i.path) ? i.path.map(String) : []
    }));
  }

  async listPixels(adAccountId: string) {
    const r = await this.call<any>('GET', `${actId(adAccountId)}/adspixels`, { fields: 'id,name', limit: 100 });
    return (r.data || []).map((p: any) => ({ externalId: String(p.id), name: p.name || String(p.id) }));
  }

  async listCampaigns(adAccountId: string): Promise<ExistingCampaign[]> {
    const statuses = ['ACTIVE', 'PAUSED'];
    const [campaigns, adsets] = await Promise.all([
      this.call<any>('GET', `${actId(adAccountId)}/campaigns`, {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,bid_strategy',
        effective_status: statuses,
        limit: 100
      }),
      this.call<any>('GET', `${actId(adAccountId)}/adsets`, {
        fields: 'id,name,status,daily_budget,campaign_id',
        effective_status: statuses,
        limit: 500
      })
    ]);
    const byCampaign = new Map<string, ExistingCampaign['adsets']>();
    for (const a of adsets.data || []) {
      const list = byCampaign.get(String(a.campaign_id)) ?? [];
      list.push({ externalId: String(a.id), name: a.name || '', status: a.status || '', dailyBudget: a.daily_budget && a.daily_budget !== '0' ? String(a.daily_budget) : null });
      byCampaign.set(String(a.campaign_id), list);
    }
    return (campaigns.data || []).map((c: any) => ({
      externalId: String(c.id),
      name: c.name || '',
      status: c.status || '',
      objective: c.objective ?? null,
      dailyBudget: c.daily_budget && c.daily_budget !== '0' ? String(c.daily_budget) : null,
      lifetimeBudget: c.lifetime_budget && c.lifetime_budget !== '0' ? String(c.lifetime_budget) : null,
      bidStrategy: knownBidStrategy(c.bid_strategy),
      adsets: byCampaign.get(String(c.id)) ?? []
    }));
  }
}
