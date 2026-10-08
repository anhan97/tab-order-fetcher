/**
 * Pure builders for the fields the launcher POSTs to the Marketing API (§8.3).
 * No I/O — every function here is unit-tested in isolation.
 *
 * Money always travels as decimal strings and is converted with BigInt:
 * "12.50" → "1250" cents. Never a float.
 */
import {
  type BidStrategy,
  type CallToAction,
  type LaunchAdsetSpec,
  type LaunchTargeting,
  type NodeStatus,
  type Objective,
  needsBidAmount,
  needsPixel,
  needsRoasGoal
} from './contract';

export type MetaFields = Record<string, unknown>;

/** "12.50" → "1250", "50" → "5000". Throws on anything that isn't money. */
export function majorToMinor(amount: string): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid money amount: ${amount}`);
  const cents = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return cents.toString();
}

/** ROAS 1.8 → 18000 (Meta's roas_average_floor is ROAS × 10000). */
export function roasToFloor(roas: string): string {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(roas.trim());
  if (!m) throw new Error(`Invalid ROAS goal: ${roas}`);
  return (BigInt(m[1]) * 10000n + BigInt((m[2] ?? '').padEnd(4, '0') || '0')).toString();
}

/** Minor units → major decimal string ("1250" → "12.50"). For display only. */
export function minorToMajor(minor: string | number | bigint): string {
  const v = BigInt(minor);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export const actId = (adAccountId: string) => (adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`);

// ─── Campaign ───────────────────────────────────────────────────────────────

export function campaignFields(c: {
  name: string;
  objective: Objective;
  status: NodeStatus;
  dailyBudget?: string;
  bidStrategy?: BidStrategy;
}): MetaFields {
  const fields: MetaFields = {
    name: c.name,
    objective: c.objective,
    status: c.status,
    special_ad_categories: [],
    buying_type: 'AUCTION'
  };
  if (c.dailyBudget) {
    fields.daily_budget = majorToMinor(c.dailyBudget);
    fields.bid_strategy = c.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
  } else {
    // ABO. From v24 Meta refuses a campaign without a campaign budget unless
    // this flag is explicit (and calls to retired versions are served by the
    // oldest live one, so it applies to our v23 calls too).
    fields.is_adset_budget_sharing_enabled = false;
  }
  return fields;
}

// ─── Ad set ─────────────────────────────────────────────────────────────────

export function targetingFields(t: LaunchTargeting): MetaFields {
  const out: MetaFields = {
    geo_locations: { countries: t.countries },
    age_min: t.ageMin,
    age_max: t.ageMax,
    // Meta refuses a new Sales ad set without an explicit value (v23+).
    targeting_automation: { advantage_audience: 1 }
  };
  if (t.genders.length === 1) out.genders = t.genders;
  if (!t.advantagePlacements) {
    out.publisher_platforms = ['facebook', 'instagram'];
    out.facebook_positions = ['feed', 'story', 'facebook_reels'];
    out.instagram_positions = ['stream', 'story', 'reels'];
  }
  return out;
}

/**
 * Who holds the bid strategy decides what a NEW ad set carries (§8.4):
 *   ABO            → the ad set: budget + strategy + amount/ROAS
 *   CBO, known     → only the amount/ROAS the campaign's strategy needs
 *   CBO, unknown   → whatever amount/ROAS the request carries (web decided)
 */
export type BidHolder =
  | { mode: 'ABO' }
  | { mode: 'CBO'; strategy: BidStrategy | null };

type NewAdset = Extract<LaunchAdsetSpec, { mode: 'new' }>;

/** Why this ad set can't be created under this holder, or null. */
export function adsetBidProblem(a: NewAdset, holder: BidHolder): string | null {
  if (holder.mode === 'ABO' && !a.dailyBudget) return 'ABO ad sets need a daily budget';
  const strategy = holder.mode === 'ABO' ? a.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP' : holder.strategy;
  if (needsBidAmount(strategy) && !a.bidAmount) return 'This bid strategy needs a bid amount on every ad set';
  if (needsRoasGoal(strategy)) {
    if (!a.roasGoal) return 'ROAS goal bidding needs a ROAS goal on every ad set';
    if (a.optimizationGoal !== 'VALUE') return 'ROAS goal bidding needs the VALUE optimisation goal';
  }
  return null;
}

