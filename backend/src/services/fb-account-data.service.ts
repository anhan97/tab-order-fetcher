/**
 * Orchestrator for "give me everything I need to render a Facebook Ads Manager
 * page for this account in this date range".
 *
 * Strategy (from research — single most-points-efficient pattern on dev tier):
 *   1. ONE call to /act_<id>/insights?level=ad — returns every ad's performance
 *      in the window, paginated. Counts as 1 read against ads_insights quota.
 *   2. ONE cached call to /act_<id>?fields=campaigns{...,adsets{...,ads{...}}}
 *      to pull structure (names, status, budget, creative thumbnail). Cached
 *      6h because this rarely changes.
 *   3. Merge the two into the {campaigns, adsets, ads} shape the existing
 *      frontend expects.
 *
 * Why this beats the old "3 separate fetches per account every time":
 *   - 3× fewer API calls (1 insights + 1 cached structure vs 3 separate)
 *   - Multi-tenant: same account viewed by N users = 1 fetch shared via cache
 *   - Adaptive backoff via fb-rate-limit
 *   - In-flight dedup: 10 simultaneous requests for the same key = 1 fetch
 */

import fetch from 'node-fetch';
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as cache from './fb-cache.service';
import * as rateLimit from './fb-rate-limit.service';
import * as pool from './fb-system-token.service';

const FB_BASE = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

/**
 * Pick the right access token for an account.
 *
 * Order matters here — used to be "pool wins if configured" but that broke
 * any user who had picked User Token mode in a deployment that also had an
 * Adlux pool: their long-lived token sat in the DB unused while requests
 * went out with a system token whose BM didn't have the right app.
 *
 *   1. If the caller passed a non-empty token → trust them and use it.
 *      (The route resolves UserFacebookConnection first now, so this is
 *       how user-token mode reaches FB.)
 *   2. Else if pool is configured → consistent-hash to a pool slot.
 *   3. Else throw (caller must error out — there's no token to use).
 */
function resolveToken(accountId: string, fallbackToken: string): string {
  if (fallbackToken && fallbackToken.length > 0) return fallbackToken;
  if (pool.isPoolConfigured()) {
    try { return pool.tokenForAccount(accountId); }
    catch { /* fall through */ }
  }
  throw new Error('No FB token available — connect Facebook (user-token mode) or configure the Adlux system-user pool.');
}

// Per-key in-flight promises so concurrent callers share one underlying fetch.
const inflight = new Map<string, Promise<any>>();

/**
 * "Ad account owner has NOT grant ads_management or ads_read" fires once per
 * ad account in a fan-out — easily 5-20 lines per page refresh — and there's
 * nothing actionable in the per-account log. Track which accounts we've
 * already warned for in this process so the user sees ONE clear warning per
 * account, not a cascade.
 */
const appNotAuthorizedSeen = new Set<string>();
function logAppNotAuthorizedOnce(accountId: string, msg: string): void {
  if (appNotAuthorizedSeen.has(accountId)) return;
  appNotAuthorizedSeen.add(accountId);
  console.warn(
    `[fb-app-not-authorized] account=${accountId}: ${msg.slice(0, 160)} ` +
    '— FB App needs ads_read/ads_management Advanced Access OR user must be Admin/Tester. ' +
    'See FacebookAdsConnection help card on the frontend for fix steps.'
  );
}

const INSIGHT_FIELDS = [
  'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'spend', 'impressions', 'clicks', 'unique_clicks', 'reach', 'frequency',
  'ctr', 'unique_ctr', 'cpc', 'cpm', 'cost_per_unique_click',
  'actions', 'action_values', 'cost_per_action_type',
  'purchase_roas', 'website_purchase_roas',
  'inline_link_clicks', 'inline_link_click_ctr',
  'video_play_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions', 'video_p100_watched_actions'
].join(',');

interface FbInsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  unique_clicks?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  unique_ctr?: string;
  cpc?: string;
  cpm?: string;
  cost_per_unique_click?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ value: string }>;
  inline_link_clicks?: string;
  video_play_actions?: Array<{ action_type: string; value: string }>;
}

interface FbStructure {
  id: string;
  campaigns?: {
    data: Array<{
      id: string; name: string; status: string; effective_status?: string;
      objective?: string; daily_budget?: string; lifetime_budget?: string;
      start_time?: string; stop_time?: string;
      adsets?: {
        data: Array<{
          id: string; name: string; status: string; effective_status?: string;
          campaign_id: string;
          daily_budget?: string; lifetime_budget?: string;
          ads?: {
            data: Array<{
              id: string; name: string; status: string; effective_status?: string;
              adset_id: string; campaign_id?: string;
              creative?: {
                id: string;
                thumbnail_url?: string;
                image_url?: string;
                body?: string;
                title?: string;
                call_to_action_type?: string;
              };
            }>;
          };
        }>;
      };
    }>;
  };
}

