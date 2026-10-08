/**
 * Port: everything the launcher asks of Meta. Two adapters:
 *   FbMetaAdsWriter   — the real Graph API (fb-meta-ads-writer.ts)
 *   FakeMetaAdsWriter — demo accounts and tests; no network (fake-meta-ads-writer.ts)
 *
 * Ad account ids are passed as digits; adapters add `act_` themselves.
 */
import type { BidStrategy, ExistingCampaign, InterestOption, LauncherAudience, LauncherPage } from './contract';
import type { MetaFields } from './meta-params';

/** One element of a Graph batch: exactly one of id / error is set. */
export interface BatchResult {
  id?: string;
  error?: string;
}

export interface RemoteCampaign {
  id: string;
  accountId: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  bidStrategy: BidStrategy | null;
}

export interface RemoteAdSet {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  dailyBudget: string | null;
}

export interface MetaAdsWriter {
  readonly kind: 'meta' | 'fake';

  createCampaign(adAccountId: string, fields: MetaFields): Promise<{ id: string }>;
  createAdSet(adAccountId: string, fields: MetaFields): Promise<{ id: string }>;

  uploadImage(adAccountId: string, input: { bytes: Buffer; name: string }): Promise<{ hash: string }>;
  /** fileUrl when the file is publicly reachable over HTTPS, else raw bytes. */
  uploadVideo(adAccountId: string, input: { name: string; fileUrl?: string; bytes?: Buffer }): Promise<{ id: string }>;
  getVideoStatus(videoId: string): Promise<{ status: 'ready' | 'processing' | 'error'; detail?: string }>;
  /** Meta's own preferred thumbnail, used when a video has no poster of ours. */
  getVideoThumbnailUrl(videoId: string): Promise<string | null>;

  /** Batched (50 per HTTP request). Results line up with `items`. */
  createCreatives(adAccountId: string, items: MetaFields[]): Promise<BatchResult[]>;
  /** effective_object_story_id per creative id; null when unknown. Best effort. */
  readCreativePostIds(creativeIds: string[]): Promise<Array<string | null>>;
  createAds(adAccountId: string, items: MetaFields[]): Promise<BatchResult[]>;
  /** creative{effective_object_story_id} per ad id. */
  readAdPostIds(adIds: string[]): Promise<Array<{ postId: string | null; error?: string }>>;

  getCampaign(campaignId: string): Promise<RemoteCampaign | null>;
  getAdSet(adsetId: string): Promise<RemoteAdSet | null>;

  // Options for the wizard (§7.1)
  getAdAccount(adAccountId: string): Promise<{ id: string; name: string; currency: string | null; accountStatus: number | null }>;
  /**
   * Every page this connection can advertise with: pages linked to the ad
   * account first, then the user's own pages and the ad account business's
   * owned + client pages. `warnings` = sources that failed (non-fatal).
   */
  listPages(adAccountId: string): Promise<{ pages: LauncherPage[]; warnings: string[] }>;
  listPixels(adAccountId: string): Promise<Array<{ externalId: string; name: string }>>;
  listCampaigns(adAccountId: string): Promise<ExistingCampaign[]>;
  listCustomAudiences(adAccountId: string): Promise<LauncherAudience[]>;
  searchInterests(query: string): Promise<InterestOption[]>;
}

/** A Graph error we can show to the user as-is. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/** Breaker open for this token/app: fail fast, never call Meta (§8.1). */
export class MetaUnavailableError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = 'MetaUnavailableError';
  }
}

export const KNOWN_BID_STRATEGIES: readonly BidStrategy[] = [
  'LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP', 'LOWEST_COST_WITH_MIN_ROAS'
];

export function knownBidStrategy(v: unknown): BidStrategy | null {
  return typeof v === 'string' && (KNOWN_BID_STRATEGIES as readonly string[]).includes(v) ? (v as BidStrategy) : null;
}
