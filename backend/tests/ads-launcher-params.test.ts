/**
 * Ads Launcher pure pieces: Meta field builders, money/ROAS conversion,
 * creative sharing keys, name numbering and the shared zod contract (§15.1).
 */
import { describe, it, expect } from 'vitest';
import {
  adFields,
  adsetBidProblem,
  adsetFields,
  campaignFields,
  encodeForm,
  imageCreativeFields,
  majorToMinor,
  minorToMajor,
  postCreativeFields,
  roasToFloor,
  targetingFields,
  videoCreativeFields
} from '../src/ads-launcher/meta-params';
import { creativeKey, numberDuplicateNames, postKey, stableStringify } from '../src/ads-launcher/ad-names';
import { todayAsUtcDay } from '../src/ads-launcher/posts.service';
import {
  STARTER_PRESETS,
  creativeName,
  formatIssues,
  launchRequestSchema,
  normalizePresetConfig,
  presetConfigSchema,
  type LaunchAdsetSpec
} from '../src/ads-launcher/contract';

type NewAdset = Extract<LaunchAdsetSpec, { mode: 'new' }>;

const adset = (over: Partial<NewAdset> = {}): NewAdset => ({
  mode: 'new',
  name: 'AS',
  optimizationGoal: 'OFFSITE_CONVERSIONS',
  conversionEvent: 'PURCHASE',
  targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true },
  status: 'PAUSED',
  ...over
});

describe('money', () => {
  it('converts major units with BigInt, never floats', () => {
    expect(majorToMinor('12.50')).toBe('1250');
    expect(majorToMinor('50')).toBe('5000');
    expect(majorToMinor('0.1')).toBe('10');
    expect(majorToMinor('19.99')).toBe('1999');
    expect(majorToMinor('92233720368547758.07')).toBe('9223372036854775807');
    expect(() => majorToMinor('1.234')).toThrow();
    expect(() => majorToMinor('abc')).toThrow();
    expect(minorToMajor('1250')).toBe('12.50');
  });

  it('ROAS goal × 10000', () => {
    expect(roasToFloor('1.8')).toBe('18000');
    expect(roasToFloor('1.5')).toBe('15000');
    expect(roasToFloor('2')).toBe('20000');
    expect(roasToFloor('0.01')).toBe('100');
    expect(roasToFloor('1.234')).toBe('12340');
  });
});

describe('campaign fields', () => {
  it('CBO carries budget + strategy', () => {
    const f = campaignFields({ name: 'C', objective: 'OUTCOME_SALES', status: 'PAUSED', dailyBudget: '50', bidStrategy: 'COST_CAP' });
    expect(f).toMatchObject({ daily_budget: '5000', bid_strategy: 'COST_CAP', special_ad_categories: [], buying_type: 'AUCTION' });
    expect(f.is_adset_budget_sharing_enabled).toBeUndefined();
  });

  it('ABO carries no budget, no strategy, and the explicit budget-sharing flag', () => {
    const f = campaignFields({ name: 'C', objective: 'OUTCOME_SALES', status: 'PAUSED' });
    expect(f.daily_budget).toBeUndefined();
    expect(f.bid_strategy).toBeUndefined();
    expect(f.is_adset_budget_sharing_enabled).toBe(false);
  });
});