async function fbFetch(url: string, accountId: string): Promise<any> {
  // Honor any pending backoff for this account.
  const wait = rateLimit.shouldBackoff(accountId);
  if (wait > 0 && wait < 30_000) {
    // Short waits we can absorb; long waits should bubble up so user sees stale-cache.
    await new Promise(r => setTimeout(r, wait));
  } else if (wait >= 30_000) {
    throw new Error(`Facebook rate-limited for account ${accountId}, retry in ${Math.round(wait / 1000)}s`);
  }

  const res = await fetch(url);
  // Even on 200, FB sets the BUC header — record it so we know our load.
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  rateLimit.recordUsageFromHeaders(accountId, headers);

  if (!res.ok) {
    const text = await res.text();
    // Try to surface FB's structured error so the frontend can branch on
    // code (190 = expired token, 100 = bad param, 17/4/32/613 = throttle).
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const fbErr = parsed?.error;
    const code = fbErr?.code;
    const subcode = fbErr?.error_subcode;
    const msg = fbErr?.message || text.slice(0, 500);
    // App-not-authorized fires once per account in a fan-out, which was
    // spamming the log with 5+ identical errors per refresh. De-dup by
    // logging it as warn-once per (account, error code) combo.
    const isAppNotAuthorized = /ad account owner has not grant/i.test(msg);
    if (isAppNotAuthorized) {
      logAppNotAuthorizedOnce(accountId, msg);
    } else {
      console.error(`[FB ${res.status}] account=${accountId} code=${code} subcode=${subcode} msg=${msg}`);
    }
    const err = new Error(msg) as Error & {
      fbCode?: number;
      fbSubcode?: number;
      httpStatus?: number;
      appNotAuthorized?: boolean;
    };
    err.fbCode = code;
    err.fbSubcode = subcode;
    err.httpStatus = res.status;
    if (isAppNotAuthorized) err.appNotAuthorized = true;
    throw err;
  }
  return res.json();
}

/**
 * Pull structural metadata for an ad account. Cached 6h regardless of date range
 * — campaign/adset names, statuses, budgets don't change minute-to-minute.
 */