export function adsetBidFields(a: NewAdset, holder: BidHolder): MetaFields {
  const problem = adsetBidProblem(a, holder);
  if (problem) throw new Error(problem);
  const out: MetaFields = {};
  let strategy: BidStrategy | null;
  if (holder.mode === 'ABO') {
    strategy = a.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
    out.daily_budget = majorToMinor(a.dailyBudget!);
    out.bid_strategy = strategy;
  } else {
    strategy = holder.strategy;
  }
  if (strategy) {
    if (needsBidAmount(strategy)) out.bid_amount = majorToMinor(a.bidAmount!);
    if (needsRoasGoal(strategy)) out.bid_constraints = { roas_average_floor: Number(roasToFloor(a.roasGoal!)) };
  } else if (a.bidAmount) {
    out.bid_amount = majorToMinor(a.bidAmount);
  } else if (a.roasGoal) {
    out.bid_constraints = { roas_average_floor: Number(roasToFloor(a.roasGoal)) };
  }
  return out;
}

export function adsetFields(a: NewAdset, ctx: { campaignId: string; holder: BidHolder; pixelId?: string }): MetaFields {
  const fields: MetaFields = {
    name: a.name,
    campaign_id: ctx.campaignId,
    status: a.status,
    billing_event: 'IMPRESSIONS',
    optimization_goal: a.optimizationGoal,
    targeting: targetingFields(a.targeting),
    ...adsetBidFields(a, ctx.holder)
  };
  if (needsPixel(a.optimizationGoal)) {
    if (!ctx.pixelId) throw new Error('This optimisation goal needs a pixel');
    fields.promoted_object = {
      pixel_id: ctx.pixelId,
      custom_event_type: a.optimizationGoal === 'VALUE' ? 'PURCHASE' : a.conversionEvent
    };
  }
  if (a.startTime) fields.start_time = a.startTime;
  return fields;
}

// ─── Creative / ad ──────────────────────────────────────────────────────────

export interface AdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

const nonEmpty = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export function imageCreativeFields(c: {
  name: string;
  pageId: string;
  imageHash: string;
  link: string;
  displayLink?: string;
  copy: AdCopy;
  callToAction: CallToAction;
  urlTags: string;
}): MetaFields {
  return nonEmpty({
    name: c.name,
    url_tags: c.urlTags,
    object_story_spec: {
      page_id: c.pageId,
      link_data: nonEmpty({
        link: c.link,
        image_hash: c.imageHash,
        message: c.copy.primaryText,
        name: c.copy.headline,
        description: c.copy.description,
        caption: c.displayLink,
        call_to_action: { type: c.callToAction, value: { link: c.link } }
      })
    }
  });
}

export function videoCreativeFields(c: {
  name: string;
  pageId: string;
  videoId: string;
  thumbnail: { imageHash: string } | { imageUrl: string };
  link: string;
  copy: AdCopy;
  callToAction: CallToAction;
  urlTags: string;
}): MetaFields {
  return nonEmpty({
    name: c.name,
    url_tags: c.urlTags,
    object_story_spec: {
      page_id: c.pageId,
      video_data: nonEmpty({
        video_id: c.videoId,
        ...('imageHash' in c.thumbnail ? { image_hash: c.thumbnail.imageHash } : { image_url: c.thumbnail.imageUrl }),
        title: c.copy.headline,
        message: c.copy.primaryText,
        link_description: c.copy.description,
        call_to_action: { type: c.callToAction, value: { link: c.link } }
      })
    }
  });
}

export function postCreativeFields(c: { name: string; postId: string; urlTags: string }): MetaFields {
  return nonEmpty({ name: c.name, object_story_id: c.postId, url_tags: c.urlTags });
}

export function adFields(a: { name: string; adsetId: string; creativeId: string; status: NodeStatus }): MetaFields {
  return { name: a.name, adset_id: a.adsetId, creative: { creative_id: a.creativeId }, status: a.status };
}

/** form-urlencoded body: objects/arrays as JSON strings (Graph API convention). */
export function encodeForm(fields: MetaFields): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return body;
}
