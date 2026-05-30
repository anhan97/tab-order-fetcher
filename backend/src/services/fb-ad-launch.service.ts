/**
 * Auto-launch ads — the campaign builder.
 *
 * Rewrite of the original "1 campaign / 1 ad set / N ads" pipeline. Now
 * supports:
 *   - Multiple ad sets in one launch (audience matrix). Each AdSetSpec
 *     carries its own targeting (countries, age, gender, custom/lookalike
 *     audiences, interests, placements, devices, optimization_goal).
 *   - CBO at the campaign level OR per-ad-set daily budget.
 *   - Correct bid_strategy mapping (the previous code silently fell back
 *     to LOWEST_COST_WITHOUT_CAP when the user picked "Bid cap"). See
 *     mapBidStrategy() below — single source of truth.
 *   - Video processing wait: poll /{video_id}?fields=status until ready
 *     before creating the ad. The old code raced and could fail with
 *     "video not ready" on bigger files.
 *   - Image hash dedup inside one batch.
 *   - Per-launch history row (AdLaunchHistory + AdLaunchItem) so the
 *     merchant has a record + we have a rollback handle.
 *   - rollbackCampaign() helper for the UI "clean up failed launch" button.
 *   - Configurable objective + status. Default still PAUSED for safety.
 *
 * All FB writes still use the existing token resolver (system-user pool
 * with per-user long-lived token fallback) — same rule as before.
 */

import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as pool from './fb-system-token.service';

const prisma = new PrismaClient();
const FB_BASE = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdCopy {
  primary_texts: string[];   // up to 5 — FB multi_text cap
  headlines: string[];       // up to 5
  descriptions: string[];    // up to 5
}

export interface AudienceSpec {
  /** Human-readable, used in the ad set name. */
  name: string;
  countries?: string[];
  ageMin?: number;
  ageMax?: number;
  /** Gender list. 1=male, 2=female. Omit for All. */
  genders?: number[];
  /** FB custom audience IDs (numeric strings). */
  customAudiences?: string[];
  /** FB lookalike audience IDs. Stored separately in the wizard but
   *  sent in the same `custom_audiences` targeting array (FB treats
   *  lookalikes as custom audiences with subtype=LOOKALIKE). */
  lookalikes?: string[];
  /** FB custom/lookalike audience IDs to exclude. */
  excludedCustomAudiences?: string[];
  /** Interest IDs from FB's detailed-targeting search. */
  interestIds?: string[];
  /** facebook | instagram | audience_network | messenger */
  publisherPlatforms?: string[];
  /** Facebook position list (feed, marketplace, video_feeds, story, reels, ...). */
  facebookPositions?: string[];
  instagramPositions?: string[];
  /** mobile | desktop */
  devicePlatforms?: string[];
  /** OFFSITE_CONVERSIONS | LINK_CLICKS | REACH | IMPRESSIONS | LEAD_GENERATION | VALUE ... */
  optimizationGoal?: string;
  /** PURCHASE | ADD_TO_CART | INITIATE_CHECKOUT | LEAD | COMPLETE_REGISTRATION ... */
  customEventType?: string;
}

export interface AdSetSpec {
  name: string;
  audience: AudienceSpec;
  /** Optional per-ad-set daily budget in cents. Omit when using CBO. */
  dailyBudget?: number;
}

export type BidStrategyChoice = 'highest_volume' | 'bid_cap' | 'cost_cap';

