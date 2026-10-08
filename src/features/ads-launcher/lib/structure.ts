/**
 * Structure planner (§5): `C:S:A` → campaigns × ad sets × ads, their names,
 * the blocking issues, and the launch requests (one per campaign, §7.3).
 *
 * Pure — no React. The wizard computes ONE plan from `planStructure`; the
 * diagram, the review table and the requests all read that same plan, so
 * what the user sees is exactly what gets sent.
 */
import {
  LIMITS,
  bidStrategyLabel,
  formatIssues,
  needsBidAmount,
  needsPixel,
  needsRoasGoal,
  presetConfigSchema,
  type Audience,
  type BidStrategy,
  type Count,
  type ExistingCampaign,
  type LaunchAdSpec,
  type LaunchAdsetSpec,
  type LaunchCampaignSpec,
  type LaunchPresetConfig,
  type LaunchRequest,
  type LaunchTargeting,
  type LauncherAudience,
  type NamedRef,
  type OptimizationGoal
} from '@contract/ads-launcher';
import type { PoolItem } from './pool';

// ─── §5.3 algorithm (verbatim) ──────────────────────────────────────────────

interface StructureShape {
  campaigns: Count;
  adsetsPerCampaign: Count;
  adsPerAdset: Count;
  repeatToFill?: boolean;
}

const range = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i);
const chunk = <T>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += Math.max(1, size)) out.push(xs.slice(i, i + Math.max(1, size)));
  return out;
};
const unique = <T>(xs: T[]) => [...new Set(xs)];
const num = (c: Count) => (c === 'n' ? 1 : c);

/** Repeat xs in order until there are k elements; already enough → unchanged. */
export const fillTo = <T>(xs: T[], k: number): T[] =>
  xs.length === 0 || xs.length >= k ? [...xs] : range(k).map((i) => xs[i % xs.length]!);

/** grid[campaign][adset] = item ids (one id = one ad). */
export const resolveStructure = (s: StructureShape, itemIds: string[]) => {
  const ids = unique(itemIds);
  if (ids.length === 0) return { grid: [] as string[][][], leftOut: [] as string[] };
  const { campaigns: C, adsetsPerCampaign: S, adsPerAdset: A } = s;
  const repeat = s.repeatToFill !== false;

  if (A === 'n') return { grid: range(num(C)).map(() => range(num(S)).map(() => [...ids])), leftOut: [] };
  if (S === 'n') {
    const groups = chunk(ids, A).map((g) => (repeat ? fillTo(g, A) : g));
    return { grid: range(num(C)).map(() => groups.map((g) => [...g])), leftOut: [] };
  }
  if (C === 'n') {
    return {
      grid: chunk(ids, S * A).map((share) => chunk(repeat ? fillTo(share, S * A) : share, A)),
      leftOut: [],
    };
  }
  const slots = C * S * A;
  const used = ids.slice(0, slots);
  const grid = range(C).map((c) =>
    range(S).map((si) => {
      const dealt = range(A).map((a) => used[(c * S * A + si * A + a) % used.length]!);
      return repeat ? dealt : unique(dealt);
    }),
  );
  return { grid, leftOut: ids.slice(slots) };
};

// ─── Labels ─────────────────────────────────────────────────────────────────

type StructureLike = Partial<Pick<StructureShape, 'campaigns' | 'adsetsPerCampaign' | 'adsPerAdset'>>;

/** `1:n:1` for cards and badges. */
export const structureLabel = (s: StructureLike) => `${s.campaigns}:${s.adsetsPerCampaign}:${s.adsPerAdset}`;

/** `{structure}` token: `1-n-1`. */
export const structureToken = (s: StructureLike) => `${s.campaigns}-${s.adsetsPerCampaign}-${s.adsPerAdset}`;

export const genderLabel = (g: Audience['gender']) => (g === 'men' ? 'Men' : g === 'women' ? 'Women' : 'All genders');

