/**
 * Ads Launcher — the contract shared by the API and the web app.
 *
 * Imported by the backend directly and by the frontend through the
 * `@contract/ads-launcher` alias (vite/vitest/tsconfig), so both ends parse
 * presets and launch requests with the SAME schemas: the web never lets the
 * user press Launch on a plan the API would then reject.
 *
 * Keep this file dependency-free apart from zod. No Node or DOM APIs.
 *
 * Spec: docs/2026-10-07-dac-ta-ads-launcher.md (§5–§7).
 */
import { z } from 'zod';

// ─── Limits (§13) ───────────────────────────────────────────────────────────

export const LIMITS = {
  campaignsPerLaunch: 50,
  adsetsPerCampaign: 50,
  adsPerAdset: 50,
  adsPerCampaign: 200,
  audiencesPerPreset: 10,
  countriesPerAudience: 50,
  ageMin: 13,
  ageMax: 65,
  metaBatchSize: 50,
  refreshAdsPerRun: 1000,
  postRecheckHours: 6,
  postIdsPerLookup: 100,
  urlTagsLength: 1024,
  nameLength: 255,
  headlineLength: 255,
  primaryTextLength: 5000,
  descriptionLength: 255
} as const;

// ─── Enums ──────────────────────────────────────────────────────────────────

export const OBJECTIVES = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS'] as const;
export const BUDGET_MODES = ['CBO', 'ABO'] as const;
export const BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP', 'LOWEST_COST_WITH_MIN_ROAS'] as const;
export const OPTIMIZATION_GOALS = ['OFFSITE_CONVERSIONS', 'VALUE', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'IMPRESSIONS', 'REACH'] as const;
export const CONVERSION_EVENTS = ['PURCHASE', 'ADD_TO_CART', 'INITIATE_CHECKOUT', 'LEAD', 'COMPLETE_REGISTRATION'] as const;
export const CALLS_TO_ACTION = ['SHOP_NOW', 'LEARN_MORE', 'ORDER_NOW', 'BUY_NOW', 'GET_OFFER', 'SIGN_UP', 'SUBSCRIBE', 'CONTACT_US'] as const;
export const NODE_STATUSES = ['PAUSED', 'ACTIVE'] as const;
export const GENDERS = ['all', 'men', 'women'] as const;

export type Objective = (typeof OBJECTIVES)[number];
export type BudgetMode = (typeof BUDGET_MODES)[number];
export type BidStrategy = (typeof BID_STRATEGIES)[number];
export type OptimizationGoal = (typeof OPTIMIZATION_GOALS)[number];
export type ConversionEvent = (typeof CONVERSION_EVENTS)[number];
export type CallToAction = (typeof CALLS_TO_ACTION)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type Gender = (typeof GENDERS)[number];

/** Strategies whose ad sets must carry a money amount (cost cap / bid cap). */
export const AMOUNT_BID_STRATEGIES: readonly BidStrategy[] = ['COST_CAP', 'LOWEST_COST_WITH_BID_CAP'];
/** Optimisation goals that need a pixel (promoted_object). */
export const PIXEL_GOALS: readonly OptimizationGoal[] = ['OFFSITE_CONVERSIONS', 'VALUE'];

export const needsBidAmount = (s: BidStrategy | null | undefined) => !!s && AMOUNT_BID_STRATEGIES.includes(s);
export const needsRoasGoal = (s: BidStrategy | null | undefined) => s === 'LOWEST_COST_WITH_MIN_ROAS';
export const needsPixel = (g: OptimizationGoal) => PIXEL_GOALS.includes(g);

/** Ads Manager wording (§6.1). */
export function bidStrategyLabel(s: BidStrategy | null | undefined, goal?: OptimizationGoal): string {
  switch (s ?? 'LOWEST_COST_WITHOUT_CAP') {
    case 'COST_CAP': return 'Cost per result goal';
    case 'LOWEST_COST_WITH_BID_CAP': return 'Bid cap';
    case 'LOWEST_COST_WITH_MIN_ROAS': return 'ROAS goal';
    default: return goal === 'VALUE' ? 'Highest value' : 'Highest volume';
  }
}