export interface BulkLaunchInput {
  adAccountId: string;
  campaignName: string;
  pageId: string;
  pixelId: string;
  instagramActorId?: string;
  linkUrl: string;
  urlParams?: string;
  /** Campaign-level daily budget (cents). Used when adSets[].dailyBudget is missing. */
  campaignDailyBudget?: number;
  bidStrategy?: BidStrategyChoice;
  /** bid_amount in cents — required for bid_cap and cost_cap. */
  bidAmount?: number;
  /** OUTCOME_SALES (default), OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_ENGAGEMENT */
  objective?: string;
  callToAction?: string;
  /** Unix seconds. Default: next UTC midnight. */
  startTime?: number;
  /** ACTIVE | PAUSED. Default PAUSED. */
  status?: 'ACTIVE' | 'PAUSED';
  /** 1+ ad sets. Each AdSetSpec gets all uploaded files unless creative.adSetIndexes is set. */
  adSets: AdSetSpec[];
  globalCopy?: AdCopy;
  /** Per-user long-lived token; overrides the system-user pool when present. */
  fallbackAccessToken?: string;
  /** When set, the history row records the userId for "My launches" listings. */
  userId?: string;
}

export interface UploadedCreative {
  filename: string;
  buffer: Buffer;
  mimetype: string;
  /** Per-file copy override. Falls back to globalCopy when omitted. */
  copy?: AdCopy;
  /** Restrict to specific ad set indexes; undefined means "go into every ad set". */
  adSetIndexes?: number[];
}