/** `{date}` token: DD/MM in the given (default: browser) time zone. */
export function dateToken(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}`;
}

/** `{angle}` token: the first item's angle, plus `+k` when k other distinct items follow. */
export function angleToken(items: PoolItem[]): string {
  const distinct = unique(items.map((i) => i.key));
  const first = items[0]?.angle?.trim() ?? '';
  if (!first) return '';
  const more = distinct.length - 1;
  return more > 0 ? `${first} +${more}` : first;
}

// ─── Naming (§5.4) ──────────────────────────────────────────────────────────

/**
 * A separator is `|` or `·` anywhere, or a `-` standing on its own (so
 * `18-65` and `Dead-corner` stay intact). The capture keeps its spaces.
 */
const SEPARATOR = /(\s*(?:\||·|(?<![^\s|·])-(?![^\s|·]))\s*)/;

/**
 * Drop separators left dangling by empty tokens (adjacent, leading or
 * trailing), collapse whitespace, cut to `max` characters.
 */
export function cleanName(raw: string, max: number = LIMITS.nameLength): string {
  const parts = raw.split(SEPARATOR);
  let out = '';
  let pendingSep: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      // separator: keep the first one between two words
      if (pendingSep === null) pendingSep = part;
      continue;
    }
    if (part.trim() === '') continue;
    if (out && pendingSep !== null) out += pendingSep;
    else if (out) out += ' ';
    out += part;
    pendingSep = null;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Fill `{token}`s; unknown tokens stay as typed. */
export function fillTemplate(template: string, tokens: Record<string, string>): string {
  const filled = template.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(tokens, k) ? tokens[k] : m,
  );
  return cleanName(filled);
}

/**
 * Number names that repeat, in order; a name that appears once is left
 * alone: [A, A, B, A] → [A #1, A #2, B, A #3] (same rule as the server).
 */
export function numberDuplicateNames(names: string[], maxLength: number = LIMITS.nameLength): string[] {
  const totals = new Map<string, number>();
  for (const n of names) totals.set(n, (totals.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => {
    if ((totals.get(n) ?? 0) < 2) return n.slice(0, maxLength);
    const i = (seen.get(n) ?? 0) + 1;
    seen.set(n, i);
    const suffix = ` #${i}`;
    return n.slice(0, maxLength - suffix.length) + suffix;
  });
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export interface PlanInput {
  config: LaunchPresetConfig;
  /** Pool in selection order. */
  items: PoolItem[];
  /** Ad sets edited by hand: `"<campaignIndex>:<adsetIndex>"` → item keys. */
  overrides?: Record<string, string[]>;
  product?: { title?: string | null; code?: string | null } | null;
  presetName?: string | null;
  now?: Date;
  timeZone?: string;
}

export interface PlannedAd {
  item: PoolItem;
  /** Display name (duplicates numbered like the server does). */
  name: string;
}

export interface PlannedAdset {
  key: string;
  campaignIndex: number;
  index: number;
  name: string;
  audience: Audience | null;
  itemKeys: string[];
  ads: PlannedAd[];
  overridden: boolean;
}

export interface PlannedCampaign {
  index: number;
  name: string;
  adsets: PlannedAdset[];
  adCount: number;
}

export interface StructurePlan {
  campaigns: PlannedCampaign[];
  leftOut: PoolItem[];
  counts: { items: number; campaigns: number; adsets: number; ads: number; slots: number | null };
  issues: string[];
}

export const adsetKey = (campaignIndex: number, adsetIndex: number) => `${campaignIndex}:${adsetIndex}`;