export const DEFAULT_URL_TAGS =
  'utm_source={{campaign.name}}&utm_medium={{adset.name}}&utm_campaign={{ad.name}}&utm_content={{ad.id}}';

// ─── Primitives ─────────────────────────────────────────────────────────────

/** Money in major units as a decimal string ("50", "12.50") — never a float. */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 50 or 12.50')
  .refine(v => Number(v) > 0, 'Must be greater than 0');

export const roasSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'Use a number like 1.5 (max 3 decimals)')
  .refine(v => Number(v) >= 0.01 && Number(v) <= 1000, 'ROAS goal must be between 0.01 and 1000');

/** Meta object ids are numeric strings. */
export const fbIdSchema = z.string().trim().regex(/^\d{1,30}$/, 'Must be a numeric id');
export const POST_ID_RE = /^\d{3,}_\d{3,}$/;
export const postIdSchema = z.string().trim().regex(POST_ID_RE, 'Post ID looks like 123456_7890123');

const countSchema = z.union([z.number().int().min(1).max(50), z.literal('n')]);
export type Count = z.infer<typeof countSchema>;

// ─── Preset (§6) ────────────────────────────────────────────────────────────

export const structureSchema = z
  .object({
    campaigns: countSchema,
    adsetsPerCampaign: countSchema,
    adsPerAdset: countSchema,
    repeatToFill: z.boolean().optional()
  })
  .refine(s => [s.campaigns, s.adsetsPerCampaign, s.adsPerAdset].filter(c => c === 'n').length <= 1, {
    message: '"n" can only be used at one level',
    path: ['campaigns']
  });
export type Structure = z.infer<typeof structureSchema>;

export const audienceSchema = z
  .object({
    label: z.string().trim().min(1, 'Name the audience').max(80),
    countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use 2-letter country codes')).min(1, 'Pick at least one country').max(LIMITS.countriesPerAudience),
    ageMin: z.number().int().min(LIMITS.ageMin).max(LIMITS.ageMax),
    ageMax: z.number().int().min(LIMITS.ageMin).max(LIMITS.ageMax),
    gender: z.enum(GENDERS)
  })
  .refine(a => a.ageMin <= a.ageMax, { message: 'Min age must be ≤ max age', path: ['ageMin'] });
export type Audience = z.infer<typeof audienceSchema>;

export const presetConfigSchema = z
  .object({
    structure: structureSchema,
    campaign: z.object({
      nameTemplate: z.string().trim().min(1).max(LIMITS.nameLength),
      objective: z.enum(OBJECTIVES),
      budgetMode: z.enum(BUDGET_MODES),
      dailyBudget: moneySchema,
      bidStrategy: z.enum(BID_STRATEGIES).optional(),
      bidAmount: moneySchema.optional(),
      roasGoal: roasSchema.optional()
    }),
    adset: z.object({
      nameTemplate: z.string().trim().min(1).max(LIMITS.nameLength),
      optimizationGoal: z.enum(OPTIMIZATION_GOALS),
      conversionEvent: z.enum(CONVERSION_EVENTS),
      advantagePlacements: z.boolean(),
      audiences: z.array(audienceSchema).min(1, 'Add at least one audience').max(LIMITS.audiencesPerPreset)
    }),
    ad: z.object({ callToAction: z.enum(CALLS_TO_ACTION) }),
    status: z.enum(NODE_STATUSES)
  })
  .superRefine((c, ctx) => {
    const s = c.campaign.bidStrategy;
    if (needsBidAmount(s) && !c.campaign.bidAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['campaign', 'bidAmount'], message: 'Set the amount for this bid strategy' });
    }
    if (needsRoasGoal(s)) {
      if (!c.campaign.roasGoal) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['campaign', 'roasGoal'], message: 'Set the ROAS goal' });
      }
      if (c.adset.optimizationGoal !== 'VALUE') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adset', 'optimizationGoal'], message: 'ROAS goal needs the "Value" optimisation goal' });
      }
    }
  });
export type LaunchPresetConfig = z.infer<typeof presetConfigSchema>;