export interface ProgressEvent {
  step:
    | 'campaign'
    | 'adset'
    | 'upload'
    | 'video-wait'
    | 'history-saved'
    | 'complete'
    | 'error';
  status: 'creating' | 'uploading' | 'waiting' | 'done' | 'failed';
  message: string;
  index?: number;
  total?: number;
  filename?: string;
  id?: string;
  adSetId?: string;
  adId?: string;
  campaignId?: string;
  historyId?: string;
  error?: string;
  results?: Array<{ filename: string; adSetId?: string; status: string; adId?: string; error?: string }>;
  summary?: { total: number; success: number; failed: number };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/avi']);

const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

const VIDEO_POLL_INTERVAL_MS = 2000;
const VIDEO_POLL_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Run a multi-ad-set launch. `onProgress` receives an event for every
 * milestone — pipe it straight to the SSE stream. Returns the history row
 * id so the caller can show "View in History" links.
 */
export async function runBulkLaunch(
  input: BulkLaunchInput,
  files: UploadedCreative[],
  onProgress: (e: ProgressEvent) => void
): Promise<{ historyId: string; campaignId: string | null; success: number; failed: number }> {
  if (files.length === 0) throw new Error('No creative files provided');
  if (!input.adSets || input.adSets.length === 0) throw new Error('At least one ad set is required');

  const accountId = formatAccountId(input.adAccountId);
  const accessToken = resolveToken(accountId, input.fallbackAccessToken);
  const status = input.status || 'PAUSED';
  const objective = input.objective || 'OUTCOME_SALES';

  // Create a history row up front so even an early-fail campaign shows in
  // the UI with a useful error.
  const history = await prisma.adLaunchHistory.create({
    data: {
      userId: input.userId || 'anonymous',
      accountId: accountId.replace(/^act_/, ''),
      campaignName: input.campaignName,
      status: 'pending',
      totalAds: input.adSets.length * files.length,
      configSnapshot: sanitizeConfigForSnapshot(input) as unknown as Prisma.InputJsonValue
    }
  });

  let campaignId: string | null = null;
  const allResults: Array<{ filename: string; adSetId?: string; status: 'success' | 'failed'; adId?: string; error?: string }> = [];

  try {
    // 1. Campaign — single campaign with CBO (or no campaign budget if ad
    //    sets carry their own).
    onProgress({ step: 'campaign', status: 'creating', message: `Creating campaign "${input.campaignName}"...` });
    const useCBO = !!input.campaignDailyBudget;
    const campaign = await createCampaign(accountId, accessToken, {
      name: input.campaignName,
      objective,
      ...(useCBO ? mapBidStrategyForCampaign(input) : {}),
      ...(useCBO ? { daily_budget: String(input.campaignDailyBudget) } : {}),
      status
    });
    campaignId = campaign.id;
    await prisma.adLaunchHistory.update({ where: { id: history.id }, data: { campaignId } });
    onProgress({ step: 'campaign', status: 'done', id: campaign.id, campaignId, message: `Campaign ${campaign.id}` });

    // 2. Ad sets — one FB ad set per AdSetSpec.
    const startTimeIso = new Date((input.startTime || nextUtcMidnightSeconds()) * 1000).toISOString();
    const createdAdSets: Array<{ id: string; spec: AdSetSpec }> = [];

    for (let i = 0; i < input.adSets.length; i++) {
      const spec = input.adSets[i];
      onProgress({
        step: 'adset', status: 'creating',
        index: i, total: input.adSets.length,
        message: `Ad set ${i + 1}/${input.adSets.length}: "${spec.name}"...`
      });

      const targeting = buildTargeting(spec.audience);
      const adSetPayload: Record<string, unknown> = {
        name: `${input.campaignName} — ${spec.name}`,
        campaign_id: campaign.id,
        targeting,
        start_time: startTimeIso,
        optimization_goal: spec.audience.optimizationGoal || 'OFFSITE_CONVERSIONS',
        billing_event: 'IMPRESSIONS',
        promoted_object: {
          pixel_id: input.pixelId,
          custom_event_type: spec.audience.customEventType || 'PURCHASE'
        },
        status
      };
      // Per-ad-set budget — required when the campaign isn't CBO.
      if (spec.dailyBudget) {
        adSetPayload.daily_budget = String(spec.dailyBudget);
      } else if (!useCBO) {
        throw new Error(`Ad set "${spec.name}" needs a daily_budget when the campaign is not CBO`);
      }
      // Bid strategy / amount only when not CBO — under CBO they sit on the campaign.
      if (!useCBO) Object.assign(adSetPayload, mapBidStrategyForAdSet(input));

      const adSet = await createAdSet(accountId, accessToken, adSetPayload);
      createdAdSets.push({ id: adSet.id, spec });
      onProgress({ step: 'adset', status: 'done', id: adSet.id, adSetId: adSet.id, message: `Ad set ${adSet.id}` });
    }

    // 3. Per-creative: upload media once, then create one ad per ad set it
    //    belongs to. Image hash + video id are cached so the same creative
    //    used in 3 ad sets uploads once.
    const imageHashByFile = new Map<string, string>();   // sha256(buffer) → image_hash
    const videoIdByFile   = new Map<string, string>();
    const link = input.urlParams
      ? `${input.linkUrl}${input.linkUrl.includes('?') ? '&' : '?'}${input.urlParams}`
      : input.linkUrl;
    const cta = input.callToAction || 'SHOP_NOW';

    let unitsDone = 0;
    const adsTotal = createdAdSets.reduce((acc, { }, idx) => {
      return acc + files.filter(f => fileBelongsToAdSet(f, idx)).length;
    }, 0);

    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi];
      const isImage = IMAGE_TYPES.has(f.mimetype);
      const isVideo = VIDEO_TYPES.has(f.mimetype);
      if (!isImage && !isVideo) {
        const msg = `Unsupported file type: ${f.mimetype}`;
        for (let asi = 0; asi < createdAdSets.length; asi++) {
          if (!fileBelongsToAdSet(f, asi)) continue;
          allResults.push({ filename: f.filename, status: 'failed', error: msg, adSetId: createdAdSets[asi].id });
          onProgress({
            step: 'upload', status: 'failed',
            index: unitsDone++, total: adsTotal,
            filename: f.filename, error: msg,
            adSetId: createdAdSets[asi].id,
            message: `${f.filename} → ${createdAdSets[asi].spec.name}: ${msg}`
          });
        }
        continue;
      }
      if (isImage && f.buffer.length > MAX_IMAGE_SIZE) {
        recordFileFailure(f, 'Image > 30 MB', createdAdSets, allResults, onProgress, () => unitsDone++, adsTotal);
        continue;
      }
      if (isVideo && f.buffer.length > MAX_VIDEO_SIZE) {
        recordFileFailure(f, 'Video > 500 MB', createdAdSets, allResults, onProgress, () => unitsDone++, adsTotal);
        continue;
      }

      // Upload media (deduped within batch by content sha)
      const sha = sha256(f.buffer);
      let imageHash: string | undefined;
      let videoId: string | undefined;

      try {
        if (isImage) {
          imageHash = imageHashByFile.get(sha);
          if (!imageHash) {
            onProgress({ step: 'upload', status: 'uploading', filename: f.filename, message: `${f.filename} uploading…` });
            imageHash = (await uploadImage(accountId, accessToken, f.buffer, f.filename)).image_hash;
            imageHashByFile.set(sha, imageHash);
          }
        } else {
          videoId = videoIdByFile.get(sha);
          if (!videoId) {
            onProgress({ step: 'upload', status: 'uploading', filename: f.filename, message: `${f.filename} uploading…` });
            videoId = (await uploadVideo(accountId, accessToken, f.buffer, f.filename)).video_id;
            onProgress({ step: 'video-wait', status: 'waiting', filename: f.filename, id: videoId, message: `Waiting for ${f.filename} to finish processing on Facebook…` });
            await waitForVideoReady(videoId, accessToken);
            videoIdByFile.set(sha, videoId);
          }
        }
      } catch (e: any) {
        recordFileFailure(f, e?.message || String(e), createdAdSets, allResults, onProgress, () => unitsDone++, adsTotal);
        continue;
      }

      // Create one ad per (ad set this file belongs to)
      for (let asi = 0; asi < createdAdSets.length; asi++) {
        if (!fileBelongsToAdSet(f, asi)) continue;
        const adSet = createdAdSets[asi];

        try {
          const copy = mergeCopy(f.copy, input.globalCopy);
          const ad = await createAdInline(accountId, accessToken, {
            name: `Ad — ${stripExt(f.filename)} — ${adSet.spec.name}`,
            adset_id: adSet.id,
            creative: buildCreative({
              imageHash, videoId, pageId: input.pageId,
              instagramActorId: input.instagramActorId,
              link, copy, cta
            }),
            degrees_of_freedom_spec: buildDegreesOfFreedom(copy),
            status
          });
          allResults.push({ filename: f.filename, status: 'success', adId: ad.id, adSetId: adSet.id });
          await prisma.adLaunchItem.create({
            data: {
              historyId: history.id,
              filename: f.filename,
              adSetId: adSet.id,
              adId: ad.id,
              status: 'success'
            }
          });
          onProgress({
            step: 'upload', status: 'done',
            index: unitsDone++, total: adsTotal,
            filename: f.filename, adId: ad.id, adSetId: adSet.id,
            message: `${f.filename} → ${adSet.spec.name} ✓ (ad ${ad.id})`
          });
        } catch (e: any) {
          const msg = parseFbError(e?.message || String(e));
          allResults.push({ filename: f.filename, status: 'failed', error: msg, adSetId: adSet.id });
          await prisma.adLaunchItem.create({
            data: {
              historyId: history.id,
              filename: f.filename,
              adSetId: adSet.id,
              status: 'failed',
              error: msg.slice(0, 1000)
            }
          });
          onProgress({
            step: 'upload', status: 'failed',
            index: unitsDone++, total: adsTotal,
            filename: f.filename, adSetId: adSet.id, error: msg,
            message: `${f.filename} → ${adSet.spec.name}: ${msg}`
          });
        }

        // Light throttle so big batches don't hit FB's per-app rate ceiling.
        await sleep(200);
      }
    }

