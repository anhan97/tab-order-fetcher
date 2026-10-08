/**
 * Fake MetaAdsWriter: demo accounts and tests. Never touches the network.
 *
 * Returns numeric ids like Meta's, remembers what it "created" (so existing-
 * campaign flows and post-id reads work across requests), and records every
 * call so tests can assert on sharing / caching. Failure hooks let tests make
 * one element of a batch fail.
 */
import type { ExistingCampaign, InterestOption, LauncherAudience, LauncherPage } from './contract';
import type { MetaFields } from './meta-params';
import type { BatchResult, MetaAdsWriter, RemoteAdSet, RemoteCampaign } from './meta-ads-writer';
import { knownBidStrategy } from './meta-ads-writer';

export const DEMO_AD_ACCOUNT = { id: '900000000000001', name: 'Demo account (no Meta calls)', currency: 'USD' };
export const DEMO_PAGE: LauncherPage = { externalId: '900000000000101', name: 'Demo Page', pictureUrl: null, instagramUserId: '900000000000301', linked: true };
/** A business usually has many pages; only some are linked to the ad account. */
export const DEMO_PAGES: LauncherPage[] = [
  DEMO_PAGE,
  { externalId: '900000000000102', name: 'Demo Brand Two', pictureUrl: null, instagramUserId: null, linked: false },
  { externalId: '900000000000103', name: 'Demo Outlet', pictureUrl: null, instagramUserId: '900000000000303', linked: false }
];
export const DEMO_AUDIENCES: LauncherAudience[] = [
  { externalId: '900000000000401', name: 'Purchasers 180d', subtype: 'WEBSITE', approximateCount: 12000 },
  { externalId: '900000000000402', name: 'LAL 1% Purchasers US', subtype: 'LOOKALIKE', approximateCount: 2300000 }
];
const DEMO_INTERESTS: InterestOption[] = [
  { id: '6003107902433', name: 'Hair care', audienceSizeLower: 150000000, audienceSizeUpper: 180000000, path: ['Interests', 'Beauty', 'Hair care'] },
  { id: '6003348604581', name: 'Hairstyle', audienceSizeLower: 90000000, audienceSizeUpper: 110000000, path: ['Interests', 'Beauty', 'Hairstyle'] },
  { id: '6003020834693', name: 'Travel', audienceSizeLower: 800000000, audienceSizeUpper: 900000000, path: ['Interests', 'Travel'] }
];
export const DEMO_PIXEL = { externalId: '900000000000201', name: 'Demo Pixel' };

export const isDemoAccount = (adAccountId: string) => adAccountId.replace(/^act_/, '') === DEMO_AD_ACCOUNT.id;

interface Stored {
  campaigns: Map<string, RemoteCampaign>;
  adsets: Map<string, RemoteAdSet>;
  creatives: Map<string, MetaFields>;
  ads: Map<string, { fields: MetaFields; creativeId: string }>;
}

const shared: Stored = { campaigns: new Map(), adsets: new Map(), creatives: new Map(), ads: new Map() };

let seq = 0;
const nextId = () => `12020${Date.now().toString().slice(-9)}${String(++seq).padStart(4, '0')}`;

export interface FakeWriterOptions {
  /** Return an error message to fail that element. */
  failCampaign?: (fields: MetaFields) => string | null;
  failAdset?: (fields: MetaFields) => string | null;
  failUpload?: (name: string) => string | null;
  failCreative?: (fields: MetaFields) => string | null;
  failAd?: (fields: MetaFields) => string | null;
  /** Video status sequence returned by getVideoStatus (default: ready). */
  videoStatuses?: Array<'ready' | 'processing' | 'error'>;
  /** Isolated state (tests) instead of the process-wide demo store. */
  isolated?: boolean;
}

export class FakeMetaAdsWriter implements MetaAdsWriter {
  readonly kind = 'fake' as const;
  readonly calls: Array<{ op: string; adAccountId?: string; payload?: unknown }> = [];
  private readonly store: Stored;

  constructor(private readonly opts: FakeWriterOptions = {}) {
    this.store = opts.isolated ? { campaigns: new Map(), adsets: new Map(), creatives: new Map(), ads: new Map() } : shared;
  }

  count(op: string): number {
    return this.calls.filter(c => c.op === op).length;
  }

  async createCampaign(adAccountId: string, fields: MetaFields) {
    this.calls.push({ op: 'createCampaign', adAccountId, payload: fields });
    const fail = this.opts.failCampaign?.(fields);
    if (fail) throw new Error(fail);
    const id = nextId();
    this.store.campaigns.set(id, {
      id,
      accountId: adAccountId,
      name: String(fields.name),
      status: String(fields.status),
      objective: (fields.objective as string) ?? null,
      dailyBudget: (fields.daily_budget as string) ?? null,
      lifetimeBudget: null,
      bidStrategy: knownBidStrategy(fields.bid_strategy)
    });
    return { id };
  }

