/**
 * Bulk-launch Facebook ads from creative files + per-creative ad copy.
 *
 * Flow (matches the proven "Len Ads Tu Dong" pipeline):
 *   1. Create ONE SALES campaign with CBO budget — PAUSED
 *   2. Create ONE ad set under it (default targeting US/GB/CA/AU,
 *      promoted_object = pixel + PURCHASE) — PAUSED
 *   3. For each uploaded media file:
 *        a) upload to /act_X/adimages or /act_X/advideos
 *        b) create one ad with object_story_spec.link_data + multi_text
 *           optimization (up to 5 primary_texts / headlines / descriptions)
 *      All ads land PAUSED — the merchant unpauses what they like in Ads Manager.
 *
 * This module is import-only Node; the route layer wires SSE / FormData /
 * progress streaming. We resolve tokens from the system-user pool, but
 * accept a fallback access token for legacy per-user FB Login users.
 */

// Use Node 22's native fetch + FormData/Blob — no node-fetch/form-data needed
// for multipart uploads. The other services in this folder still import
// node-fetch for legacy reasons; we don't follow them here because we need
// the global FormData type that node-fetch types don't expose cleanly.
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as pool from './fb-system-token.service';

const FB_BASE = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

export interface AdCopy {
  primary_texts: string[];
  headlines: string[];
  descriptions: string[];
}

export interface BulkLaunchInput {
  adAccountId: string;          // 'act_123' or '123'
  campaignName: string;
  pageId: string;
  pixelId: string;
  instagramActorId?: string;
  linkUrl: string;              // landing page URL
  urlParams?: string;           // appended after ? or & (UTMs etc)
  dailyBudget: number;          // cents (e.g. 5000 = $50)
  bidStrategy?: 'bid_cap' | 'cost_cap' | 'highest_volume';
  bidAmount?: number;           // cents
  callToAction?: string;        // SHOP_NOW, LEARN_MORE…
  countries?: string[];         // default ['US','GB','CA','AU']
  globalCopy?: AdCopy;          // fallback when a file has no per-file copy
  /** Caller-supplied fallback token. System-user pool is preferred when configured. */
  fallbackAccessToken?: string;
}