    const ok = allResults.filter(r => r.status === 'success').length;
    const fail = allResults.length - ok;
    const finalStatus = fail === 0 ? 'success' : ok === 0 ? 'failed' : 'partial';

    await prisma.adLaunchHistory.update({
      where: { id: history.id },
      data: {
        status: finalStatus,
        successAds: ok,
        failedAds: fail,
        totalAds: allResults.length,
        errorSummary: fail > 0 ? `${fail} ad(s) failed; see items` : null
      }
    });

    onProgress({
      step: 'history-saved', status: 'done',
      historyId: history.id, campaignId,
      message: `Saved to history (${history.id.slice(0, 8)}…)`
    });
    onProgress({
      step: 'complete', status: 'done',
      campaignId: campaignId || undefined,
      historyId: history.id,
      results: allResults,
      summary: { total: allResults.length, success: ok, failed: fail },
      message: `Done — ${ok} ads created, ${fail} failed. All ${status} in Ads Manager.`
    });

    return { historyId: history.id, campaignId, success: ok, failed: fail };
  } catch (e: any) {
    const msg = parseFbError(e?.message || String(e));
    await prisma.adLaunchHistory.update({
      where: { id: history.id },
      data: {
        status: campaignId ? 'partial' : 'failed',
        errorSummary: msg.slice(0, 1000),
        successAds: allResults.filter(r => r.status === 'success').length,
        failedAds: allResults.filter(r => r.status === 'failed').length
      }
    });
    onProgress({ step: 'error', status: 'failed', error: msg, message: msg, historyId: history.id });
    throw e;
  }
}

