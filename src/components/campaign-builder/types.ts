/**
 * Shared types for the auto-launch wizard. These mirror the backend
 * service types in fb-ad-launch.service.ts — keep them in sync.
 */

export interface AdCopy {
  primary_texts: string[];
  headlines: string[];
  descriptions: string[];
}

export interface AudienceSpec {
  name: string;
  countries?: string[];
  ageMin?: number;
  ageMax?: number;
  /** 1 = male, 2 = female. Empty = All. */
  genders?: number[];
  customAudiences?: string[];
  lookalikes?: string[];
  excludedCustomAudiences?: string[];
  interestIds?: string[];
  publisherPlatforms?: string[];
  facebookPositions?: string[];
  instagramPositions?: string[];
  devicePlatforms?: string[];
  optimizationGoal?: string;
  customEventType?: string;
}

export interface AdSetSpec {
  name: string;
  audience: AudienceSpec;
  /** Per-ad-set daily budget in cents. Omit when using CBO. */
  dailyBudget?: number;
}

export type BidStrategyChoice = 'highest_volume' | 'bid_cap' | 'cost_cap';

export interface WizardConfig {
  adAccountId: string;
  campaignName: string;
  pageId: string;
  pixelId: string;
  instagramActorId?: string;
  linkUrl: string;
  urlParams: string;
  budgetMode: 'cbo' | 'abo';                   // campaign- vs ad-set-level budget
  /** USD (frontend) — the API gets cents. */
  campaignDailyBudgetUsd: string;
  bidStrategy: BidStrategyChoice;
  /** USD (frontend) — the API gets cents. */
  bidAmountUsd: string;
  objective: string;                            // OUTCOME_SALES, etc.
  callToAction: string;
  status: 'PAUSED' | 'ACTIVE';
  startTimeIso?: string;                        // ISO local; converted to unix on submit
  adSets: AdSetSpec[];
  globalCopy: AdCopy;
}

export interface FbPage { id: string; name: string; instagram_business_account?: { id: string } }
export interface FbPixel { id: string; name: string }
export interface FbAudience { id: string; name: string; subtype?: string; approximate_count_lower_bound?: number }
export interface FbInterest { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[] }

export interface LaunchProgressEvent {
  step: 'campaign' | 'adset' | 'upload' | 'video-wait' | 'history-saved' | 'complete' | 'error';
  status: string;
  message: string;
  index?: number;
  total?: number;
  filename?: string;
  id?: string;
  adId?: string;
  adSetId?: string;
  campaignId?: string;
  historyId?: string;
  error?: string;
  results?: Array<{ filename: string; status: string; adId?: string; adSetId?: string; error?: string }>;
  summary?: { total: number; success: number; failed: number };
}

export interface HistoryRow {
  id: string;
  accountId: string;
  campaignId: string | null;
  campaignName: string;
  status: string;       // pending | partial | success | failed | rolled_back
  totalAds: number;
  successAds: number;
  failedAds: number;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
}

export interface HistoryItem {
  id: string;
  filename: string;
  adSetId: string | null;
  adId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface HistoryDetail extends HistoryRow {
  items: HistoryItem[];
  configSnapshot: Record<string, unknown>;
}

export interface TemplateRow {
  id: string;
  name: string;
  config: Partial<WizardConfig>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_AUDIENCE: AudienceSpec = {
  name: 'Default',
  countries: ['US', 'GB', 'CA', 'AU'],
  optimizationGoal: 'OFFSITE_CONVERSIONS',
  customEventType: 'PURCHASE'
};

export const EMPTY_WIZARD_CONFIG: WizardConfig = {
  adAccountId: '',
  campaignName: '',
  pageId: '',
  pixelId: '',
  linkUrl: '',
  urlParams: '',
  budgetMode: 'cbo',
  campaignDailyBudgetUsd: '50',
  bidStrategy: 'highest_volume',
  bidAmountUsd: '10',
  objective: 'OUTCOME_SALES',
  callToAction: 'SHOP_NOW',
  status: 'PAUSED',
  adSets: [{ name: 'Ad set 1', audience: { ...DEFAULT_AUDIENCE } }],
  globalCopy: { primary_texts: [], headlines: [], descriptions: [] }
};

export const OBJECTIVES: Array<{ value: string; label: string }> = [
  { value: 'OUTCOME_SALES', label: 'Sales (conversions)' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { value: 'OUTCOME_LEADS', label: 'Leads' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' }
];

export const OPTIMIZATION_GOALS: Array<{ value: string; label: string }> = [
  { value: 'OFFSITE_CONVERSIONS', label: 'Conversions' },
  { value: 'VALUE', label: 'Value' },
  { value: 'LINK_CLICKS', label: 'Link clicks' },
  { value: 'IMPRESSIONS', label: 'Impressions' },
  { value: 'REACH', label: 'Reach' },
  { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views' }
];

export const CUSTOM_EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'INITIATE_CHECKOUT', label: 'Initiate checkout' },
  { value: 'ADD_TO_CART', label: 'Add to cart' },
  { value: 'COMPLETE_REGISTRATION', label: 'Complete registration' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'CONTENT_VIEW', label: 'View content' }
];

export const CTA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'GET_OFFER', label: 'Get offer' },
  { value: 'ORDER_NOW', label: 'Order now' },
  { value: 'BUY_NOW', label: 'Buy now' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'SUBSCRIBE', label: 'Subscribe' }
];

export const PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'] as const;