/** Guard against half-typed form values: anything but `n` or a whole number ≥ 1 becomes 1. */
const safeCount = (c: Count | unknown): Count =>
  c === 'n' ? 'n' : typeof c === 'number' && Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function planStructure(input: PlanInput): StructurePlan {
  const { config } = input;
  const byKey = new Map<string, PoolItem>();
  for (const item of input.items) if (!byKey.has(item.key)) byKey.set(item.key, item);
  const keys = [...byKey.keys()];

  const s: StructureShape = {
    campaigns: safeCount(config.structure?.campaigns),
    adsetsPerCampaign: safeCount(config.structure?.adsetsPerCampaign),
    adsPerAdset: safeCount(config.structure?.adsPerAdset),
    repeatToFill: config.structure?.repeatToFill !== false,
  };
  const repeat = s.repeatToFill !== false;
  const { grid, leftOut } = resolveStructure(s, keys);

  // Hand-edited ad sets are filled like automatic ones (§5.3 note).
  const cells = grid.map((adsets, c) =>
    adsets.map((ids, si) => {
      const chosen = unique(input.overrides?.[adsetKey(c, si)] ?? []).filter((k) => byKey.has(k));
      if (chosen.length === 0) return { ids, overridden: false };
      const A = s.adsPerAdset;
      return { ids: typeof A === 'number' && repeat ? fillTo(chosen, A) : chosen, overridden: true };
    }),
  );

  const itemsOf = (ids: string[]) => ids.map((k) => byKey.get(k)!).filter(Boolean);
  const audiences = config.adset?.audiences ?? [];
  const baseTokens = {
    product: input.product?.title ?? '',
    code: input.product?.code ?? '',
    preset: input.presetName ?? '',
    structure: structureToken(s),
    date: dateToken(input.now ?? new Date(), input.timeZone),
  };

  const campaignTemplate = config.campaign?.nameTemplate ?? '';
  const rawCampaignNames = cells.map((adsets, c) =>
    fillTemplate(campaignTemplate, {
      ...baseTokens,
      n: String(c + 1),
      angle: angleToken(itemsOf(unique(adsets.flatMap((a) => a.ids)))),
    }),
  );
  const campaignNames = campaignTemplate.includes('{n}') ? rawCampaignNames : numberDuplicateNames(rawCampaignNames);

  const adsetTemplate = config.adset?.nameTemplate ?? '';
  const campaigns: PlannedCampaign[] = cells.map((adsets, c) => {
    const campaignName = campaignNames[c];
    const audienceOf = (si: number) => (audiences.length ? audiences[si % audiences.length] : null);
    const rawAdsetNames = adsets.map((a, si) => {
      const audience = audienceOf(si);
      return fillTemplate(adsetTemplate, {
        campaign: campaignName,
        n: String(si + 1),
        audience: audience?.label ?? '',
        country: audience?.countries.join(',') ?? '',
        age: audience ? `${audience.ageMin}-${audience.ageMax}` : '',
        gender: audience ? genderLabel(audience.gender) : '',
        angle: angleToken(itemsOf(unique(a.ids))),
      });
    });
    const adsetNames = adsetTemplate.includes('{n}') ? rawAdsetNames : numberDuplicateNames(rawAdsetNames);
    const planned: PlannedAdset[] = adsets.map((a, si) => {
      const items = itemsOf(a.ids);
      const names = numberDuplicateNames(items.map((i) => i.name));
      return {
        key: adsetKey(c, si),
        campaignIndex: c,
        index: si,
        name: adsetNames[si],
        audience: audienceOf(si),
        itemKeys: items.map((i) => i.key),
        ads: items.map((item, i) => ({ item, name: names[i] })),
        overridden: a.overridden,
      };
    });
    return { index: c, name: campaignName, adsets: planned, adCount: planned.reduce((n, a) => n + a.ads.length, 0) };
  });

  const adsetCount = campaigns.reduce((n, c) => n + c.adsets.length, 0);
  const adCount = campaigns.reduce((n, c) => n + c.adCount, 0);
  const fixed = [s.campaigns, s.adsetsPerCampaign, s.adsPerAdset].every((x) => x !== 'n');
  const slots = fixed ? (s.campaigns as number) * (s.adsetsPerCampaign as number) * (s.adsPerAdset as number) : null;

  const issues: string[] = [];
  if (keys.length === 0) issues.push('Pick at least one creative or post');
  if (leftOut.length > 0) {
    issues.push(
      `${plural(slots ?? 0, 'slot')} for ${plural(keys.length, 'item')}: use "n" at one level or remove ${leftOut.length}`,
    );
  }
  if (campaigns.length > LIMITS.campaignsPerLaunch) {
    issues.push(`${campaigns.length} campaigns: at most ${LIMITS.campaignsPerLaunch} per launch`);
  }
  const maxAdsets = Math.max(0, ...campaigns.map((c) => c.adsets.length));
  if (maxAdsets > LIMITS.adsetsPerCampaign) {
    issues.push(`${maxAdsets} ad sets in one campaign: at most ${LIMITS.adsetsPerCampaign} per campaign`);
  }
  const maxAds = Math.max(0, ...campaigns.flatMap((c) => c.adsets.map((a) => a.ads.length)));
  if (maxAds > LIMITS.adsPerAdset) {
    issues.push(`${maxAds} ads in one ad set: at most ${LIMITS.adsPerAdset} per ad set`);
  }
  const maxCampaignAds = Math.max(0, ...campaigns.map((c) => c.adCount));
  if (maxCampaignAds > LIMITS.adsPerCampaign) {
    issues.push(`${maxCampaignAds} ads in one campaign: at most ${LIMITS.adsPerCampaign} per campaign`);
  }
  issues.push(...configIssues(config));

  return {
    campaigns,
    leftOut: itemsOf(leftOut),
    counts: { items: keys.length, campaigns: campaigns.length, adsets: adsetCount, ads: adCount, slots },
    issues: unique(issues),
  };
}

