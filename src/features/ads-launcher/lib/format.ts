/**
 * Labels and small formatters for the launcher UI. Pure.
 */
import type {
  BudgetMode,
  CallToAction,
  ConversionEvent,
  Objective,
  OptimizationGoal
} from '@contract/ads-launcher';
import { bidStrategyLabel, type Audience, type ExistingCampaign, type LaunchPresetConfig } from '@contract/ads-launcher';
import { genderLabel, optimizationGoalLabel } from './structure';

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  OUTCOME_SALES: 'Sales',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_AWARENESS: 'Awareness'
};

export const CTA_LABELS: Record<CallToAction, string> = {
  SHOP_NOW: 'Shop now',
  LEARN_MORE: 'Learn more',
  ORDER_NOW: 'Order now',
  BUY_NOW: 'Buy now',
  GET_OFFER: 'Get offer',
  SIGN_UP: 'Sign up',
  SUBSCRIBE: 'Subscribe',
  CONTACT_US: 'Contact us'
};

export const EVENT_LABELS: Record<ConversionEvent, string> = {
  PURCHASE: 'Purchase',
  ADD_TO_CART: 'Add to cart',
  INITIATE_CHECKOUT: 'Initiate checkout',
  LEAD: 'Lead',
  COMPLETE_REGISTRATION: 'Complete registration'
};

export const objectiveLabel = (o: Objective | string | null | undefined) =>
  (o && OBJECTIVE_LABELS[o as Objective]) || o || '—';
export const ctaLabel = (c: CallToAction) => CTA_LABELS[c] ?? c;
export const goalLabel = (g: OptimizationGoal) => optimizationGoalLabel(g);

/** "50" + "USD" → "$50.00"; falls back to "50 XYZ" for unknown currencies. */
export function formatMoney(major: string | number | null | undefined, currency?: string | null): string {
  if (major === null || major === undefined || major === '') return '—';
  const n = Number(major);
  if (!Number.isFinite(n)) return String(major);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

/** Meta minor units ("5000") → major-unit string ("50.00"), with strings, never floats. */
export function minorToMajor(minor: string | null | undefined): string | null {
  if (!minor || !/^\d+$/.test(minor)) return null;
  const padded = minor.padStart(3, '0');
  return `${padded.slice(0, -2).replace(/^0+(?=\d)/, '')}.${padded.slice(-2)}`;
}

/** "CBO $50.00/day", "CBO $300.00 lifetime" or "ABO" for a synced campaign. */
export function campaignBudgetText(c: ExistingCampaign, currency?: string | null): string {
  if (c.dailyBudget) return `CBO ${formatMoney(minorToMajor(c.dailyBudget), currency)}/day`;
  if (c.lifetimeBudget) return `CBO ${formatMoney(minorToMajor(c.lifetimeBudget), currency)} lifetime`;
  return 'ABO';
}

/** "+2 audiences · −1 · 3 interests" ('' when there is no detailed targeting). */
export function detailedTargetingText(a: Audience | null | undefined): string {
  if (!a) return '';
  const inc = a.customAudiences?.length ?? 0;
  const exc = a.excludedAudiences?.length ?? 0;
  const int = a.interests?.length ?? 0;
  return [
    inc ? `+${inc} audience${inc === 1 ? '' : 's'}` : '',
    exc ? `−${exc}` : '',
    int ? `${int} interest${int === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Broad · US, CA · 18–65 · All genders · +2 audiences · −1 · 3 interests". */
export function audienceText(a: Audience | null | undefined): string {
  if (!a) return 'No audience';
  const detail = detailedTargetingText(a);
  return `${a.label} · ${a.countries.join(', ')} · ${a.ageMin}–${a.ageMax} · ${genderLabel(a.gender)}${detail ? ` · ${detail}` : ''}`;
}

/** 1234567 → "1.2M" (audience sizes). */
export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export const actId = (id: string) => `act_${id}`;
export const adsManagerUrl = (adAccountId: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(adAccountId)}`;
export const adsManagerCampaignUrl = (adAccountId: string, campaignId: string) =>
  `${adsManagerUrl(adAccountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`;

/** `<input type="datetime-local">` value (browser time) → ISO 8601; '' → null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** One line of budget + bid for cards and diagrams: "CBO $50/day · Cost per result goal $25". */
export function budgetSummary(config: LaunchPresetConfig, currency?: string | null): string {
  const c = config.campaign;
  const budget = `${c.budgetMode} ${formatMoney(c.dailyBudget, currency)}/day${c.budgetMode === 'ABO' ? ' per ad set' : ''}`;
  return `${budget} · ${bidSummary(config, currency)}`;
}

export function bidSummary(config: LaunchPresetConfig, currency?: string | null): string {
  const c = config.campaign;
  const label = bidStrategyLabel(c.bidStrategy, config.adset.optimizationGoal);
  if (c.bidStrategy === 'COST_CAP' || c.bidStrategy === 'LOWEST_COST_WITH_BID_CAP') {
    return c.bidAmount ? `${label} ${formatMoney(c.bidAmount, currency)}` : label;
  }
  if (c.bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS') return c.roasGoal ? `${label} ${c.roasGoal}` : label;
  return label;
}

export const budgetModeLabel = (m: BudgetMode) => (m === 'CBO' ? 'Campaign budget (CBO)' : 'Ad set budget (ABO)');

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}