// ─── FB Marketing API helpers ───────────────────────────────────────────────

async function createCampaign(accountId: string, token: string, data: {
  name: string;
  objective: string;
  daily_budget?: string;
  bid_strategy?: string;
  status: string;
}): Promise<{ id: string }> {
  return fbPost(`${FB_BASE}/${accountId}/campaigns`, token, {
    ...data,
    special_ad_categories: '[]'
  });
}

async function createAdSet(accountId: string, token: string, payload: Record<string, unknown>): Promise<{ id: string }> {
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

/**
 * Poll /{video_id}?fields=status until video_status is 'ready' (or up to
 * 5 min). FB's /advideos returns the id while the video is still being
 * processed — creating an ad immediately against a not-ready video fails.
 *
 * Returns when ready, throws on error_status or timeout.
 */
async function waitForVideoReady(videoId: string, token: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < VIDEO_POLL_TIMEOUT_MS) {
    const url = `${FB_BASE}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (res.ok) {
      const json: any = await res.json();
      const vs = json?.status?.video_status;
      if (vs === 'ready') return;
      if (vs === 'error') throw new Error(`Video processing failed on FB (${json?.status?.processing_phase || 'unknown phase'})`);
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);
  }
  throw new Error('Video processing timed out after 5 minutes');
}

/**
 * List pages the user can run ads from on this ad account.
 *
 * Strategy:
 *   1. `/{aid}/promote_pages` — pages explicitly linked to the ad
 *      account. Returns nothing if no page has been added in Ads Manager
 *      → Account Settings → Pages. This is the FB-recommended path.
 *   2. Fallback `/me/accounts` — all pages the user manages. We surface
 *      these when promote_pages is empty so the wizard never shows an
 *      empty dropdown just because the BM admin forgot to link a page
 *      to the ad account. Token must have `pages_show_list` for this.
 *
 * Deduped by page id; instagram_business_account preserved when present.
 */
export async function listPromotablePages(
  accountId: string,
  fallbackToken?: string
): Promise<Array<{ id: string; name: string; instagram_business_account?: { id: string } }>> {
  const aid = formatAccountId(accountId);
  const token = resolveToken(aid, fallbackToken);
  const out: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> = [];

  // 1. promote_pages — primary source.
  let url: string | null = `${FB_BASE}/${aid}/promote_pages?fields=id,name,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`;
  while (url && out.length < 500) {
    const res: Response = await fetch(url);
    if (!res.ok) {
      // Don't throw — fall through to /me/accounts so an unrelated permission
      // gap on promote_pages doesn't kill the picker entirely. We log so
      // the operator still sees why this path failed.
      console.warn(`[fb-ad-launch] /${aid}/promote_pages failed:`, (await res.text()).slice(0, 300));
      break;
    }
    const json: any = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
    url = json?.paging?.next || null;
  }
  if (out.length > 0) return out;

  // 2. /me/accounts fallback — pages the user manages directly.
  //    Requires pages_show_list. Returns id/name/instagram_business_account
  //    (FB exposes the IG-business link the same way here).
  let meUrl: string | null = `${FB_BASE}/me/accounts?fields=id,name,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`;
  const seen = new Set<string>();
  while (meUrl && out.length < 500) {
    const res: Response = await fetch(meUrl);
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.warn(`[fb-ad-launch] /me/accounts failed:`, body);
      // Surface a token-scope hint so the user knows what to do.
      throw new Error(
        `Couldn't load Pages — FB returned ${res.status}. Most common cause: ` +
        `the FB Login token is missing pages_show_list. Disconnect Facebook ` +
        `and re-Connect; new tokens now request that permission.`
      );
    }
    const json: any = await res.json();
    for (const p of json?.data || []) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    meUrl = json?.paging?.next || null;
  }
  return out;
}