async function fetchStructure(accountId: string, accessToken: string): Promise<FbStructure> {
  const cacheKey = `fb:structure:${accountId}`;
  const cached = cache.get<FbStructure>(cacheKey);
  if (cached) return cached;

  // Dedupe in-flight calls.
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

  const promise = (async () => {
    const adFields = 'id,name,status,effective_status,adset_id,campaign_id,creative{id,thumbnail_url,image_url,body,title,call_to_action_type}';
    const adsetFields = `id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,ads.limit(500){${adFields}}`;
    const campaignFields = `id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,adsets.limit(500){${adsetFields}}`;
    const token = resolveToken(accountId, accessToken);
    const url = `${FB_BASE}/act_${accountId}?fields=campaigns.limit(500){${campaignFields}}&access_token=${encodeURIComponent(token)}`;

    try {
      const data = await fbFetch(url, accountId);
      cache.set(cacheKey, data, cache.STRUCTURE_TTL);
      return data;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Detect whether a [since, until] window represents "today" — i.e. the
 * caller wants the partial-day live numbers and we should use FB
 * `date_preset=today` so FB resolves the day in the account's reporting
 * tz (avoids the empty-result case when account.tz hasn't started the
 * UTC date yet).
 *
 * Strict check: since AND until both fall on TODAY (UTC calendar day).
 * Yesterday and other past days MUST go through `time_range` so FB
 * returns the historical day, not "today" again.
 */
function isTodayQuery(since: Date, until: Date): boolean {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);
  return sinceStr === todayUtc && untilStr === todayUtc;
}

/**
 * Pull insights at level=ad for the entire account in one paginated call.
 * Cached using tiered TTL based on how recent the `until` date is.
 */
async function fetchAdInsights(
  accountId: string,
  accessToken: string,
  since: Date,
  until: Date
): Promise<FbInsightRow[]> {
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);
  const useTodayPreset = isTodayQuery(since, until);
  // Cache key includes "today" when using preset so different "today"
  // instants over time naturally rotate the cache; combined with the 5min
  // today TTL this gives fresh data without stale wrapping.
  const cacheKey = useTodayPreset
    ? `fb:insights:${accountId}:today:${untilStr}`
    : `fb:insights:${accountId}:${sinceStr}:${untilStr}`;

  const cached = cache.get<FbInsightRow[]>(cacheKey);
  if (cached) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

  const promise = (async () => {
    const token = resolveToken(accountId, accessToken);
    const params = new URLSearchParams({
      level: 'ad',
      fields: INSIGHT_FIELDS,
      limit: '500',
      access_token: token
    });
    if (useTodayPreset) {
      // FB resolves "today" in the ad account's reporting TZ → no off-by-one
      // when account_tz differs from UTC. Critical for accounts in PDT/AEST
      // where UTC midnight may be hours before/after the local day starts.
      params.set('date_preset', 'today');
    } else {
      params.set('time_range', JSON.stringify({ since: sinceStr, until: untilStr }));
    }

    const all: FbInsightRow[] = [];
    let url: string | null = `${FB_BASE}/act_${accountId}/insights?${params}`;
    let pageCount = 0;
    // Cap raised from 20 → 250 (= 125k ads). Above that, the caller should
    // switch to async insights jobs — sync paging will time out long before.
    while (url && pageCount < 250) {
      const json: { data?: FbInsightRow[]; paging?: { next?: string } } = await fbFetch(url, accountId);
      if (json.data) all.push(...json.data);
      url = json.paging?.next || null;
      pageCount++;
    }

    cache.set(cacheKey, all, cache.ttlForRange(until));
    return all;
  })().finally(() => { inflight.delete(cacheKey); });

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Look up an action value by type, returning 0 when missing. FB returns
 * actions/values as parallel arrays of {action_type, value}.
 */
function pickAction(rows: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!rows) return 0;
  const hit = rows.find(r => r.action_type === type);
  return hit ? parseFloat(hit.value) || 0 : 0;
}

/**
 * Convert one FB insight row + its parent metadata into the shape the existing
 * frontend already knows how to render. Keeps the keys identical to what
 * facebookAdsApi.transformInsights produces today, so the UI doesn't need to
 * change to consume this.
 */
function shapeAdRow(insight: FbInsightRow, ad: any) {
  const spend = parseFloat(insight.spend || '0');
  const impressions = parseInt(insight.impressions || '0', 10);
  const purchase = pickAction(insight.actions, 'purchase')
    || pickAction(insight.actions, 'offsite_conversion.fb_pixel_purchase');
  const purchaseValue = pickAction(insight.action_values, 'purchase')
    || pickAction(insight.action_values, 'offsite_conversion.fb_pixel_purchase');
  const videoPlays = pickAction(insight.video_play_actions, 'video_view');

  return {
    id: ad?.id || insight.ad_id,
    adset_id: ad?.adset_id || insight.adset_id,
    campaign_id: ad?.campaign_id || insight.campaign_id,
    name: ad?.name || insight.ad_name,
    status: ad?.status || 'UNKNOWN',
    effective_status: ad?.effective_status,
    creative: ad?.creative ? {
      id: ad.creative.id,
      thumbnail_url: ad.creative.thumbnail_url,
      image_url: ad.creative.image_url,
      body: ad.creative.body,
      title: ad.creative.title,
      call_to_action_type: ad.creative.call_to_action_type
    } : null,
    spend,
    impressions,
    clicks: parseInt(insight.clicks || '0', 10),
    unique_clicks: parseInt(insight.unique_clicks || '0', 10),
    ctr: parseFloat(insight.ctr || '0'),
    unique_ctr: parseFloat(insight.unique_ctr || '0'),
    cpc: parseFloat(insight.cpc || '0'),
    cpm: parseFloat(insight.cpm || '0'),
    cost_per_unique_click: parseFloat(insight.cost_per_unique_click || '0'),
    reach: parseInt(insight.reach || '0', 10),
    frequency: parseFloat(insight.frequency || '0'),
    add_to_cart: pickAction(insight.actions, 'add_to_cart'),
    initiate_checkout: pickAction(insight.actions, 'initiate_checkout'),
    purchase,
    purchase_value: purchaseValue,
    cost_per_result: pickAction(insight.cost_per_action_type, 'purchase')
      || pickAction(insight.cost_per_action_type, 'offsite_conversion.fb_pixel_purchase'),
    roas: parseFloat(insight.purchase_roas?.[0]?.value || '0'),
    video_plays: videoPlays,
    hook_rate: impressions ? (videoPlays / impressions) * 100 : 0
  };
}

/**
 * Aggregate ad-level insights up to adset and campaign for the parent rows.
 */
function rollupParents(ads: ReturnType<typeof shapeAdRow>[], structure: FbStructure) {
  type Bucket = ReturnType<typeof shapeAdRow>;
  const adsetBuckets = new Map<string, Bucket[]>();
  const campaignBuckets = new Map<string, Bucket[]>();

  for (const ad of ads) {
    if (ad.adset_id) {
      const arr = adsetBuckets.get(ad.adset_id) || [];
      arr.push(ad);
      adsetBuckets.set(ad.adset_id, arr);
    }
    if (ad.campaign_id) {
      const arr = campaignBuckets.get(ad.campaign_id) || [];
      arr.push(ad);
      campaignBuckets.set(ad.campaign_id, arr);
    }
  }

  const sumOf = (rows: Bucket[], k: keyof Bucket) =>
    rows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);

  // Recompute derived ratios from summed components — averaging ratios is wrong.
  const aggregate = (rows: Bucket[]) => {
    const spend = sumOf(rows, 'spend');
    const impressions = sumOf(rows, 'impressions');
    const clicks = sumOf(rows, 'clicks');
    const reach = sumOf(rows, 'reach');
    const purchase = sumOf(rows, 'purchase');
    const purchaseValue = sumOf(rows, 'purchase_value');
    const videoPlays = sumOf(rows, 'video_plays');
    return {
      spend,
      impressions,
      clicks,
      unique_clicks: sumOf(rows, 'unique_clicks'),
      reach,
      frequency: reach ? impressions / reach : 0,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      unique_ctr: 0, // can't accurately roll up uniques across rows
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      cost_per_unique_click: 0,
      add_to_cart: sumOf(rows, 'add_to_cart'),
      initiate_checkout: sumOf(rows, 'initiate_checkout'),
      purchase,
      purchase_value: purchaseValue,
      cost_per_result: purchase ? spend / purchase : 0,
      roas: spend ? purchaseValue / spend : 0,
      video_plays: videoPlays,
      hook_rate: impressions ? (videoPlays / impressions) * 100 : 0
    };
  };

  const campaigns = (structure.campaigns?.data || []).map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    effective_status: c.effective_status,
    objective: c.objective,
    budget: parseFloat(c.daily_budget || c.lifetime_budget || '0'),
    start_time: c.start_time,
    stop_time: c.stop_time,
    ...aggregate(campaignBuckets.get(c.id) || [])
  }));

  const adsets: any[] = [];
  for (const c of structure.campaigns?.data || []) {
    for (const a of c.adsets?.data || []) {
      adsets.push({
        id: a.id,
        campaign_id: a.campaign_id,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        budget: parseFloat(a.daily_budget || a.lifetime_budget || '0'),
        ...aggregate(adsetBuckets.get(a.id) || [])
      });
    }
  }

  return { campaigns, adsets };
}