export const presetInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the preset').max(80),
  description: z.string().max(2000).default(''),
  config: presetConfigSchema
});
export type LaunchPresetInput = z.infer<typeof presetInputSchema>;

export interface LaunchPreset {
  id: string;
  name: string;
  description: string;
  config: LaunchPresetConfig;
  starterKey: string | null;
  position: number;
  updatedAt: string;
}

const starterBase = (over: {
  structure: Structure;
  dailyBudget: string;
  nameTemplate: string;
  budgetMode?: BudgetMode;
}): LaunchPresetConfig => ({
  structure: { ...over.structure, repeatToFill: over.structure.repeatToFill ?? true },
  campaign: {
    nameTemplate: over.nameTemplate,
    objective: 'OUTCOME_SALES',
    budgetMode: over.budgetMode ?? 'CBO',
    dailyBudget: over.dailyBudget,
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP'
  },
  adset: {
    nameTemplate: '{campaign} | {audience}',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    conversionEvent: 'PURCHASE',
    advantagePlacements: true,
    audiences: [{ label: 'Broad', countries: ['US'], ageMin: 18, ageMax: 65, gender: 'all' }]
  },
  ad: { callToAction: 'SHOP_NOW' },
  status: 'PAUSED'
});

/** Starter presets copied to every user on first open (§6.2). */
export const STARTER_PRESETS: Array<{ key: string; name: string; description: string; config: LaunchPresetConfig }> = [
  {
    key: 'cbo-all-in-one',
    name: 'CBO all-in-one',
    description: 'Every creative in one ad set under one CBO campaign.',
    config: starterBase({ structure: { campaigns: 1, adsetsPerCampaign: 1, adsPerAdset: 'n' }, dailyBudget: '50', nameTemplate: '{code} | CBO | {date}' })
  },
  {
    key: 'cbo-per-creative',
    name: 'CBO per creative',
    description: 'One CBO campaign per creative.',
    config: starterBase({ structure: { campaigns: 'n', adsetsPerCampaign: 1, adsPerAdset: 1 }, dailyBudget: '30', nameTemplate: '{code} | {angle} | {date}' })
  },
  {
    key: 'abo-test-each',
    name: 'ABO test each creative',
    description: 'One campaign, one ABO ad set per creative.',
    config: starterBase({ structure: { campaigns: 1, adsetsPerCampaign: 'n', adsPerAdset: 1 }, dailyBudget: '20', nameTemplate: '{code} | ABO test | {date}', budgetMode: 'ABO' })
  },
  {
    key: 'abo-concept-3',
    name: 'ABO 3 per concept',
    description: 'One campaign, ABO ad sets of 3 creatives each.',
    config: starterBase({ structure: { campaigns: 1, adsetsPerCampaign: 'n', adsPerAdset: 3 }, dailyBudget: '30', nameTemplate: '{code} | ABO 3x | {date}', budgetMode: 'ABO' })
  }
];

/**
 * Parse a stored preset config. Old rows have no `repeatToFill` / `bidStrategy`:
 * they mean "repeat on" and "Highest volume" (§14).
 */
export function normalizePresetConfig(raw: unknown): LaunchPresetConfig | null {
  const parsed = presetConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  return {
    ...c,
    structure: { ...c.structure, repeatToFill: c.structure.repeatToFill !== false },
    campaign: { ...c.campaign, bidStrategy: c.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP' }
  };
}

/** zod issues → "Campaign · bidAmount: Set the amount for this bid strategy" (§5.5). */
export function formatIssues(error: z.ZodError): string[] {
  const section = (p: string | number | undefined) => {
    switch (p) {
      case 'campaign': return 'Campaign';
      case 'adset': return 'Ad set';
      case 'ad': return 'Ad';
      case 'structure': return 'Structure';
      case 'status': return 'Status';
      default: return p === undefined ? 'Preset' : String(p);
    }
  };
  return error.issues.map(i => {
    const [head, ...rest] = i.path;
    const field = rest.filter(p => typeof p === 'string').join('.');
    return `${section(head)}${field ? ` · ${field}` : ''}: ${i.message}`;
  });
}

// ─── Launch request (§7.3) ──────────────────────────────────────────────────

export const launchAdSpecSchema = z
  .object({
    creativeId: z.string().uuid().optional(),
    postId: postIdSchema.optional(),
    name: z.string().trim().min(1).max(LIMITS.nameLength).optional(),
    primaryText: z.string().max(LIMITS.primaryTextLength).optional(),
    headline: z.string().max(LIMITS.headlineLength).optional(),
    description: z.string().max(LIMITS.descriptionLength).optional(),
    link: z.string().url().optional()
  })
  .superRefine((a, ctx) => {
    if (!a.creativeId && !a.postId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each ad needs a creativeId or a postId' });
    }
    if (a.postId && (a.primaryText !== undefined || a.headline !== undefined || a.description !== undefined || a.link !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'An ad that runs an existing post cannot override its copy or link' });
    }
  });