export interface UploadedCreative {
  filename: string;
  buffer: Buffer;
  mimetype: string;
  /** Per-file copy override; falls back to globalCopy when omitted. */
  copy?: AdCopy;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi']);

const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

export interface ProgressEvent {
  step: 'campaign' | 'adset' | 'upload' | 'complete' | 'error';
  status: 'creating' | 'uploading' | 'done' | 'failed';
  message: string;
  index?: number;
  total?: number;
  filename?: string;
  id?: string;
  adId?: string;
  campaignId?: string;
  error?: string;
  results?: Array<{ filename: string; status: string; adId?: string; error?: string }>;
  summary?: { total: number; success: number; failed: number };
}

/**
 * Run the bulk launch. `onProgress` receives an event for every milestone —
 * pipe it straight to the SSE stream so the merchant sees per-file status.
 */
export async function runBulkLaunch(
  input: BulkLaunchInput,
  files: UploadedCreative[],
  onProgress: (e: ProgressEvent) => void
): Promise<void> {
  const accountId = formatAccountId(input.adAccountId);
  const accessToken = resolveToken(accountId, input.fallbackAccessToken);

  if (files.length === 0) throw new Error('No creative files provided');

  // 1. Campaign
  onProgress({ step: 'campaign', status: 'creating', message: 'Creating SALES campaign (CBO)...' });
  const campaign = await createCampaign(accountId, accessToken, {
    name: input.campaignName,
    objective: 'OUTCOME_SALES',
    daily_budget: String(input.dailyBudget),
    status: 'PAUSED'
  });
  onProgress({ step: 'campaign', status: 'done', id: campaign.id, message: `Campaign ${campaign.id}` });

  // 2. Ad set — start tomorrow midnight, default targeting
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  onProgress({ step: 'adset', status: 'creating', message: 'Creating ad set...' });
  const adSet = await createAdSet(accountId, accessToken, {
    name: `${input.campaignName} - Ad Set`,
    campaign_id: campaign.id,
    targeting: { geo_locations: { countries: input.countries || ['US', 'GB', 'CA', 'AU'] } },
    start_time: String(Math.floor(tomorrow.getTime() / 1000)),
    bid_strategy: input.bidStrategy || 'bid_cap',
    bid_amount: input.bidAmount ? String(input.bidAmount) : '1000',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    promoted_object: { pixel_id: input.pixelId, custom_event_type: 'PURCHASE' },
    status: 'PAUSED'
  });
  onProgress({ step: 'adset', status: 'done', id: adSet.id, message: `Ad set ${adSet.id}` });

  // 3. Per-file upload + ad creation
  const link = input.urlParams
    ? `${input.linkUrl}${input.linkUrl.includes('?') ? '&' : '?'}${input.urlParams}`
    : input.linkUrl;

  const results: Array<{ filename: string; status: string; adId?: string; error?: string }> = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const f = files[i];
    onProgress({ step: 'upload', status: 'uploading', index: i, total, filename: f.filename, message: `${f.filename} (${i + 1}/${total}) uploading…` });

    try {
      const isImage = IMAGE_TYPES.has(f.mimetype);
      const isVideo = VIDEO_TYPES.has(f.mimetype);
      if (!isImage && !isVideo) throw new Error(`Unsupported file type: ${f.mimetype}`);
      if (isImage && f.buffer.length > MAX_IMAGE_SIZE) throw new Error('Image > 30 MB');
      if (isVideo && f.buffer.length > MAX_VIDEO_SIZE) throw new Error('Video > 500 MB');

      let imageHash: string | undefined;
      let videoId: string | undefined;
      if (isImage) {
        imageHash = (await uploadImage(accountId, accessToken, f.buffer, f.filename)).image_hash;
      } else {
        videoId = (await uploadVideo(accountId, accessToken, f.buffer, f.filename)).video_id;
      }

      const copy = mergeCopy(f.copy, input.globalCopy);
      const cta = input.callToAction || 'SHOP_NOW';

      // Inline creative — link ad with optional video preview frame.
      const linkData: Record<string, unknown> = {
        message: copy.primary_texts[0] || '',
        name: copy.headlines[0] || '',
        description: copy.descriptions[0] || '',
        link,
        call_to_action: { type: cta }
      };
      if (imageHash) linkData.image_hash = imageHash;

      const objectStorySpec: Record<string, unknown> = { page_id: input.pageId, link_data: linkData };
      if (input.instagramActorId) objectStorySpec.instagram_actor_id = input.instagramActorId;

      const creative: Record<string, unknown> = { object_story_spec: objectStorySpec };
      if (videoId) {
        // Video ads use video_data instead of link_data
        delete creative.object_story_spec;
        const videoData: Record<string, unknown> = {
          video_id: videoId,
          message: copy.primary_texts[0] || '',
          title: copy.headlines[0] || '',
          call_to_action: { type: cta, value: { link } }
        };
        const spec: Record<string, unknown> = { page_id: input.pageId, video_data: videoData };
        if (input.instagramActorId) spec.instagram_actor_id = input.instagramActorId;
        creative.object_story_spec = spec;
      }

      const degreesOfFreedom = {
        creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
        multi_text_optimization_spec: {
          bodies: copy.primary_texts.map(t => ({ text: t })),
          titles: copy.headlines.map(t => ({ text: t })),
          descriptions: copy.descriptions.map(t => ({ text: t }))
        }
      };

      const ad = await createAdInline(accountId, accessToken, {
        name: `Ad - ${f.filename}`,
        adset_id: adSet.id,
        creative,
        degrees_of_freedom_spec: degreesOfFreedom,
        status: 'PAUSED'
      });

      results.push({ filename: f.filename, status: 'success', adId: ad.id });
      onProgress({ step: 'upload', status: 'done', index: i, total, filename: f.filename, adId: ad.id, message: `${f.filename} → ad ${ad.id}` });
    } catch (e: any) {
      const msg = e?.message || String(e);
      results.push({ filename: f.filename, status: 'failed', error: msg });
      onProgress({ step: 'upload', status: 'failed', index: i, total, filename: f.filename, error: msg, message: `${f.filename} failed: ${msg}` });
    }

    // Throttle a bit so we don't hammer FB's rate limit on big batches
    if (i < total - 1) await sleep(400);
  }

  const ok = results.filter(r => r.status === 'success').length;
  const fail = results.length - ok;
  onProgress({
    step: 'complete', status: 'done',
    campaignId: campaign.id, results,
    summary: { total, success: ok, failed: fail },
    message: `Done — ${ok} ads created, ${fail} failed. All PAUSED in Ads Manager.`
  });
}

// ─── FB Marketing API helpers ─────────────────────────────────────────────

async function createCampaign(accountId: string, token: string, data: {
  name: string;
  objective: string;
  daily_budget: string;
  status: string;
}): Promise<{ id: string }> {
  return fbPost(`${FB_BASE}/${accountId}/campaigns`, token, {
    ...data,
    special_ad_categories: '[]'
  });
}

