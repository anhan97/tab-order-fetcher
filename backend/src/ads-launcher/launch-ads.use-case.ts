/**
 * LaunchAds — one request = one campaign (new or existing) × N ad sets (§8.2).
 *
 * The rule everything here bends around: writes to Meta cannot be rolled
 * back. Once a node has a Meta id, a failure to save it locally is NEVER
 * reported as `failed` (the client would retry and create a duplicate) — it
 * is `ok` + `warning`, logged, and the next sync merges it. And one item
 * failing never stops its siblings.
 */
import { createHash } from 'crypto';
import {
  type LaunchAdResult,
  type LaunchAdSpec,
  type LaunchAdsetResult,
  type LaunchRequest,
  type LaunchResult,
  type NodeStatus,
  LIMITS,
  needsPixel
} from './contract';
import { creativeKey, numberDuplicateNames, postKey } from './ad-names';
import {
  type AdCopy,
  type BidHolder,
  type MetaFields,
  adFields,
  adsetBidProblem,
  adsetFields,
  campaignFields,
  imageCreativeFields,
  postCreativeFields,
  videoCreativeFields
} from './meta-params';
import { type MetaAdsWriter, MetaUnavailableError, knownBidStrategy } from './meta-ads-writer';

// ─── Ports ──────────────────────────────────────────────────────────────────

export interface LaunchScope {
  /** Tenant: the store owner. */
  ownerId: string;
  storeId: string;
  /** Who pressed Launch. */
  actorId: string;
}

export interface CreativeRecord {
  id: string;
  name: string;
  status: string;
  primaryText: string | null;
  headline: string | null;
  description: string | null;
  mediaType: 'image' | 'video';
  mediaPath: string;
  posterPath: string | null;
  /** Public paths for the mirror's thumbnail/image columns. */
  thumbUrl: string | null;
  mediaUrl: string;
}

export interface CampaignMirror {
  ownerId: string;
  storeId: string;
  adAccountId: string;
  externalId: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudget: string | null;
  bidStrategy: string | null;
  raw: Record<string, unknown>;
}

export interface AdsetMirror {
  ownerId: string;
  campaignId: string;
  adAccountId: string;
  externalId: string;
  name: string;
  status: string;
  dailyBudget: string | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  targeting: unknown;
  raw: Record<string, unknown>;
}

export interface AdMirror {
  ownerId: string;
  storeId: string;
  adsetId: string;
  adAccountId: string;
  externalId: string;
  name: string;
  status: string;
  creativeId: string | null;
  postId: string | null;
  metaCreativeId: string;
  pageId: string;
  link: string | null;
  displayLink: string | null;
  urlTags: string | null;
  title: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  callToActionType: string | null;
  creativeData: Record<string, unknown>;
  launchId: string | null;
  launchedBy: string;
}

export interface MirrorCampaignRow {
  id: string;
  adAccountId: string;
  name: string;
  dailyBudget: string | null;
  bidStrategy: string | null;
  raw: any;
}

export interface LaunchRepo {
  /** Creatives in the caller's scope, not deleted (archived included). */
  loadCreatives(ids: string[], scope: LaunchScope): Promise<CreativeRecord[]>;
  findCampaign(ownerId: string, externalId: string): Promise<MirrorCampaignRow | null>;
  upsertCampaign(row: CampaignMirror): Promise<{ id: string }>;
  findAdset(ownerId: string, externalId: string): Promise<{ id: string; campaignExternalId: string; name: string } | null>;
  upsertAdset(row: AdsetMirror): Promise<{ id: string }>;
  upsertAd(row: AdMirror): Promise<{ id: string }>;
  /** Text/images of the newest ad already running this post, for the mirror. */
  latestAdForPost(ownerId: string, postId: string): Promise<{ title: string | null; body: string | null; thumbnailUrl: string | null; imageUrl: string | null; link: string | null } | null>;
}

export interface MediaSource {
  readBytes(relPath: string): Promise<Buffer>;
  /** Absolute public HTTPS URL, or null when files are not publicly reachable. */
  publicUrl(relPath: string): string | null;
}