export type LaunchAdSpec = z.infer<typeof launchAdSpecSchema>;

export const targetingSchema = z
  .object({
    countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).min(1).max(LIMITS.countriesPerAudience),
    ageMin: z.number().int().min(LIMITS.ageMin).max(LIMITS.ageMax),
    ageMax: z.number().int().min(LIMITS.ageMin).max(LIMITS.ageMax),
    /** [] = all, [1] = men, [2] = women (Meta codes). */
    genders: z.array(z.union([z.literal(1), z.literal(2)])).max(1),
    advantagePlacements: z.boolean()
  })
  .refine(t => t.ageMin <= t.ageMax, { message: 'ageMin must be ≤ ageMax', path: ['ageMin'] });
export type LaunchTargeting = z.infer<typeof targetingSchema>;

const adsOfAdset = z.array(launchAdSpecSchema).min(1).max(LIMITS.adsPerAdset).optional();

export const launchCampaignSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), campaignId: fbIdSchema }),
  z.object({
    mode: z.literal('new'),
    name: z.string().trim().min(1).max(LIMITS.nameLength),
    objective: z.enum(OBJECTIVES),
    /** Present = CBO. */
    dailyBudget: moneySchema.optional(),
    bidStrategy: z.enum(BID_STRATEGIES).optional(),
    status: z.enum(NODE_STATUSES)
  })
]);
export type LaunchCampaignSpec = z.infer<typeof launchCampaignSchema>;

export const launchAdsetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), adsetId: fbIdSchema, ads: adsOfAdset }),
  z.object({
    mode: z.literal('new'),
    name: z.string().trim().min(1).max(LIMITS.nameLength),
    dailyBudget: moneySchema.optional(),
    bidStrategy: z.enum(BID_STRATEGIES).optional(),
    bidAmount: moneySchema.optional(),
    roasGoal: roasSchema.optional(),
    optimizationGoal: z.enum(OPTIMIZATION_GOALS),
    conversionEvent: z.enum(CONVERSION_EVENTS),
    pixelId: fbIdSchema.optional(),
    targeting: targetingSchema,
    status: z.enum(NODE_STATUSES),
    startTime: z.string().datetime({ offset: true }).optional(),
    ads: adsOfAdset
  })
]);
export type LaunchAdsetSpec = z.infer<typeof launchAdsetSchema>;