// ─── Issues (§5.5) ──────────────────────────────────────────────────────────

/** Preset errors in plain words: `Campaign · bidAmount: Set the amount for this bid strategy`. */
export function configIssues(config: unknown): string[] {
  const parsed = presetConfigSchema.safeParse(config);
  return parsed.success ? [] : formatIssues(parsed.error);
}

/** The per-launch choices that never live in a preset (§2 "Setup"). */
export interface LaunchSetup {
  adAccountId: string;
  pixelId: string;
  pageId: string;
  storeId: string;
  landingUrl: string;
  displayLink: string;
  urlTags: string;
}

export const EMPTY_SETUP: LaunchSetup = {
  adAccountId: '',
  pixelId: '',
  pageId: '',
  storeId: '',
  landingUrl: '',
  displayLink: '',
  urlTags: '',
};

export type LaunchTarget =
  | { mode: 'new' }
  | { mode: 'existing'; campaignId: string | null; adsetId?: string | null };

const NUMERIC_ID = /^\d{1,30}$/;

export const isHttpUrl = (value: string) => {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
};

const GOAL_LABELS: Record<OptimizationGoal, string> = {
  OFFSITE_CONVERSIONS: 'Conversions',
  VALUE: 'Value',
  LINK_CLICKS: 'Link clicks',
  LANDING_PAGE_VIEWS: 'Landing page views',
  IMPRESSIONS: 'Impressions',
  REACH: 'Reach',
};
export const optimizationGoalLabel = (g: OptimizationGoal) => GOAL_LABELS[g] ?? g;

const createsNewAdsets = (target?: LaunchTarget) => !(target?.mode === 'existing' && target.adsetId);

export function setupIssues(
  setup: LaunchSetup,
  ctx: { config: LaunchPresetConfig | null; items: PoolItem[]; target?: LaunchTarget },
): string[] {
  const issues: string[] = [];
  const account = setup.adAccountId.trim();
  if (!account) issues.push('Pick an ad account');
  else if (!NUMERIC_ID.test(account)) issues.push('Ad account ID must be numeric');

  const page = setup.pageId.trim();
  if (!page) issues.push('Pick a Facebook page');
  else if (!NUMERIC_ID.test(page)) issues.push('Page ID must be numeric');

  const pixel = setup.pixelId.trim();
  if (pixel && !NUMERIC_ID.test(pixel)) issues.push('Pixel ID must be numeric');
  const goal = ctx.config?.adset?.optimizationGoal;
  if (!pixel && goal && needsPixel(goal) && createsNewAdsets(ctx.target)) {
    issues.push(`Pick a pixel: the "${optimizationGoalLabel(goal)}" optimisation goal needs one`);
  }

  if (ctx.items.some((i) => i.kind === 'creative')) {
    if (!setup.landingUrl.trim()) issues.push('Pick a landing page');
    else if (!isHttpUrl(setup.landingUrl)) issues.push('The landing page URL is not a valid http(s) link');
  }
  if (setup.displayLink.trim().length > 255) issues.push('Display link is too long (max 255 characters)');
  if (setup.urlTags.length > LIMITS.urlTagsLength) {
    issues.push(`URL parameters are too long (${setup.urlTags.length}/${LIMITS.urlTagsLength} characters)`);
  }
  return issues;
}

export type BidHolder = { mode: 'CBO'; strategy: BidStrategy | null } | { mode: 'ABO' };

/** An existing campaign is CBO when it has a daily or lifetime budget; its strategy comes from the sync. */
export function existingHolder(c: ExistingCampaign): BidHolder {
  return c.dailyBudget || c.lifetimeBudget ? { mode: 'CBO', strategy: c.bidStrategy ?? null } : { mode: 'ABO' };
}