/** Shares uploaded media + Meta creatives between the requests of one launch (§8.6). */
export interface AssetCache {
  get<T>(kind: 'media' | 'creative', hash: string): Promise<T | null>;
  set(kind: 'media' | 'creative', hash: string, value: unknown): Promise<void>;
}

export const noCache: AssetCache = { get: async () => null, set: async () => undefined };

export interface LaunchDeps {
  writer: MetaAdsWriter;
  repo: LaunchRepo;
  media: MediaSource;
  cache?: AssetCache;
  scope: LaunchScope;
  isDemo: boolean;
  /** Video processing poll (§8.2 step 7): 10 × 3 s by default. */
  videoPoll?: { attempts: number; intervalMs: number };
  log?: Pick<Console, 'error' | 'warn'>;
}

export class LaunchError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'LaunchError';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hashOf = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
const unique = <T>(xs: T[]) => [...new Set(xs)];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const WARN_NOT_SAVED = 'Created on Meta but not saved locally yet. The next sync will pick it up.';

type MediaAsset =
  | { kind: 'image'; imageHash: string }
  | { kind: 'video'; videoId: string; thumbnailHash?: string; thumbnailUrl?: string };

interface PlannedAd {
  spec: LaunchAdSpec;
  name: string;
  key: string;
  kind: 'creative' | 'post';
  /** Library creative (for posts: the optional analytics link). */
  creative: CreativeRecord | null;
  postId: string | null;
  link: string | null;
  copy: AdCopy | null;
}

// ─── Use case ───────────────────────────────────────────────────────────────