describe('ad set fields (§8.4)', () => {
  it('CBO highest volume: nothing about bidding', () => {
    const f = adsetFields(adset(), { campaignId: '1', holder: { mode: 'CBO', strategy: 'LOWEST_COST_WITHOUT_CAP' }, pixelId: '9' });
    expect(f.bid_amount).toBeUndefined();
    expect(f.bid_strategy).toBeUndefined();
    expect(f.daily_budget).toBeUndefined();
    expect(f.promoted_object).toEqual({ pixel_id: '9', custom_event_type: 'PURCHASE' });
    expect(f.billing_event).toBe('IMPRESSIONS');
  });

  it('CBO cost cap: bid_amount in cents', () => {
    const f = adsetFields(adset({ bidAmount: '25' }), { campaignId: '1', holder: { mode: 'CBO', strategy: 'COST_CAP' }, pixelId: '9' });
    expect(f.bid_amount).toBe('2500');
  });

  it('CBO ROAS goal: floor, VALUE, never bid_amount; VALUE always PURCHASE', () => {
    const f = adsetFields(adset({ roasGoal: '1.8', bidAmount: '25', optimizationGoal: 'VALUE', conversionEvent: 'ADD_TO_CART' }), {
      campaignId: '1', holder: { mode: 'CBO', strategy: 'LOWEST_COST_WITH_MIN_ROAS' }, pixelId: '9'
    });
    expect(f.bid_constraints).toEqual({ roas_average_floor: 18000 });
    expect(f.bid_amount).toBeUndefined();
    expect(f.optimization_goal).toBe('VALUE');
    expect(f.promoted_object).toEqual({ pixel_id: '9', custom_event_type: 'PURCHASE' });
  });

  it('ABO: budget + strategy + amount on the ad set', () => {
    const f = adsetFields(adset({ dailyBudget: '20', bidStrategy: 'LOWEST_COST_WITH_BID_CAP', bidAmount: '3.5' }), {
      campaignId: '1', holder: { mode: 'ABO' }, pixelId: '9'
    });
    expect(f).toMatchObject({ daily_budget: '2000', bid_strategy: 'LOWEST_COST_WITH_BID_CAP', bid_amount: '350' });
  });

  it('CBO with unknown strategy sends what the request carries', () => {
    expect(adsetFields(adset({ bidAmount: '10' }), { campaignId: '1', holder: { mode: 'CBO', strategy: null }, pixelId: '9' }).bid_amount).toBe('1000');
    expect(adsetFields(adset({ roasGoal: '2' }), { campaignId: '1', holder: { mode: 'CBO', strategy: null }, pixelId: '9' }).bid_constraints)
      .toEqual({ roas_average_floor: 20000 });
  });

  it('existing CBO with a different strategy ignores the preset amount', () => {
    const f = adsetFields(adset({ bidAmount: '10' }), { campaignId: '1', holder: { mode: 'CBO', strategy: 'LOWEST_COST_WITHOUT_CAP' }, pixelId: '9' });
    expect(f.bid_amount).toBeUndefined();
  });

  it('reports problems instead of building a bad ad set', () => {
    expect(adsetBidProblem(adset(), { mode: 'ABO' })).toMatch(/daily budget/);
    expect(adsetBidProblem(adset(), { mode: 'CBO', strategy: 'COST_CAP' })).toMatch(/bid amount/);
    expect(adsetBidProblem(adset({ roasGoal: '2' }), { mode: 'CBO', strategy: 'LOWEST_COST_WITH_MIN_ROAS' })).toMatch(/VALUE/);
    expect(() => adsetFields(adset(), { campaignId: '1', holder: { mode: 'CBO', strategy: null } })).toThrow(/pixel/);
  });

  it('link-click goals need no pixel / promoted_object', () => {
    const f = adsetFields(adset({ optimizationGoal: 'LINK_CLICKS' }), { campaignId: '1', holder: { mode: 'CBO', strategy: null } });
    expect(f.promoted_object).toBeUndefined();
  });

  it('start_time passes through', () => {
    const f = adsetFields(adset({ startTime: '2026-10-08T00:00:00+07:00' }), { campaignId: '1', holder: { mode: 'CBO', strategy: null }, pixelId: '9' });
    expect(f.start_time).toBe('2026-10-08T00:00:00+07:00');
  });
});

describe('targeting', () => {
  it('always opts into Advantage+ audience; genders only for one gender', () => {
    const t = targetingFields({ countries: ['US', 'CA'], ageMin: 25, ageMax: 54, genders: [], advantagePlacements: true });
    expect(t).toEqual({ geo_locations: { countries: ['US', 'CA'] }, age_min: 25, age_max: 54, targeting_automation: { advantage_audience: 1 } });
    expect(targetingFields({ countries: ['US'], ageMin: 18, ageMax: 65, genders: [2], advantagePlacements: true }).genders).toEqual([2]);
  });

  it('custom / excluded audiences and interests', () => {
    const t = targetingFields({
      countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true,
      customAudienceIds: ['11', '12'], excludedAudienceIds: ['13'], interestIds: ['6003107902433']
    });
    expect(t.custom_audiences).toEqual([{ id: '11' }, { id: '12' }]);
    expect(t.excluded_custom_audiences).toEqual([{ id: '13' }]);
    expect(t.flexible_spec).toEqual([{ interests: [{ id: '6003107902433' }] }]);
    const none = targetingFields({ countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true, customAudienceIds: [], interestIds: [] });
    expect(none.custom_audiences).toBeUndefined();
    expect(none.flexible_spec).toBeUndefined();
  });

  it('placements only when Advantage+ placements is off', () => {
    const t = targetingFields({ countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: false });
    expect(t.publisher_platforms).toEqual(['facebook', 'instagram']);
    expect(t.facebook_positions).toEqual(['feed', 'story', 'facebook_reels']);
    expect(t.instagram_positions).toEqual(['stream', 'story', 'reels']);
  });
});

describe('creative + ad fields', () => {
  const copy = { primaryText: 'Body', headline: 'Head', description: 'Desc' };

  it('image → link_data with caption = display link', () => {
    const f = imageCreativeFields({ name: 'N', pageId: 'P', imageHash: 'H', link: 'https://s.com/p', displayLink: 's.com', copy, callToAction: 'SHOP_NOW', urlTags: 'utm=1' });
    expect(f).toEqual({
      name: 'N',
      url_tags: 'utm=1',
      object_story_spec: {
        page_id: 'P',
        link_data: {
          link: 'https://s.com/p', image_hash: 'H', message: 'Body', name: 'Head', description: 'Desc', caption: 's.com',
          call_to_action: { type: 'SHOP_NOW', value: { link: 'https://s.com/p' } }
        }
      }
    });
  });

  it('empty copy is omitted rather than sent blank', () => {
    const f = imageCreativeFields({ name: 'N', pageId: 'P', imageHash: 'H', link: 'https://s.com', copy: { primaryText: '', headline: '', description: '' }, callToAction: 'SHOP_NOW', urlTags: '' });
    expect((f.object_story_spec as any).link_data).toEqual({ link: 'https://s.com', image_hash: 'H', call_to_action: { type: 'SHOP_NOW', value: { link: 'https://s.com' } } });
    expect(f.url_tags).toBeUndefined();
  });

  it('video → video_data (title = headline, link_description = description)', () => {
    const f = videoCreativeFields({ name: 'N', pageId: 'P', videoId: 'V', thumbnail: { imageHash: 'T' }, link: 'https://s.com', copy, callToAction: 'LEARN_MORE', urlTags: 'u' });
    expect((f.object_story_spec as any).video_data).toEqual({
      video_id: 'V', image_hash: 'T', title: 'Head', message: 'Body', link_description: 'Desc',
      call_to_action: { type: 'LEARN_MORE', value: { link: 'https://s.com' } }
    });
    const g = videoCreativeFields({ name: 'N', pageId: 'P', videoId: 'V', thumbnail: { imageUrl: 'https://x/t.jpg' }, link: 'https://s.com', copy, callToAction: 'LEARN_MORE', urlTags: 'u' });
    expect((g.object_story_spec as any).video_data.image_url).toBe('https://x/t.jpg');
  });

  it('Instagram account goes in object_story_spec.instagram_user_id (never instagram_actor_id)', () => {
    const img = imageCreativeFields({ name: 'N', pageId: 'P', instagramUserId: '777', imageHash: 'H', link: 'https://s.com', copy, callToAction: 'SHOP_NOW', urlTags: '' });
    expect((img.object_story_spec as any).instagram_user_id).toBe('777');
    const vid = videoCreativeFields({ name: 'N', pageId: 'P', instagramUserId: '777', videoId: 'V', thumbnail: { imageHash: 'T' }, link: 'https://s.com', copy, callToAction: 'SHOP_NOW', urlTags: '' });
    expect((vid.object_story_spec as any).instagram_user_id).toBe('777');
    const noIg = imageCreativeFields({ name: 'N', pageId: 'P', imageHash: 'H', link: 'https://s.com', copy, callToAction: 'SHOP_NOW', urlTags: '' });
    expect(JSON.stringify(noIg)).not.toMatch(/instagram/);
  });

  it('old post → object_story_id only', () => {
    expect(postCreativeFields({ name: 'P', postId: '1_2', urlTags: 'u' })).toEqual({ name: 'P', object_story_id: '1_2', url_tags: 'u' });
  });

  it('ad + form encoding (objects as JSON strings)', () => {
    const f = adFields({ name: 'A', adsetId: '7', creativeId: '8', status: 'PAUSED' });
    const form = encodeForm(f);
    expect(form.get('creative')).toBe('{"creative_id":"8"}');
    expect(form.get('adset_id')).toBe('7');
    expect(encodeForm({ special_ad_categories: [] }).get('special_ad_categories')).toBe('[]');
  });
});

describe('sharing keys and names', () => {
  it('stable JSON ignores key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[1,{"e":2,"f":1}],"d":2},"b":1}');
  });

  it('same creative/page/link/copy → same key; any difference → new key', () => {
    const base = { creativeId: 'c1', pageId: 'p', instagramUserId: '', link: 'l', displayLink: 'd', callToAction: 'SHOP_NOW', urlTags: 'u', copy: { primaryText: 'a', headline: 'b', description: 'c' } };
    expect(creativeKey(base)).toBe(creativeKey({ ...base, copy: { description: 'c', headline: 'b', primaryText: 'a' } }));
    expect(creativeKey(base)).not.toBe(creativeKey({ ...base, copy: { ...base.copy, primaryText: 'x' } }));
    expect(creativeKey(base)).not.toBe(creativeKey({ ...base, instagramUserId: '777' }));
    expect(postKey('1_2', 'u')).toBe(postKey('1_2', 'u'));
    expect(postKey('1_2', 'u')).not.toBe(postKey('1_2', 'v'));
  });

  it('numbers repeated names in order, leaves singles alone', () => {
    expect(numberDuplicateNames(['A', 'A', 'B', 'A'])).toEqual(['A #1', 'A #2', 'B', 'A #3']);
    expect(numberDuplicateNames(['A', 'B'])).toEqual(['A', 'B']);
    const long = 'x'.repeat(300);
    expect(numberDuplicateNames([long, long])[0]).toHaveLength(255);
  });

  it('creative name format', () => {
    expect(creativeName('Triết', 'Dead corner | fix', 'SINLTB071SHNA', new Date('2026-04-25T10:00:00Z'), 'UTC'))
      .toBe('Triết | Dead corner / fix | SINLTB071SHNA - 25/04/2026');
  });
});

describe('posts range', () => {
  it('"today" is the system-time-zone day, not the UTC day', () => {
    const lateEveningUtc = new Date('2026-10-07T20:00:00Z'); // already Oct 8 in Asia/Ho_Chi_Minh
    expect(todayAsUtcDay(lateEveningUtc, 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(todayAsUtcDay(lateEveningUtc, 'UTC').toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(todayAsUtcDay(lateEveningUtc, 'America/Los_Angeles').toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('contract: presets', () => {
  it('starters are valid', () => {
    for (const s of STARTER_PRESETS) expect(presetConfigSchema.safeParse(s.config).success).toBe(true);
  });

  it('n at one level only; age order; amount / ROAS rules', () => {
    const c = STARTER_PRESETS[0].config;
    expect(presetConfigSchema.safeParse({ ...c, structure: { campaigns: 'n', adsetsPerCampaign: 'n', adsPerAdset: 1 } }).success).toBe(false);
    const badAge = { ...c, adset: { ...c.adset, audiences: [{ ...c.adset.audiences[0], ageMin: 40, ageMax: 30 }] } };
    expect(presetConfigSchema.safeParse(badAge).success).toBe(false);

    const costCap = presetConfigSchema.safeParse({ ...c, campaign: { ...c.campaign, bidStrategy: 'COST_CAP' } });
    expect(costCap.success).toBe(false);
    if (!costCap.success) expect(formatIssues(costCap.error)).toContain('Campaign · bidAmount: Set the amount for this bid strategy');

    const roas = presetConfigSchema.safeParse({ ...c, campaign: { ...c.campaign, bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS', roasGoal: '1.5' } });
    expect(roas.success).toBe(false);
    if (!roas.success) expect(formatIssues(roas.error).join()).toMatch(/Ad set · optimizationGoal/);
  });

  it('audiences may carry custom audiences + interests (id + name)', () => {
    const c = STARTER_PRESETS[0].config;
    const withRefs = { ...c, adset: { ...c.adset, audiences: [{ ...c.adset.audiences[0], customAudiences: [{ id: '11', name: 'Buyers' }], interests: [{ id: '6003', name: 'Hair' }] }] } };
    expect(presetConfigSchema.safeParse(withRefs).success).toBe(true);
    const badId = { ...c, adset: { ...c.adset, audiences: [{ ...c.adset.audiences[0], interests: [{ id: 'abc', name: 'x' }] }] } };
    expect(presetConfigSchema.safeParse(badId).success).toBe(false);
  });

  it('old presets read as repeat on + Highest volume', () => {
    const { repeatToFill, ...structure } = STARTER_PRESETS[0].config.structure;
    const { bidStrategy, ...campaign } = STARTER_PRESETS[0].config.campaign;
    const n = normalizePresetConfig({ ...STARTER_PRESETS[0].config, structure, campaign });
    expect(n?.structure.repeatToFill).toBe(true);
    expect(n?.campaign.bidStrategy).toBe('LOWEST_COST_WITHOUT_CAP');
    expect(normalizePresetConfig({ junk: true })).toBeNull();
  });
});

describe('contract: launch request', () => {
  const base = {
    adAccountId: '123',
    pageId: '456',
    pixelId: '789',
    campaign: { mode: 'new', name: 'C', objective: 'OUTCOME_SALES', dailyBudget: '50', bidStrategy: 'COST_CAP', status: 'PAUSED' },
    adsets: [{ ...adset({ bidAmount: '25' }), ads: [{ creativeId: '7b0c1c9e-8a43-4d36-9e37-111111111111' }] }],
    destination: { url: 'https://s.com/products/x', displayLink: 's.com' },
    callToAction: 'SHOP_NOW',
    adStatus: 'PAUSED',
    requestId: '7b0c1c9e-8a43-4d36-9e37-222222222222'
  };

  it('accepts a valid request and fills defaults', () => {
    const r = launchRequestSchema.parse(base);
    expect(r.ads).toEqual([]);
    expect(r.urlTags).toContain('utm_content={{ad.id}}');
  });

  it('each ad set needs ads; ≤ 200 per campaign', () => {
    expect(launchRequestSchema.safeParse({ ...base, adsets: [adset({ bidAmount: '1' })] }).success).toBe(false);
    const many = Array.from({ length: 50 }, () => ({ creativeId: '7b0c1c9e-8a43-4d36-9e37-111111111111' }));
    const r = launchRequestSchema.safeParse({ ...base, adsets: Array.from({ length: 5 }, () => ({ ...adset({ bidAmount: '1' }), ads: many })) });
    expect(r.success).toBe(false);
  });

  it('posts cannot carry copy; posts-only needs no destination', () => {
    const post = { postId: '1000000001_555555555' };
    expect(launchRequestSchema.safeParse({ ...base, destination: undefined, adsets: [{ ...adset({ bidAmount: '1' }), ads: [post] }] }).success).toBe(true);
    expect(launchRequestSchema.safeParse({ ...base, adsets: [{ ...adset({ bidAmount: '1' }), ads: [{ ...post, primaryText: 'x' }] }] }).success).toBe(false);
    expect(launchRequestSchema.safeParse({ ...base, destination: undefined }).success).toBe(false);
    expect(launchRequestSchema.safeParse({ ...base, adsets: [{ ...adset({ bidAmount: '1' }), ads: [{ postId: '12_34' }] }] }).success).toBe(false);
  });

  it('new campaign bid rules are enforced up front', () => {
    expect(launchRequestSchema.safeParse({ ...base, adsets: [{ ...adset(), ads: base.adsets[0].ads }] }).success).toBe(false);
    const abo = { ...base, campaign: { ...base.campaign, dailyBudget: undefined, bidStrategy: undefined } };
    expect(launchRequestSchema.safeParse({ ...abo, adsets: [{ ...adset(), ads: base.adsets[0].ads }] }).success).toBe(false);
    expect(launchRequestSchema.safeParse({ ...abo, adsets: [{ ...adset({ dailyBudget: '20' }), ads: base.adsets[0].ads }] }).success).toBe(true);
    const roas = { ...base, campaign: { ...base.campaign, bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS' } };
    expect(launchRequestSchema.safeParse({ ...roas, adsets: [{ ...adset({ roasGoal: '1.8' }), ads: base.adsets[0].ads }] }).success).toBe(false);
    expect(launchRequestSchema.safeParse({ ...roas, adsets: [{ ...adset({ roasGoal: '1.8', optimizationGoal: 'VALUE' }), ads: base.adsets[0].ads }] }).success).toBe(true);
  });
});