/**
 * List pixels on the ad account.
 *
 * `/{aid}/adspixels` returns the pixels the ad account can use. If the
 * caller isn't an admin/advertiser on the BM that owns the pixel, FB
 * returns an empty list silently. We surface a clearer error so the
 * user knows whether it's a permission gap vs genuinely-no-pixel.
 */
export async function listPixels(
  accountId: string,
  fallbackToken?: string
): Promise<Array<{ id: string; name: string }>> {
  const aid = formatAccountId(accountId);
  const token = resolveToken(aid, fallbackToken);
  const url = `${FB_BASE}/${aid}/adspixels?fields=id,name&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(
      `Couldn't load Pixels — FB returned ${res.status}. Likely the user ` +
      `isn't an advertiser on the Business that owns this ad account, or ` +
      `the token is missing ads_management. Raw: ${body}`
    );
  }
  const json: any = await res.json();
  return json.data || [];
}

/** List custom + lookalike audiences on the ad account. Powers the targeting picker. */
export async function listCustomAudiences(accountId: string, fallbackToken?: string): Promise<Array<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number }>> {
  const aid = formatAccountId(accountId);
  const token = resolveToken(aid, fallbackToken);
  let url: string | null = `${FB_BASE}/${aid}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound&limit=100&access_token=${encodeURIComponent(token)}`;
  const out: any[] = [];
  while (url && out.length < 500) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`customaudiences failed: ${await res.text()}`);
    const json: any = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
    url = json?.paging?.next || null;
  }
  return out;
}