export async function launchAds(req: LaunchRequest, deps: LaunchDeps): Promise<LaunchResult> {
  const { writer, repo, media, scope } = deps;
  const cache = deps.cache ?? noCache;
  const log = deps.log ?? console;
  const act = req.adAccountId;
  const displayLink = req.destination?.displayLink?.trim() || '';
  const launchId = req.launchId ?? null;

  // 1. Each ad set's own ads, or the request's shared list.
  const adsetAds = req.adsets.map(a => a.ads ?? req.ads);

  // 2. Ads made from creatives need a landing page.
  const fromCreative = adsetAds.flat().filter(ad => !ad.postId);
  if (fromCreative.length > 0 && !req.destination) {
    throw new LaunchError(400, 'destination_required', 'A landing page is required for ads made from creatives');
  }

  // 3–4. Creatives: in scope, not deleted. Ads FROM a creative need it active;
  // a creative merely linked to a post may be anything (or gone — then the
  // link is dropped and the post still runs).
  const directIds = unique(fromCreative.map(ad => ad.creativeId!).filter(Boolean));
  const linkedIds = unique(adsetAds.flat().filter(ad => ad.postId && ad.creativeId).map(ad => ad.creativeId!));
  const records = await repo.loadCreatives(unique([...directIds, ...linkedIds]), scope);
  const byId = new Map(records.map(r => [r.id, r]));
  const missing = directIds.filter(id => !byId.has(id));
  if (missing.length > 0) {
    throw new LaunchError(404, 'creative_not_found', 'Creative not found', { creativeIds: missing });
  }
  const archived = directIds.filter(id => byId.get(id)!.status !== 'active');
  if (archived.length > 0) {
    throw new LaunchError(404, 'creative_archived', 'Creative is archived — restore it in the library before launching', { creativeIds: archived });
  }

  // 5. Plan every ad: name, copy, link, and the key that decides which ads
  // share one Meta creative.
  const plans: PlannedAd[][] = adsetAds.map(ads => {
    const planned = ads.map((spec): PlannedAd => {
      if (spec.postId) {
        const creative = spec.creativeId ? byId.get(spec.creativeId) ?? null : null;
        return {
          spec,
          name: spec.name ?? creative?.name ?? `Post ${spec.postId}`,
          key: postKey(spec.postId, req.urlTags),
          kind: 'post',
          creative,
          postId: spec.postId,
          link: null,
          copy: null
        };
      }
      const creative = byId.get(spec.creativeId!)!;
      const copy: AdCopy = {
        primaryText: spec.primaryText ?? creative.primaryText ?? '',
        headline: spec.headline ?? creative.headline ?? '',
        description: spec.description ?? creative.description ?? ''
      };
      const link = spec.link ?? req.destination!.url;
      return {
        spec,
        name: spec.name ?? creative.name,
        key: creativeKey({ creativeId: creative.id, pageId: req.pageId, link, displayLink, callToAction: req.callToAction, urlTags: req.urlTags, copy }),
        kind: 'creative',
        creative,
        postId: null,
        link,
        copy
      };
    });
    const numbered = numberDuplicateNames(planned.map(p => p.name), LIMITS.nameLength);
    return planned.map((p, i) => ({ ...p, name: numbered[i] }));
  });

  const skippedAdsets = (reason: string): LaunchAdsetResult[] =>
    req.adsets.map((a, i) => ({
      status: 'skipped',
      name: a.mode === 'new' ? a.name : `Ad set ${a.adsetId}`,
      error: reason,
      ads: plans[i].map(p => adResult(p, 'skipped', { error: reason }))
    }));

  // 6. Campaign.
  let campaignExternalId: string;
  let campaignMirrorId: string | null = null;
  let campaignName: string;
  let holder: BidHolder;
  let campaignWarning: string | undefined;
  let campaignCreated = false;

  try {
    if (req.campaign.mode === 'existing') {
      const found = await resolveExistingCampaign(req.campaign.campaignId);
      campaignExternalId = found.externalId;
      campaignName = found.name;
      campaignMirrorId = found.mirrorId;
      holder = found.cbo ? { mode: 'CBO', strategy: found.strategy } : { mode: 'ABO' };
    } else {
      const c = req.campaign;
      const cbo = !!c.dailyBudget;
      const strategy = c.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
      const fields = campaignFields({ name: c.name, objective: c.objective, status: c.status, dailyBudget: c.dailyBudget, bidStrategy: strategy });
      const created = await writer.createCampaign(act, fields);
      campaignExternalId = created.id;
      campaignName = c.name;
      campaignCreated = true;
      holder = cbo ? { mode: 'CBO', strategy } : { mode: 'ABO' };
      try {
        campaignMirrorId = (await repo.upsertCampaign({
          ownerId: scope.ownerId,
          storeId: scope.storeId,
          adAccountId: act,
          externalId: created.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudget: (fields.daily_budget as string) ?? null,
          bidStrategy: cbo ? strategy : null,
          raw: { launched_by: 'ads-launcher', bid_strategy: cbo ? strategy : null, launch_id: launchId, ...(deps.isDemo ? { demo: true } : {}) }
        })).id;
      } catch (e) {
        log.error('[ads-launcher] campaign mirror failed', created.id, e);
        campaignWarning = WARN_NOT_SAVED;
      }
    }
  } catch (e) {
    if (e instanceof MetaUnavailableError) throw e;
    const reason = errMsg(e);
    return {
      campaign: { status: 'failed', name: req.campaign.mode === 'new' ? req.campaign.name : `Campaign ${req.campaign.campaignId}`, error: reason },
      adsets: skippedAdsets('Campaign was not created'),
      summary: { adsCreated: 0, adsFailed: plans.flat().length, adsetsCreated: 0, campaignCreated: false }
    };
  }

  async function resolveExistingCampaign(id: string) {
    const remote = await writer.getCampaign(id);
    const mirror = await repo.findCampaign(scope.ownerId, id);
    if (remote) {
      if (remote.accountId && remote.accountId.replace(/^act_/, '') !== act) {
        throw new Error('That campaign belongs to another ad account');
      }
      let mirrorId = mirror?.id ?? null;
      try {
        mirrorId = (await repo.upsertCampaign({
          ownerId: scope.ownerId,
          storeId: scope.storeId,
          adAccountId: act,
          externalId: remote.id,
          name: remote.name,
          status: remote.status,
          objective: remote.objective,
          dailyBudget: remote.dailyBudget,
          bidStrategy: remote.bidStrategy,
          raw: { ...(mirror?.raw ?? {}), bid_strategy: remote.bidStrategy, lifetime_budget: remote.lifetimeBudget }
        })).id;
      } catch (e) {
        log.error('[ads-launcher] existing campaign mirror failed', id, e);
      }
      return { externalId: remote.id, name: remote.name, mirrorId, cbo: !!(remote.dailyBudget || remote.lifetimeBudget), strategy: remote.bidStrategy };
    }
    // The fake writer forgets on restart; the mirror still knows demo campaigns.
    if (mirror && writer.kind === 'fake' && mirror.adAccountId === act) {
      return {
        externalId: id,
        name: mirror.name,
        mirrorId: mirror.id,
        cbo: !!(mirror.dailyBudget || mirror.raw?.lifetime_budget),
        strategy: knownBidStrategy(mirror.raw?.bid_strategy ?? mirror.bidStrategy)
      };
    }
    throw new Error('Campaign not found in this ad account');
  }

  // 7. Media: each creative uploaded once per request — and once per launch
  // thanks to the cache. A failed upload fails only the ads that use it.
  const mediaByCreative = new Map<string, MediaAsset>();
  const mediaErrors = new Map<string, string>();
  const creativesNeedingMedia = unique(plans.flat().filter(p => p.kind === 'creative').map(p => p.creative!.id)).map(id => byId.get(id)!);
  for (const creative of creativesNeedingMedia) {
    const hash = hashOf(['media', act, creative.id, creative.mediaPath]);
    try {
      const cached = await safeCacheGet<MediaAsset>(cache, 'media', hash, log);
      if (cached) {
        mediaByCreative.set(creative.id, cached);
        continue;
      }
      const asset = await uploadMedia(creative);
      mediaByCreative.set(creative.id, asset);
      await safeCacheSet(cache, 'media', hash, asset, log);
    } catch (e) {
      mediaErrors.set(creative.id, `Upload failed: ${errMsg(e)}`);
    }
  }

  async function uploadMedia(creative: CreativeRecord): Promise<MediaAsset> {
    const fileName = creative.mediaPath.split('/').pop() || creative.id;
    if (creative.mediaType === 'image') {
      const bytes = await media.readBytes(creative.mediaPath);
      const { hash } = await writer.uploadImage(act, { bytes, name: fileName });
      return { kind: 'image', imageHash: hash };
    }
    const fileUrl = media.publicUrl(creative.mediaPath);
    const upload = fileUrl
      ? await writer.uploadVideo(act, { name: fileName, fileUrl })
      : await writer.uploadVideo(act, { name: fileName, bytes: await media.readBytes(creative.mediaPath) });
    const poll = deps.videoPoll ?? { attempts: 10, intervalMs: 3000 };
    for (let i = 0; i < poll.attempts; i++) {
      const s = await writer.getVideoStatus(upload.id);
      if (s.status === 'ready') break;
      if (s.status === 'error') throw new Error(`Meta could not process the video${s.detail ? ` (${s.detail})` : ''}`);
      if (i < poll.attempts - 1) await sleep(poll.intervalMs);
    }
    if (creative.posterPath) {
      const poster = await media.readBytes(creative.posterPath);
      const { hash } = await writer.uploadImage(act, { bytes: poster, name: `${fileName}.poster.jpg` });
      return { kind: 'video', videoId: upload.id, thumbnailHash: hash };
    }
    const thumbnailUrl = await writer.getVideoThumbnailUrl(upload.id);
    if (!thumbnailUrl) throw new Error('This video has no poster image and Meta has no thumbnail for it yet');
    return { kind: 'video', videoId: upload.id, thumbnailUrl };
  }

  // 8. Meta creatives: one per distinct key, reused from the launch cache when
  // another campaign of this launch already made it; the rest in one batch.
  const metaCreative = new Map<string, { id: string; postId: string | null }>();
  const creativeErrors = new Map<string, string>();
  const firstByKey = new Map<string, PlannedAd>();
  for (const p of plans.flat()) if (!firstByKey.has(p.key)) firstByKey.set(p.key, p);

  const toCreate: Array<{ key: string; plan: PlannedAd; fields: MetaFields }> = [];
  for (const [key, p] of firstByKey) {
    const hash = hashOf(['creative', act, key]);
    const cached = await safeCacheGet<{ id: string; postId: string | null }>(cache, 'creative', hash, log);
    if (cached) {
      metaCreative.set(key, cached);
      continue;
    }
    if (p.kind === 'post') {
      toCreate.push({ key, plan: p, fields: postCreativeFields({ name: p.name, postId: p.postId!, urlTags: req.urlTags }) });
      continue;
    }
    const mediaError = mediaErrors.get(p.creative!.id);
    if (mediaError) {
      creativeErrors.set(key, mediaError);
      continue;
    }
    const asset = mediaByCreative.get(p.creative!.id)!;
    const base = { name: p.creative!.name, pageId: req.pageId, link: p.link!, copy: p.copy!, callToAction: req.callToAction, urlTags: req.urlTags };
    const fields = asset.kind === 'image'
      ? imageCreativeFields({ ...base, imageHash: asset.imageHash, displayLink: displayLink || undefined })
      : videoCreativeFields({
        ...base,
        videoId: asset.videoId,
        thumbnail: asset.thumbnailHash ? { imageHash: asset.thumbnailHash } : { imageUrl: asset.thumbnailUrl! }
      });
    toCreate.push({ key, plan: p, fields });
  }

  if (toCreate.length > 0) {
    let results: Array<{ id?: string; error?: string }>;
    try {
      results = await writer.createCreatives(act, toCreate.map(t => t.fields));
    } catch (e) {
      results = toCreate.map(() => ({ error: errMsg(e) }));
    }
    const created: Array<{ key: string; id: string; plan: PlannedAd }> = [];
    toCreate.forEach((t, i) => {
      const r = results[i];
      if (r?.id) created.push({ key: t.key, id: r.id, plan: t.plan });
      else creativeErrors.set(t.key, r?.error || 'Meta did not create this creative');
    });
    // Read back the post each new creative produced (best effort: the next
    // sync fills whatever this misses). Posts already know theirs.
    const needPost = created.filter(c => c.plan.kind === 'creative');
    let postIds: Array<string | null> = [];
    if (needPost.length > 0) {
      try {
        postIds = await writer.readCreativePostIds(needPost.map(c => c.id));
      } catch (e) {
        log.warn('[ads-launcher] reading post ids failed', errMsg(e));
      }
    }
    for (const c of created) {
      const postId = c.plan.kind === 'post' ? c.plan.postId : postIds[needPost.indexOf(c)] ?? null;
      const value = { id: c.id, postId };
      metaCreative.set(c.key, value);
      await safeCacheSet(cache, 'creative', hashOf(['creative', act, c.key]), value, log);
    }
  }

  // 9. Ad sets, each with its ads in one batch.
  const adsetResults: LaunchAdsetResult[] = [];
  let newAdsets = 0;
  for (let i = 0; i < req.adsets.length; i++) {
    const spec = req.adsets[i];
    const planned = plans[i];
    let adsetExternalId: string;
    let adsetMirrorId: string | null = null;
    let adsetName: string;
    let adsetWarning: string | undefined;
    let createdNew = false;

    try {
      if (spec.mode === 'existing') {
        const mirror = await repo.findAdset(scope.ownerId, spec.adsetId);
        if (mirror && mirror.campaignExternalId === campaignExternalId) {
          adsetExternalId = spec.adsetId;
          adsetName = mirror.name;
          adsetMirrorId = mirror.id;
        } else {
          const remote = await writer.getAdSet(spec.adsetId);
          if (!remote || remote.campaignId !== campaignExternalId) throw new Error('Ad set not found in this campaign');
          adsetExternalId = remote.id;
          adsetName = remote.name;
          if (campaignMirrorId) {
            try {
              adsetMirrorId = (await repo.upsertAdset({
                ownerId: scope.ownerId, campaignId: campaignMirrorId, adAccountId: act, externalId: remote.id,
                name: remote.name, status: remote.status, dailyBudget: remote.dailyBudget, bidStrategy: null,
                optimizationGoal: null, targeting: null, raw: {}
              })).id;
            } catch (e) {
              log.error('[ads-launcher] existing ad set mirror failed', remote.id, e);
            }
          }
        }
      } else {
        adsetName = spec.name;
        const pixelId = spec.pixelId ?? req.pixelId;
        const problem = adsetBidProblem(spec, holder)
          ?? (needsPixel(spec.optimizationGoal) && !pixelId ? 'This optimisation goal needs a pixel' : null);
        if (problem) throw new Error(problem);
        const fields = adsetFields(spec, { campaignId: campaignExternalId, holder, pixelId });
        const created = await writer.createAdSet(act, fields);
        adsetExternalId = created.id;
        createdNew = true;
        try {
          if (!campaignMirrorId) throw new Error('campaign mirror missing');
          adsetMirrorId = (await repo.upsertAdset({
            ownerId: scope.ownerId,
            campaignId: campaignMirrorId,
            adAccountId: act,
            externalId: created.id,
            name: spec.name,
            status: spec.status,
            dailyBudget: (fields.daily_budget as string) ?? null,
            bidStrategy: (fields.bid_strategy as string) ?? (holder.mode === 'CBO' ? holder.strategy : null),
            optimizationGoal: spec.optimizationGoal,
            targeting: fields.targeting,
            raw: {
              launched_by: 'ads-launcher',
              bid_amount: fields.bid_amount ?? null,
              bid_constraints: fields.bid_constraints ?? null,
              promoted_object: fields.promoted_object ?? null,
              ...(deps.isDemo ? { demo: true } : {})
            }
          })).id;
        } catch (e) {
          log.error('[ads-launcher] ad set mirror failed', created.id, e);
          adsetWarning = WARN_NOT_SAVED;
        }
      }
    } catch (e) {
      const reason = errMsg(e);
      adsetResults.push({
        status: 'failed',
        name: spec.mode === 'new' ? spec.name : `Ad set ${spec.adsetId}`,
        error: reason,
        ads: planned.map(p => adResult(p, 'skipped', { error: 'Ad set was not created' }))
      });
      continue;
    }

    // Ads whose Meta creative failed carry that exact error; the rest go in one batch.
    const ads: LaunchAdResult[] = new Array(planned.length);
    const batch: Array<{ index: number; fields: MetaFields }> = [];
    planned.forEach((p, idx) => {
      const mc = metaCreative.get(p.key);
      if (!mc) {
        ads[idx] = adResult(p, 'failed', { error: creativeErrors.get(p.key) || 'Creative was not created' });
        return;
      }
      batch.push({ index: idx, fields: adFields({ name: p.name, adsetId: adsetExternalId, creativeId: mc.id, status: req.adStatus }) });
    });

    if (batch.length > 0) {
      let results: Array<{ id?: string; error?: string }>;
      try {
        results = await writer.createAds(act, batch.map(b => b.fields));
      } catch (e) {
        results = batch.map(() => ({ error: errMsg(e) }));
      }
      for (let k = 0; k < batch.length; k++) {
        const { index } = batch[k];
        const p = planned[index];
        const r = results[k];
        if (!r?.id) {
          ads[index] = adResult(p, 'failed', { error: r?.error || 'Meta did not create this ad' });
          continue;
        }
        const mc = metaCreative.get(p.key)!;
        const result = adResult(p, 'ok', { externalId: r.id, postId: mc.postId ?? undefined });
        try {
          if (!adsetMirrorId) throw new Error('ad set mirror missing');
          result.id = (await repo.upsertAd(await adMirrorRow(p, r.id, mc, adsetMirrorId, req.adStatus))).id;
        } catch (e) {
          log.error('[ads-launcher] ad mirror failed', r.id, e);
          result.warning = WARN_NOT_SAVED;
        }
        ads[index] = result;
      }
    }

    adsetResults.push({
      status: 'ok',
      id: adsetMirrorId ?? undefined,
      externalId: adsetExternalId,
      name: adsetName,
      ...(adsetWarning ? { warning: adsetWarning } : {}),
      ads
    });
    if (createdNew) newAdsets++;
  }

  // 10. Results.
  const allAds = adsetResults.flatMap(a => a.ads);
  return {
    campaign: {
      status: 'ok',
      id: campaignMirrorId ?? undefined,
      externalId: campaignExternalId,
      name: campaignName,
      ...(campaignWarning ? { warning: campaignWarning } : {})
    },
    adsets: adsetResults,
    summary: {
      adsCreated: allAds.filter(a => a.status === 'ok').length,
      adsFailed: allAds.filter(a => a.status !== 'ok').length,
      adsetsCreated: newAdsets,
      campaignCreated
    }
  };

  // ── closures over the request ──

  async function adMirrorRow(p: PlannedAd, externalId: string, mc: { id: string; postId: string | null }, adsetId: string, status: NodeStatus): Promise<AdMirror> {
    const base = {
      ownerId: scope.ownerId,
      storeId: scope.storeId,
      adsetId,
      adAccountId: act,
      externalId,
      name: p.name,
      status,
      creativeId: p.creative?.id ?? null,
      postId: mc.postId,
      metaCreativeId: mc.id,
      pageId: req.pageId,
      urlTags: req.urlTags,
      callToActionType: p.kind === 'creative' ? req.callToAction : null,
      launchId,
      launchedBy: scope.actorId
    };
    if (p.kind === 'creative') {
      return {
        ...base,
        link: p.link,
        displayLink: displayLink || null,
        title: p.copy!.headline || null,
        body: p.copy!.primaryText || null,
        thumbnailUrl: p.creative!.thumbUrl,
        imageUrl: p.creative!.mediaType === 'image' ? p.creative!.mediaUrl : p.creative!.thumbUrl,
        creativeData: { library_creative_id: p.creative!.id, meta_creative_id: mc.id, effective_object_story_id: mc.postId }
      };
    }
    // Old post: borrow text/images from the newest ad running it, else from the linked creative.
    const prior = await repo.latestAdForPost(scope.ownerId, p.postId!).catch(() => null);
    return {
      ...base,
      link: prior?.link ?? null,
      displayLink: null,
      title: prior?.title ?? p.creative?.headline ?? null,
      body: prior?.body ?? p.creative?.primaryText ?? null,
      thumbnailUrl: prior?.thumbnailUrl ?? p.creative?.thumbUrl ?? null,
      imageUrl: prior?.imageUrl ?? p.creative?.thumbUrl ?? null,
      creativeData: {
        library_creative_id: p.creative?.id ?? null,
        meta_creative_id: mc.id,
        object_story_id: p.postId,
        effective_object_story_id: p.postId
      }
    };
  }
}

function adResult(p: PlannedAd, status: LaunchAdResult['status'], extra: Partial<LaunchAdResult>): LaunchAdResult {
  return {
    status,
    name: p.name,
    ...(p.creative ? { creativeId: p.creative.id } : {}),
    ...(p.postId ? { postId: p.postId } : {}),
    ...extra
  };
}

async function safeCacheGet<T>(cache: AssetCache, kind: 'media' | 'creative', hash: string, log: Pick<Console, 'warn'>): Promise<T | null> {
  try {
    return await cache.get<T>(kind, hash);
  } catch (e) {
    log.warn('[ads-launcher] asset cache read failed', errMsg(e));
    return null;
  }
}

async function safeCacheSet(cache: AssetCache, kind: 'media' | 'creative', hash: string, value: unknown, log: Pick<Console, 'warn'>): Promise<void> {
  try {
    await cache.set(kind, hash, value);
  } catch (e) {
    log.warn('[ads-launcher] asset cache write failed', errMsg(e));
  }
}