export interface AccountDataResult {
  campaigns: any[];
  adsets: any[];
  ads: any[];
  meta: {
    fetchedAt: string;
    cacheHit: { structure: boolean; insights: boolean };
    accountUsage: ReturnType<typeof rateLimit.getAccountUsage>;
  };
}

/**
 * Top-level entry point. Returns everything needed to render the FB Ads
 * Manager view for one account + date range.
 */
export async function getAccountData(
  accountId: string,
  accessToken: string,
  since: Date,
  until: Date
): Promise<AccountDataResult> {
  const structureKey = `fb:structure:${accountId}`;
  const insightsKey = isTodayQuery(since, until)
    ? `fb:insights:${accountId}:today:${until.toISOString().slice(0, 10)}`
    : `fb:insights:${accountId}:${since.toISOString().slice(0, 10)}:${until.toISOString().slice(0, 10)}`;
  const structureHit = cache.get(structureKey) !== null;
  const insightsHit = cache.get(insightsKey) !== null;

  // Fire both in parallel — independent network calls when uncached.
  const [structure, insightRows] = await Promise.all([
    fetchStructure(accountId, accessToken),
    fetchAdInsights(accountId, accessToken, since, until)
  ]);

  // Build ad-id → metadata map for shaping ad rows with creative + status.
  const adMeta = new Map<string, any>();
  for (const c of structure.campaigns?.data || []) {
    for (const a of c.adsets?.data || []) {
      for (const ad of a.ads?.data || []) {
        adMeta.set(ad.id, ad);
      }
    }
  }

  const ads = insightRows.map(row => shapeAdRow(row, adMeta.get(row.ad_id || '')));
  const { campaigns, adsets } = rollupParents(ads, structure);

  return {
    campaigns,
    adsets,
    ads,
    meta: {
      fetchedAt: new Date().toISOString(),
      cacheHit: { structure: structureHit, insights: insightsHit },
      accountUsage: rateLimit.getAccountUsage(accountId)
    }
  };
}

export function invalidateAccount(accountId: string): number {
  return cache.invalidate(`fb:structure:${accountId}`)
    + cache.invalidate(`fb:insights:${accountId}`);
}