/** Who holds the budget and the bid strategy for this launch (§8.4). */
export function bidHolder(
  config: LaunchPresetConfig,
  target?: LaunchTarget,
  existingCampaign?: ExistingCampaign | null,
): BidHolder {
  if (target?.mode === 'existing') return existingCampaign ? existingHolder(existingCampaign) : { mode: 'CBO', strategy: null };
  return config.campaign.budgetMode === 'CBO'
    ? { mode: 'CBO', strategy: config.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP' }
    : { mode: 'ABO' };
}

export function targetIssues(
  target: LaunchTarget,
  ctx: { plan: StructurePlan; config: LaunchPresetConfig | null; campaigns: ExistingCampaign[] },
): string[] {
  if (target.mode !== 'existing') return [];
  const issues: string[] = [];
  if (!target.campaignId) return ['Pick the existing campaign'];
  const campaign = ctx.campaigns.find((c) => c.externalId === target.campaignId);
  if (!campaign) return ['The selected campaign is not in this ad account any more'];

  if (ctx.plan.counts.campaigns > 1) {
    issues.push(`An existing campaign takes one campaign: this structure makes ${ctx.plan.counts.campaigns}`);
  }
  if (target.adsetId) {
    if (!campaign.adsets.some((a) => a.externalId === target.adsetId)) {
      issues.push('The selected ad set is not in this campaign any more');
    }
    if (ctx.plan.counts.adsets > 1) {
      issues.push(`An existing ad set takes one ad set: this structure makes ${ctx.plan.counts.adsets}`);
    }
    return issues;
  }

  // New ad sets under a CBO campaign must bid the way the campaign does (§8.4).
  const holder = existingHolder(campaign);
  if (ctx.config && holder.mode === 'CBO' && holder.strategy) {
    const s = holder.strategy;
    const preset = ctx.config.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
    if ((needsBidAmount(s) || needsRoasGoal(s)) && preset !== s) {
      issues.push(
        `${campaign.name} bids with ${bidStrategyLabel(s)}: set the same bid strategy and its ${needsRoasGoal(s) ? 'ROAS goal' : 'amount'}`,
      );
    }
  }
  return issues;
}

/**
 * Custom / lookalike audiences belong to one ad account: a preset made in
 * another account would make Meta reject the ad set. `accountAudiences` null
 * = options not loaded (nothing to compare against yet).
 */
export function audienceRefIssues(
  config: LaunchPresetConfig | null,
  accountAudiences: LauncherAudience[] | null,
  target?: LaunchTarget,
): string[] {
  if (!config || !accountAudiences || !createsNewAdsets(target)) return [];
  const known = new Set(accountAudiences.map((a) => a.externalId));
  const issues: string[] = [];
  for (const a of config.adset?.audiences ?? []) {
    for (const [refs, kind] of [
      [a.customAudiences, 'custom audience'],
      [a.excludedAudiences, 'excluded audience'],
    ] as const) {
      for (const ref of refs ?? []) {
        if (!known.has(ref.id)) issues.push(`Audience '${a.label}': ${kind} '${ref.name || ref.id}' is not in this ad account`);
      }
    }
  }
  return unique(issues);
}

// ─── Requests (§7.3) ────────────────────────────────────────────────────────

/** A request before the run loop stamps `requestId` / `launchId` on it (§12.3). */
export type LaunchRequestDraft = Omit<LaunchRequest, 'requestId' | 'launchId'>;

export interface CopyOverride {
  primaryText?: string;
  headline?: string;
  description?: string;
}

export interface BuildInput {
  plan: StructurePlan;
  config: LaunchPresetConfig;
  setup: LaunchSetup;
  target?: LaunchTarget;
  existingCampaign?: ExistingCampaign | null;
  /** Copy edits keyed by creative id; blank = the creative's own copy. */
  copy?: Record<string, CopyOverride>;
  /** ISO 8601 with offset; empty = start now. */
  startTime?: string | null;
  /** The selected page's Instagram account; omitted = ads on Instagram use the Page. */
  instagramUserId?: string | null;
}

const COPY_FIELDS = ['primaryText', 'headline', 'description'] as const;

export function adSpecFor(item: PoolItem, copy?: CopyOverride): LaunchAdSpec {
  if (item.kind === 'post') {
    // Posts keep their own copy and link; the creative id only links analytics.
    return item.creativeId ? { postId: item.postId!, creativeId: item.creativeId } : { postId: item.postId! };
  }
  const spec: LaunchAdSpec = { creativeId: item.creativeId! };
  for (const f of COPY_FIELDS) {
    const v = copy?.[f];
    if (typeof v === 'string' && v.trim() !== '') spec[f] = v;
  }
  return spec;
}

const refIds = (refs: NamedRef[] | undefined) => [...new Set((refs ?? []).map((r) => r.id).filter(Boolean))];

export function targetingFor(audience: Audience | null, advantagePlacements: boolean): LaunchTargeting {
  const a: Audience = audience ?? { label: '', countries: [], ageMin: 18, ageMax: 65, gender: 'all' };
  const include = refIds(a.customAudiences);
  const exclude = refIds(a.excludedAudiences);
  const interests = refIds(a.interests);
  return {
    countries: [...a.countries],
    ageMin: a.ageMin,
    ageMax: a.ageMax,
    genders: a.gender === 'men' ? [1] : a.gender === 'women' ? [2] : [],
    advantagePlacements,
    // Empty lists are left out: the request only carries what was picked.
    ...(include.length ? { customAudienceIds: include } : {}),
    ...(exclude.length ? { excludedAudienceIds: exclude } : {}),
    ...(interests.length ? { interestIds: interests } : {}),
  };
}

export function buildStructureRequests(input: BuildInput): LaunchRequestDraft[] {
  const { plan, config, setup, target, existingCampaign } = input;
  const strategy: BidStrategy = config.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
  const holder = bidHolder(config, target, existingCampaign);
  const existing = target?.mode === 'existing' ? target : null;
  const pixelId = setup.pixelId.trim();
  const displayLink = setup.displayLink.trim();
  const startTime = input.startTime?.trim() || null;
  const instagramUserId = input.instagramUserId?.trim() && NUMERIC_ID.test(input.instagramUserId.trim()) ? input.instagramUserId.trim() : null;

  const amounts = (s: BidStrategy | null) => ({
    ...(needsBidAmount(s) && config.campaign.bidAmount ? { bidAmount: config.campaign.bidAmount } : {}),
    ...(needsRoasGoal(s) && config.campaign.roasGoal ? { roasGoal: config.campaign.roasGoal } : {}),
  });
  // CBO: the campaign holds the strategy, ad sets only carry the amount it needs.
  // Unknown strategy on an existing CBO campaign: send what the preset says (§8.4).
  const adsetBid =
    holder.mode === 'ABO'
      ? { dailyBudget: config.campaign.dailyBudget, bidStrategy: strategy, ...amounts(strategy) }
      : amounts(holder.strategy ?? strategy);

  const campaigns = existing ? plan.campaigns.slice(0, 1) : plan.campaigns;
  return campaigns.map((pc) => {
    const adsOf = (ads: PlannedAd[]) => ads.map((a) => adSpecFor(a.item, a.item.creativeId ? input.copy?.[a.item.creativeId] : undefined));

    const campaign: LaunchCampaignSpec = existing
      ? { mode: 'existing', campaignId: existing.campaignId ?? '' }
      : {
          mode: 'new',
          name: pc.name,
          objective: config.campaign.objective,
          ...(config.campaign.budgetMode === 'CBO' ? { dailyBudget: config.campaign.dailyBudget, bidStrategy: strategy } : {}),
          status: config.status,
        };

    const adsets: LaunchAdsetSpec[] =
      existing?.adsetId
        ? [{ mode: 'existing', adsetId: existing.adsetId, ads: adsOf(pc.adsets[0]?.ads ?? []) }]
        : pc.adsets.map((pa) => ({
            mode: 'new' as const,
            name: pa.name,
            ...adsetBid,
            optimizationGoal: config.adset.optimizationGoal,
            conversionEvent: config.adset.conversionEvent,
            ...(pixelId ? { pixelId } : {}),
            targeting: targetingFor(pa.audience, config.adset.advantagePlacements),
            status: config.status,
            ...(startTime ? { startTime } : {}),
            ads: adsOf(pa.ads),
          }));

    const fromCreative = adsets.some((a) => (a.ads ?? []).some((ad) => !ad.postId));
    return {
      adAccountId: setup.adAccountId.trim(),
      pageId: setup.pageId.trim(),
      ...(instagramUserId ? { instagramUserId } : {}),
      ...(pixelId ? { pixelId } : {}),
      campaign,
      adsets,
      ads: [],
      ...(fromCreative
        ? { destination: { url: setup.landingUrl.trim(), ...(displayLink ? { displayLink } : {}) } }
        : {}),
      callToAction: config.ad.callToAction,
      urlTags: setup.urlTags,
      adStatus: config.status,
    };
  });
}