export const launchRequestSchema = z
  .object({
    /** Meta ad account id, digits only (no `act_`). */
    adAccountId: fbIdSchema,
    pageId: fbIdSchema,
    pixelId: fbIdSchema.optional(),
    campaign: launchCampaignSchema,
    adsets: z.array(launchAdsetSchema).min(1).max(LIMITS.adsetsPerCampaign),
    ads: z.array(launchAdSpecSchema).max(LIMITS.adsPerAdset).default([]),
    destination: z.object({ url: z.string().url(), displayLink: z.string().trim().max(255).optional() }).optional(),
    callToAction: z.enum(CALLS_TO_ACTION),
    urlTags: z.string().max(LIMITS.urlTagsLength).default(DEFAULT_URL_TAGS),
    adStatus: z.enum(NODE_STATUSES),
    requestId: z.string().uuid(),
    launchId: z.string().uuid().optional()
  })
  .superRefine((r, ctx) => {
    let total = 0;
    let fromCreative = false;
    r.adsets.forEach((a, i) => {
      const ads = a.ads ?? r.ads;
      if (ads.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets', i, 'ads'], message: 'Every ad set needs at least one ad' });
      }
      total += ads.length;
      if (ads.some(ad => !ad.postId)) fromCreative = true;
    });
    if (total > LIMITS.adsPerCampaign) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets'], message: `At most ${LIMITS.adsPerCampaign} ads per campaign (got ${total})` });
    }
    if (fromCreative && !r.destination) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destination'], message: 'A landing page is required for ads made from creatives' });
    }
    // New campaign: the side that holds the strategy decides what new ad sets carry (§8.4).
    const campaign = r.campaign;
    if (campaign.mode === 'new') {
      const cbo = !!campaign.dailyBudget;
      r.adsets.forEach((a, i) => {
        if (a.mode !== 'new') return;
        const strategy = cbo ? campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP' : a.bidStrategy;
        if (!cbo && !a.dailyBudget) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets', i, 'dailyBudget'], message: 'ABO ad sets need a daily budget' });
        }
        if (needsBidAmount(strategy) && !a.bidAmount) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets', i, 'bidAmount'], message: 'Set the amount for this bid strategy' });
        }
        if (needsRoasGoal(strategy)) {
          if (!a.roasGoal) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets', i, 'roasGoal'], message: 'Set the ROAS goal' });
          if (a.optimizationGoal !== 'VALUE') {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adsets', i, 'optimizationGoal'], message: 'ROAS goal needs the VALUE optimisation goal' });
          }
        }
      });
    }
  });
export type LaunchRequest = z.infer<typeof launchRequestSchema>;
export type LaunchRequestInput = z.input<typeof launchRequestSchema>;

// ─── Launch result (§7.3) ───────────────────────────────────────────────────

export type ItemStatus = 'ok' | 'failed' | 'skipped';

export interface LaunchAdResult {
  status: ItemStatus;
  id?: string;
  externalId?: string;
  name: string;
  creativeId?: string;
  postId?: string;
  error?: string;
  warning?: string;
}

export interface LaunchAdsetResult {
  status: ItemStatus;
  id?: string;
  externalId?: string;
  name: string;
  error?: string;
  warning?: string;
  ads: LaunchAdResult[];
}

export interface LaunchResult {
  campaign: { status: ItemStatus; id?: string; externalId?: string; name: string; error?: string; warning?: string };
  adsets: LaunchAdsetResult[];
  summary: { adsCreated: number; adsFailed: number; adsetsCreated: number; campaignCreated: boolean };
}

// ─── Options (§7.1) / landing (§7.2) ────────────────────────────────────────

export interface LauncherAdAccount {
  /** Meta id, digits only. */
  id: string;
  name: string;
  currency: string | null;
  accountStatus: number | null;
  isDemo: boolean;
}

export interface ExistingAdset {
  externalId: string;
  name: string;
  status: string;
  dailyBudget: string | null;
}

export interface ExistingCampaign {
  externalId: string;
  name: string;
  status: string;
  objective: string | null;
  /** Minor units (cents) as Meta returns them. Present = CBO. */
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  bidStrategy: BidStrategy | null;
  adsets: ExistingAdset[];
}

export interface LauncherOptions {
  adAccount: LauncherAdAccount;
  pages: Array<{ externalId: string; name: string; pictureUrl: string | null }>;
  pixels: Array<{ externalId: string; name: string }>;
  campaigns: ExistingCampaign[];
  /** Non-fatal problems loading part of the options (e.g. no pixel permission). */
  warnings: string[];
}

export interface LandingStore {
  storeId: string;
  storeName: string | null;
  hostname: string;
  product: { productId: string; handle: string; title: string; url: string; listingStatus: 'active' | 'draft' | 'archived' | 'unpublished' } | null;
  pages: Array<{ id: string; title: string; url: string }>;
}

// ─── Creatives ──────────────────────────────────────────────────────────────