  async createAdSet(adAccountId: string, fields: MetaFields) {
    this.calls.push({ op: 'createAdSet', adAccountId, payload: fields });
    const fail = this.opts.failAdset?.(fields);
    if (fail) throw new Error(fail);
    const id = nextId();
    this.store.adsets.set(id, {
      id,
      campaignId: String(fields.campaign_id),
      name: String(fields.name),
      status: String(fields.status),
      dailyBudget: (fields.daily_budget as string) ?? null
    });
    return { id };
  }

  async uploadImage(adAccountId: string, input: { bytes: Buffer; name: string }) {
    this.calls.push({ op: 'uploadImage', adAccountId, payload: { name: input.name, size: input.bytes.length } });
    const fail = this.opts.failUpload?.(input.name);
    if (fail) throw new Error(fail);
    return { hash: `fakehash${nextId()}` };
  }

  async uploadVideo(adAccountId: string, input: { name: string; fileUrl?: string; bytes?: Buffer }) {
    this.calls.push({ op: 'uploadVideo', adAccountId, payload: { name: input.name, fileUrl: input.fileUrl } });
    const fail = this.opts.failUpload?.(input.name);
    if (fail) throw new Error(fail);
    return { id: nextId() };
  }

  private videoPolls = 0;
  async getVideoStatus(videoId: string) {
    this.calls.push({ op: 'getVideoStatus', payload: videoId });
    const seqList = this.opts.videoStatuses;
    const status = seqList ? seqList[Math.min(this.videoPolls++, seqList.length - 1)] : 'ready';
    return status === 'error' ? { status, detail: 'Fake processing error' } : { status };
  }

  async getVideoThumbnailUrl(videoId: string) {
    this.calls.push({ op: 'getVideoThumbnailUrl', payload: videoId });
    return `https://example.invalid/thumb/${videoId}.jpg`;
  }

  async createCreatives(adAccountId: string, items: MetaFields[]): Promise<BatchResult[]> {
    this.calls.push({ op: 'createCreatives', adAccountId, payload: items });
    return items.map(fields => {
      const fail = this.opts.failCreative?.(fields);
      if (fail) return { error: fail };
      const id = nextId();
      this.store.creatives.set(id, fields);
      return { id };
    });
  }

  async readCreativePostIds(creativeIds: string[]) {
    this.calls.push({ op: 'readCreativePostIds', payload: creativeIds });
    return creativeIds.map(id => {
      const f = this.store.creatives.get(id);
      if (!f) return null;
      if (typeof f.object_story_id === 'string') return f.object_story_id;
      const pageId = (f.object_story_spec as any)?.page_id ?? DEMO_PAGE.externalId;
      return `${pageId}_${id.slice(-12)}`;
    });
  }

  async createAds(adAccountId: string, items: MetaFields[]): Promise<BatchResult[]> {
    this.calls.push({ op: 'createAds', adAccountId, payload: items });
    return items.map(fields => {
      const fail = this.opts.failAd?.(fields);
      if (fail) return { error: fail };
      const id = nextId();
      this.store.ads.set(id, { fields, creativeId: String((fields.creative as any)?.creative_id ?? '') });
      return { id };
    });
  }

  async readAdPostIds(adIds: string[]) {
    this.calls.push({ op: 'readAdPostIds', payload: adIds });
    const postIds = await this.readCreativePostIds(adIds.map(id => this.store.ads.get(id)?.creativeId ?? ''));
    this.calls.pop();
    return postIds.map(postId => ({ postId }));
  }

  async getCampaign(campaignId: string) {
    return this.store.campaigns.get(campaignId) ?? null;
  }

  async getAdSet(adsetId: string) {
    return this.store.adsets.get(adsetId) ?? null;
  }

  async getAdAccount(adAccountId: string) {
    return { id: adAccountId, name: DEMO_AD_ACCOUNT.name, currency: DEMO_AD_ACCOUNT.currency, accountStatus: 1 };
  }

  async listPages() {
    return { pages: DEMO_PAGES, warnings: [] };
  }

  async listCustomAudiences() {
    return DEMO_AUDIENCES;
  }

  async searchInterests(query: string) {
    const q = query.trim().toLowerCase();
    return DEMO_INTERESTS.filter(i => i.name.toLowerCase().includes(q));
  }

  async listPixels() {
    return [DEMO_PIXEL];
  }

  async listCampaigns(adAccountId: string): Promise<ExistingCampaign[]> {
    return [...this.store.campaigns.values()]
      .filter(c => c.accountId === adAccountId)
      .reverse()
      .slice(0, 100)
      .map(c => ({
        externalId: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        dailyBudget: c.dailyBudget,
        lifetimeBudget: c.lifetimeBudget,
        bidStrategy: c.bidStrategy,
        adsets: [...this.store.adsets.values()]
          .filter(a => a.campaignId === c.id)
          .map(a => ({ externalId: a.id, name: a.name, status: a.status, dailyBudget: a.dailyBudget }))
      }));
  }
}