async function createAdSet(accountId: string, token: string, data: {
  name: string;
  campaign_id: string;
  targeting: object;
  start_time: string;
  bid_strategy: string;
  bid_amount: string;
  optimization_goal: string;
  promoted_object: object;
  status: string;
}): Promise<{ id: string }> {
  // Map our bid_strategy strings to FB's enum + bid_amount semantics, same as
  // the reference impl. cost_cap → COST_CAP; highest_volume → no strategy
  // but bid_amount is still required by some accounts.
  const { bid_strategy, bid_amount, ...rest } = data;
  const payload: Record<string, unknown> = {
    ...rest,
    billing_event: 'IMPRESSIONS',
    bid_amount
  };
  if (bid_strategy === 'cost_cap') payload.bid_strategy = 'COST_CAP';
  // bid_cap and highest_volume both run without an explicit bid_strategy field

  return fbPost(`${FB_BASE}/${accountId}/adsets`, token, payload);
}

async function createAdInline(accountId: string, token: string, data: {
  name: string;
  adset_id: string;
  creative: Record<string, unknown>;
  degrees_of_freedom_spec: Record<string, unknown>;
  status: string;
}): Promise<{ id: string }> {
  return fbPost(`${FB_BASE}/${accountId}/ads`, token, data);
}

async function uploadImage(accountId: string, token: string, buffer: Buffer, filename: string): Promise<{ image_hash: string }> {
  const fd = new FormData();
  fd.append('access_token', token);
  // Node 22's Blob accepts a Buffer slice. Wrapping in a File-like via Blob
  // is the simplest path to multipart from Node without the form-data dep.
  fd.append('source', new Blob([new Uint8Array(buffer)]), filename);
  const res = await fetch(`${FB_BASE}/${accountId}/adimages`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Image upload failed: ${await res.text()}`);
  const json: any = await res.json();
  const images = json.images || {};
  const firstKey = Object.keys(images)[0];
  if (!firstKey) throw new Error('Image upload returned no hash');
  return { image_hash: images[firstKey].hash };
}

async function uploadVideo(accountId: string, token: string, buffer: Buffer, filename: string): Promise<{ video_id: string }> {
  const fd = new FormData();
  fd.append('access_token', token);
  fd.append('source', new Blob([new Uint8Array(buffer)]), filename);
  fd.append('title', filename);
  const res = await fetch(`${FB_BASE}/${accountId}/advideos`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Video upload failed: ${await res.text()}`);
  const json: any = await res.json();
  if (!json.id) throw new Error('Video upload returned no id');
  return { video_id: json.id };
}

/** Look up the pages that can be promoted on this ad account. */
export async function listPromotablePages(accountId: string, fallbackToken?: string): Promise<Array<{ id: string; name: string; instagram_business_account?: { id: string } }>> {
  const aid = formatAccountId(accountId);
  const token = resolveToken(aid, fallbackToken);
  const url = `${FB_BASE}/${aid}/promote_pages?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(token)}&limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`promote_pages failed: ${await res.text()}`);
  const json: any = await res.json();
  return json.data || [];
}

/** List pixels on the ad account. */
export async function listPixels(accountId: string, fallbackToken?: string): Promise<Array<{ id: string; name: string }>> {
  const aid = formatAccountId(accountId);
  const token = resolveToken(aid, fallbackToken);
  const url = `${FB_BASE}/${aid}/adspixels?fields=id,name&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`adspixels failed: ${await res.text()}`);
  const json: any = await res.json();
  return json.data || [];
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function formatAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

function resolveToken(accountId: string, fallback?: string): string {
  const idNoPrefix = accountId.replace(/^act_/, '');
  if (pool.isPoolConfigured()) {
    try { return pool.tokenForAccount(idNoPrefix); }
    catch { /* fall through to fallback */ }
  }
  if (fallback) return fallback;
  throw new Error('No system-user token for account and no fallback provided. Configure Adlux pool or pass an access token.');
}

function mergeCopy(perFile?: AdCopy, global?: AdCopy): AdCopy {
  const base: AdCopy = global || { primary_texts: [], headlines: [], descriptions: [] };
  if (!perFile) return base;
  return {
    primary_texts: perFile.primary_texts.length > 0 ? perFile.primary_texts : base.primary_texts,
    headlines: perFile.headlines.length > 0 ? perFile.headlines : base.headlines,
    descriptions: perFile.descriptions.length > 0 ? perFile.descriptions : base.descriptions
  };
}

async function fbPost<T = any>(url: string, token: string, data: Record<string, unknown>): Promise<T> {
  const body = new URLSearchParams();
  body.set('access_token', token);
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`Facebook API error: ${await res.text()}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