/** Search FB's detailed-targeting interests by query. Used to attach interests to ad sets. */
export async function searchInterests(query: string, fallbackToken?: string, accountId?: string): Promise<Array<{ id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[] }>> {
  // The search endpoint is account-agnostic; we still need a token, so reuse
  // the same resolver logic.
  const token = accountId
    ? resolveToken(formatAccountId(accountId), fallbackToken)
    : (fallbackToken || (pool.isPoolConfigured() ? pool.tokenForAccount('1') : ''));
  if (!token) throw new Error('No FB token available for interests search');
  const url = `${FB_BASE}/search?type=adinterest&q=${encodeURIComponent(query)}&limit=25&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`interests search failed: ${await res.text()}`);
  const json: any = await res.json();
  return json.data || [];
}

/** Delete a campaign (cascades to ad sets + ads on FB). Used by the rollback flow. */
export async function deleteCampaignOnFb(campaignId: string, accountId: string, fallbackToken?: string): Promise<void> {
  const token = resolveToken(formatAccountId(accountId), fallbackToken);
  const url = `${FB_BASE}/${campaignId}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    // FB returns 200 with {success:true} on success; the !res.ok path is real.
    throw new Error(`Delete campaign failed: ${text}`);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function formatAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

function resolveToken(accountId: string, fallback?: string): string {
  if (fallback && fallback.length > 0) return fallback;
  const idNoPrefix = accountId.replace(/^act_/, '');
  if (pool.isPoolConfigured()) {
    try { return pool.tokenForAccount(idNoPrefix); }
    catch { /* fall through */ }
  }
  throw new Error('No FB token available — connect Facebook (user-token mode) or configure the Adlux system-user pool.');
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

/**
 * Translate the wizard's bid-strategy choice into the actual FB enum +
 * bid_amount semantics for an AD SET. From Meta's official docs:
 *
 *   - LOWEST_COST_WITHOUT_CAP (Highest Volume): no bid_amount, no extra
 *     flags. This is also FB's default when bid_strategy is omitted.
 *   - LOWEST_COST_WITH_BID_CAP (Bid cap): bid_amount required (cents).
 *   - COST_CAP: bid_amount required + billing_event=IMPRESSIONS +
 *     pacing_type=standard.
 *
 * The previous code only sent bid_strategy=COST_CAP for cost_cap and
 * dropped the strategy entirely for bid_cap — which silently turned bid
 * caps into Highest Volume.
 */
function mapBidStrategyForAdSet(input: BulkLaunchInput): Record<string, unknown> {
  const choice: BidStrategyChoice = input.bidStrategy || 'highest_volume';
  if (choice === 'highest_volume') {
    return { bid_strategy: 'LOWEST_COST_WITHOUT_CAP' };
  }
  if (choice === 'bid_cap') {
    if (!input.bidAmount || input.bidAmount <= 0) throw new Error('Bid cap requires a bid_amount > 0 (cents)');
    return { bid_strategy: 'LOWEST_COST_WITH_BID_CAP', bid_amount: String(input.bidAmount) };
  }
  // cost_cap
  if (!input.bidAmount || input.bidAmount <= 0) throw new Error('Cost cap requires a bid_amount > 0 (cents)');
  return { bid_strategy: 'COST_CAP', bid_amount: String(input.bidAmount), pacing_type: '["standard"]' };
}

/** Same mapping but for campaign-level (CBO). bid_amount lives on the campaign too. */
function mapBidStrategyForCampaign(input: BulkLaunchInput): Record<string, unknown> {
  const mapped = mapBidStrategyForAdSet(input);
  // Campaigns don't take pacing_type — that's an ad-set field. Strip it.
  const { pacing_type, ...rest } = mapped as any;
  return rest;
}

function buildTargeting(a: AudienceSpec): Record<string, unknown> {
  const t: Record<string, unknown> = {};
  if (a.countries?.length) t.geo_locations = { countries: a.countries };
  if (typeof a.ageMin === 'number') t.age_min = Math.max(13, Math.min(65, a.ageMin));
  if (typeof a.ageMax === 'number') t.age_max = Math.max(13, Math.min(65, a.ageMax));
  if (a.genders?.length) t.genders = a.genders;

  if (a.customAudiences?.length || a.lookalikes?.length) {
    // Lookalikes are just custom audiences with subtype=LOOKALIKE — they go
    // into the same `custom_audiences` array on the targeting object.
    const ids = [...(a.customAudiences || []), ...(a.lookalikes || [])];
    t.custom_audiences = ids.map(id => ({ id }));
  }
  if (a.excludedCustomAudiences?.length) {
    t.excluded_custom_audiences = a.excludedCustomAudiences.map(id => ({ id }));
  }
  if (a.interestIds?.length) {
    t.flexible_spec = [{ interests: a.interestIds.map(id => ({ id })) }];
  }

  if (a.publisherPlatforms?.length) t.publisher_platforms = a.publisherPlatforms;
  if (a.facebookPositions?.length) t.facebook_positions = a.facebookPositions;
  if (a.instagramPositions?.length) t.instagram_positions = a.instagramPositions;
  if (a.devicePlatforms?.length) t.device_platforms = a.devicePlatforms;

  return t;
}

function buildCreative(args: {
  imageHash?: string;
  videoId?: string;
  pageId: string;
  instagramActorId?: string;
  link: string;
  copy: AdCopy;
  cta: string;
}): Record<string, unknown> {
  const { imageHash, videoId, pageId, instagramActorId, link, copy, cta } = args;
  if (videoId) {
    const videoData: Record<string, unknown> = {
      video_id: videoId,
      message: copy.primary_texts[0] || '',
      title: copy.headlines[0] || '',
      call_to_action: { type: cta, value: { link } }
    };
    const spec: Record<string, unknown> = { page_id: pageId, video_data: videoData };
    if (instagramActorId) spec.instagram_actor_id = instagramActorId;
    return { object_story_spec: spec };
  }
  // image / no-media
  const linkData: Record<string, unknown> = {
    message: copy.primary_texts[0] || '',
    name: copy.headlines[0] || '',
    description: copy.descriptions[0] || '',
    link,
    call_to_action: { type: cta }
  };
  if (imageHash) linkData.image_hash = imageHash;
  const spec: Record<string, unknown> = { page_id: pageId, link_data: linkData };
  if (instagramActorId) spec.instagram_actor_id = instagramActorId;
  return { object_story_spec: spec };
}

function buildDegreesOfFreedom(copy: AdCopy): Record<string, unknown> {
  return {
    creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
    multi_text_optimization_spec: {
      bodies: copy.primary_texts.slice(0, 5).map(t => ({ text: t })),
      titles: copy.headlines.slice(0, 5).map(t => ({ text: t })),
      descriptions: copy.descriptions.slice(0, 5).map(t => ({ text: t }))
    }
  };
}

function fileBelongsToAdSet(f: UploadedCreative, adSetIndex: number): boolean {
  if (!f.adSetIndexes || f.adSetIndexes.length === 0) return true;
  return f.adSetIndexes.includes(adSetIndex);
}

function recordFileFailure(
  f: UploadedCreative,
  msg: string,
  createdAdSets: Array<{ id: string; spec: AdSetSpec }>,
  allResults: Array<{ filename: string; adSetId?: string; status: 'success' | 'failed'; adId?: string; error?: string }>,
  onProgress: (e: ProgressEvent) => void,
  bumpIndex: () => number,
  total: number
) {
  for (let asi = 0; asi < createdAdSets.length; asi++) {
    if (!fileBelongsToAdSet(f, asi)) continue;
    const adSetId = createdAdSets[asi].id;
    allResults.push({ filename: f.filename, status: 'failed', error: msg, adSetId });
    onProgress({
      step: 'upload', status: 'failed',
      index: bumpIndex(), total,
      filename: f.filename, error: msg, adSetId,
      message: `${f.filename}: ${msg}`
    });
  }
}

function nextUtcMidnightSeconds(): number {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * FB error responses are nested under {error: {message, code, error_subcode}}.
 * The fetch wrapper just stringifies the body — pull the human message out
 * if we can so the merchant sees something actionable.
 */
function parseFbError(raw: string): string {
  try {
    const idx = raw.indexOf('{');
    if (idx < 0) return raw;
    const json = JSON.parse(raw.slice(idx));
    const err = json?.error;
    if (!err) return raw;
    const code = err.code ? ` (#${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})` : '';
    return `${err.message || raw}${code}`;
  } catch {
    return raw;
  }
}

/** Strips sensitive bits from the launch input before persisting. */
function sanitizeConfigForSnapshot(input: BulkLaunchInput): Record<string, unknown> {
  const { fallbackAccessToken, userId, ...safe } = input;
  return safe;
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