export type MediaType = 'image' | 'video';

export interface CreativeDto {
  id: string;
  storeId: string;
  productId: string;
  productTitle: string;
  productCode: string;
  productHandle: string | null;
  name: string;
  angle: string;
  primaryText: string | null;
  headline: string | null;
  description: string | null;
  status: 'active' | 'archived';
  mediaType: MediaType;
  mediaUrl: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  /** Ads created from this creative (live mirror rows). */
  adsCount: number;
}

export const creativeCopySchema = z.object({
  angle: z.string().trim().min(1, 'Angle is required').max(255).transform(v => v.replace(/\|/g, '/')),
  primaryText: z.string().max(LIMITS.primaryTextLength).nullish(),
  headline: z.string().max(LIMITS.headlineLength).nullish(),
  description: z.string().max(LIMITS.descriptionLength).nullish()
});

export interface ProductOption {
  id: string;
  title: string;
  handle: string;
  code: string;
  imageUrl: string | null;
  status: string;
  creatives: number;
}

/** The creator part of a creative name: "First Last", else the email's local part. */
export function creatorDisplayName(u: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const full = [u.firstName, u.lastName].filter(s => s && s.trim()).join(' ').trim();
  return full || (u.email ?? '').split('@')[0] || 'Unknown';
}

/** `<creator> | <angle> | <code> - <dd/MM/yyyy>` (§4.1). */
export function creativeName(creator: string, angle: string, code: string, date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const clean = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  return `${clean(creator)} | ${clean(angle)} | ${clean(code)} - ${get('day')}/${get('month')}/${get('year')}`.slice(0, 500);
}

// ─── Posts (§7.4 / §7.5) ────────────────────────────────────────────────────

export const POST_RANGES = ['7d', '30d', '90d', 'lifetime'] as const;
export const POST_SORTS = ['spend', 'purchases', 'roas', 'recent'] as const;

export const postsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  productId: z.string().trim().max(40).optional(),
  creativeId: z.string().uuid().optional(),
  adAccountId: fbIdSchema.optional(),
  status: z.enum(['active', 'all']).default('all'),
  source: z.enum(['library', 'all']).default('all'),
  range: z.enum(POST_RANGES).default('30d'),
  sort: z.enum(POST_SORTS).default('recent'),
  postIds: z
    .string()
    .optional()
    .transform(v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(postIdSchema).max(LIMITS.postIdsPerLookup).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export type PostsQuery = z.infer<typeof postsQuerySchema>;

export interface PostMetrics {
  spend: string;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: string;
  roas: number | null;
  cpa: string | null;
}

export interface PostRow {
  postId: string;
  pageId: string;
  pageName: string | null;
  permalink: string;
  thumbnailUrl: string | null;
  isVideo: boolean;
  headline: string | null;
  primaryText: string | null;
  link: string | null;
  creative: { id: string; name: string; angle: string } | null;
  product: { id: string; title: string; code: string; imageUrl: string | null } | null;
  ads: number;
  activeAds: number;
  adAccounts: string[];
  lastAd: { id: string; name: string; campaignName: string | null; effectiveStatus: string } | null;
  firstUsedAt: string;
  lastUsedAt: string;
  currency: string | null;
  metrics: PostMetrics;
}

export interface PostsPage {
  items: PostRow[];
  total: number;
  hasMore: boolean;
  range: { from: string | null; to: string };
  missingPostIds: number;
}

export const refreshPostsSchema = z.object({
  adAccountId: fbIdSchema.optional(),
  productId: z.string().trim().max(40).optional(),
  creativeId: z.string().uuid().optional()
});

export interface RefreshPostsResult {
  checked: number;
  found: number;
  remaining: number;
  failures: Array<{ adAccountId: string; name: string; error: string }>;
}

/** `https://www.facebook.com/<pageId>/posts/<storyId>` */
export function postPermalink(postId: string): string {
  const [pageId, storyId] = postId.split('_');
  return `https://www.facebook.com/${pageId}/posts/${storyId}`;
}

// ─── Envelope (§7) ──────────────────────────────────────────────────────────

export type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };
