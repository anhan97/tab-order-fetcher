import { describe, expect, it } from 'vitest';
import {
  STARTER_PRESETS,
  launchRequestSchema,
  type Count,
  type ExistingCampaign,
  type LaunchPresetConfig
} from '@contract/ads-launcher';
import type { PoolItem } from './pool';
import {
  angleToken,
  buildStructureRequests,
  cleanName,
  configIssues,
  dateToken,
  fillTemplate,
  fillTo,
  numberDuplicateNames,
  planStructure,
  resolveStructure,
  setupIssues,
  targetIssues,
  type LaunchRequestDraft,
  type LaunchSetup,
  type StructurePlan
} from './structure';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const creative = (letter: string, n: number, angle = `Angle ${letter}`): PoolItem => ({
  key: uuid(n),
  kind: 'creative',
  creativeId: uuid(n),
  postId: null,
  name: letter,
  angle,
  thumbUrl: null,
  mediaUrl: null,
  mediaType: 'image',
  productId: '111',
  productTitle: 'Comb',
  productCode: 'COMB',
  primaryText: `Primary ${letter}`,
  headline: `Headline ${letter}`,
  description: ''
});

const post = (postId: string, creativeId: string | null = null): PoolItem => ({
  key: `post:${postId}`,
  kind: 'post',
  creativeId,
  postId,
  name: `Post ${postId}`,
  angle: '',
  thumbUrl: null,
  mediaUrl: null,
  mediaType: 'image',
  productId: null,
  productTitle: null,
  productCode: null,
  primaryText: '',
  headline: '',
  description: ''
});

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pool = (n: number) => Array.from({ length: n }, (_, i) => creative(i < 26 ? LETTERS[i] : `X${i}`, i + 1));

const base = (): LaunchPresetConfig => JSON.parse(JSON.stringify(STARTER_PRESETS[0].config));

const cfg = (
  C: Count,
  S: Count,
  A: Count,
  repeatToFill?: boolean,
  patch: (c: LaunchPresetConfig) => void = () => {}
): LaunchPresetConfig => {
  const c = base();
  c.structure = { campaigns: C, adsetsPerCampaign: S, adsPerAdset: A };
  if (repeatToFill !== undefined) c.structure.repeatToFill = repeatToFill;
  patch(c);
  return c;
};

const NOW = new Date('2026-10-07T08:00:00Z');
const plan = (config: LaunchPresetConfig, items: PoolItem[], overrides?: Record<string, string[]>) =>
  planStructure({ config, items, overrides, product: { title: 'Comb', code: 'COMB' }, presetName: 'My preset', now: NOW, timeZone: 'UTC' });

const counts = (p: StructurePlan) => [p.counts.campaigns, p.counts.adsets, p.counts.ads];
const letters = (p: StructurePlan) => p.campaigns.map(c => c.adsets.map(a => a.ads.map(ad => ad.item.name)));

const SETUP: LaunchSetup = {
  adAccountId: '900000000000001',
  pixelId: '2000000002',
  pageId: '1000000001',
  storeId: 'store-1',
  landingUrl: 'https://shop-a.com/products/comb',
  displayLink: 'shop-a.com',
  urlTags: 'utm_source=fb'
};

const validate = (r: LaunchRequestDraft) =>
  launchRequestSchema.safeParse({ ...r, requestId: '11111111-1111-4111-8111-111111111111' });

const expectAllValid = (requests: LaunchRequestDraft[]) => {
  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) {
    const parsed = validate(r);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    expect(r).not.toHaveProperty('requestId');
    expect(r).not.toHaveProperty('launchId');
    expect(r.ads).toEqual([]);
    for (const a of r.adsets) expect(a.ads && a.ads.length).toBeGreaterThan(0);
  }
};

// ─── §5.3 algorithm ─────────────────────────────────────────────────────────

describe('fillTo', () => {
  it('repeats in order up to k', () => {
    expect(fillTo(['A'], 3)).toEqual(['A', 'A', 'A']);
    expect(fillTo(['A', 'B'], 5)).toEqual(['A', 'B', 'A', 'B', 'A']);
  });
  it('leaves full or empty lists alone (and copies them)', () => {
    const xs = ['A', 'B', 'C'];
    expect(fillTo(xs, 2)).toEqual(xs);
    expect(fillTo(xs, 2)).not.toBe(xs);
    expect(fillTo([], 3)).toEqual([]);
  });
});

describe('resolveStructure', () => {
  it('returns an empty grid for an empty pool', () => {
    expect(resolveStructure({ campaigns: 1, adsetsPerCampaign: 1, adsPerAdset: 'n' }, [])).toEqual({ grid: [], leftOut: [] });
  });
  it('drops duplicate ids before dealing', () => {
    const { grid } = resolveStructure({ campaigns: 1, adsetsPerCampaign: 1, adsPerAdset: 'n' }, ['A', 'A', 'B']);
    expect(grid).toEqual([[['A', 'B']]]);
  });
  it('treats a missing repeatToFill as on', () => {
    const { grid } = resolveStructure({ campaigns: 1, adsetsPerCampaign: 'n', adsPerAdset: 3 }, ['A', 'B', 'C', 'D']);
    expect(grid).toEqual([[['A', 'B', 'C'], ['D', 'D', 'D']]]);
  });
});

// ─── §5.2 table, row by row ─────────────────────────────────────────────────

describe('planStructure — §5.2 examples', () => {
  it('1:1:n, 6 → 1 · 1 · 6', () => {
    const p = plan(cfg(1, 1, 'n'), pool(6));
    expect(counts(p)).toEqual([1, 1, 6]);
    expect(letters(p)).toEqual([[['A', 'B', 'C', 'D', 'E', 'F']]]);
    expect(p.issues).toEqual([]);
  });

  it('1:3:n, 6 → 1 · 3 · 18', () => {
    expect(counts(plan(cfg(1, 3, 'n'), pool(6)))).toEqual([1, 3, 18]);
  });

  it('3:1:n, 6 → 3 · 3 · 18', () => {
    expect(counts(plan(cfg(3, 1, 'n'), pool(6)))).toEqual([3, 3, 18]);
  });

  it('1:n:1, 6 → 1 · 6 · 6', () => {
    const p = plan(cfg(1, 'n', 1), pool(6));
    expect(counts(p)).toEqual([1, 6, 6]);
    expect(letters(p)).toEqual([[['A'], ['B'], ['C'], ['D'], ['E'], ['F']]]);
  });

  it('1:n:3, 6 → 1 · 2 · 6', () => {
    const p = plan(cfg(1, 'n', 3), pool(6));
    expect(counts(p)).toEqual([1, 2, 6]);
    expect(letters(p)).toEqual([[['A', 'B', 'C'], ['D', 'E', 'F']]]);
  });

  it('1:n:3, 4 with repeat → 1 · 2 · 6: [A,B,C], [D,D,D]', () => {
    const p = plan(cfg(1, 'n', 3, true), pool(4));
    expect(counts(p)).toEqual([1, 2, 6]);
    expect(letters(p)).toEqual([[['A', 'B', 'C'], ['D', 'D', 'D']]]);
  });

  it('1:n:3, 4 without repeat → 1 · 2 · 4: [A,B,C], [D]', () => {
    const p = plan(cfg(1, 'n', 3, false), pool(4));
    expect(counts(p)).toEqual([1, 2, 4]);
    expect(letters(p)).toEqual([[['A', 'B', 'C'], ['D']]]);
  });

  it('n:1:1, 6 → 6 · 6 · 6', () => {
    const p = plan(cfg('n', 1, 1), pool(6));
    expect(counts(p)).toEqual([6, 6, 6]);
    expect(letters(p)).toEqual([[['A']], [['B']], [['C']], [['D']], [['E']], [['F']]]);
  });

  it('n:2:1, 6 → 3 · 6 · 6', () => {
    const p = plan(cfg('n', 2, 1), pool(6));
    expect(counts(p)).toEqual([3, 6, 6]);
    expect(letters(p)).toEqual([[['A'], ['B']], [['C'], ['D']], [['E'], ['F']]]);
  });

  it('n:2:2, 5 with repeat → 2 · 4 · 8: [[A,B],[C,D]], [[E,E],[E,E]]', () => {
    const p = plan(cfg('n', 2, 2, true), pool(5));
    expect(counts(p)).toEqual([2, 4, 8]);
    expect(letters(p)).toEqual([[['A', 'B'], ['C', 'D']], [['E', 'E'], ['E', 'E']]]);
  });

  it('n:2:2, 5 without repeat → the short share stays short', () => {
    const p = plan(cfg('n', 2, 2, false), pool(5));
    expect(letters(p)).toEqual([[['A', 'B'], ['C', 'D']], [['E']]]);
    expect(counts(p)).toEqual([2, 3, 5]);
  });

  it('1:1:3, 1 creative with repeat → 1 · 1 · 3 named A #1, A #2, A #3', () => {
    const p = plan(cfg(1, 1, 3, true), pool(1));
    expect(counts(p)).toEqual([1, 1, 3]);
    expect(p.campaigns[0].adsets[0].ads.map(a => a.name)).toEqual(['A #1', 'A #2', 'A #3']);
  });

  it('1:1:3, 1 creative without repeat → 1 · 1 · 1', () => {
    const p = plan(cfg(1, 1, 3, false), pool(1));
    expect(counts(p)).toEqual([1, 1, 1]);
    expect(p.campaigns[0].adsets[0].ads.map(a => a.name)).toEqual(['A']);
  });

  it('1:3:2, 4 creatives → 1 · 3 · 6: [A,B], [C,D], [A,B] (wraps around)', () => {
    const p = plan(cfg(1, 3, 2), pool(4));
    expect(counts(p)).toEqual([1, 3, 6]);
    expect(letters(p)).toEqual([[['A', 'B'], ['C', 'D'], ['A', 'B']]]);
    expect(p.leftOut).toEqual([]);
  });

  it('1:2:2, 6 creatives → blocked: 4 slots for 6 items', () => {
    const p = plan(cfg(1, 2, 2), pool(6));
    expect(p.leftOut.map(i => i.name)).toEqual(['E', 'F']);
    expect(p.counts.slots).toBe(4);
    expect(p.issues).toContain('4 slots for 6 items: use "n" at one level or remove 2');
  });
});

describe('planStructure — repeat to fill', () => {
  it('fixed structure without repeat never repeats an item inside an ad set', () => {
    const p = plan(cfg(1, 1, 4, false), pool(2));
    expect(letters(p)).toEqual([[['A', 'B']]]);
  });
  it('has no effect when A = n', () => {
    expect(letters(plan(cfg(1, 2, 'n', false), pool(2)))).toEqual(letters(plan(cfg(1, 2, 'n', true), pool(2))));
  });
  it('de-duplicates the pool by key', () => {
    const items = pool(2);
    expect(plan(cfg(1, 1, 'n'), [...items, items[0]]).counts.ads).toBe(2);
  });
});

describe('planStructure — hand-edited ad sets', () => {
  it('replaces the ad set and fills it like an automatic one', () => {
    const items = pool(6);
    const p = plan(cfg(1, 'n', 3), items, { '0:1': [items[0].key] });
    expect(letters(p)).toEqual([[['A', 'B', 'C'], ['A', 'A', 'A']]]);
    expect(p.campaigns[0].adsets[1].overridden).toBe(true);
    expect(p.campaigns[0].adsets[0].overridden).toBe(false);
    expect(p.campaigns[0].adsets[1].ads.map(a => a.name)).toEqual(['A #1', 'A #2', 'A #3']);
  });
  it('does not fill when repeat is off', () => {
    const items = pool(6);
    const p = plan(cfg(1, 'n', 3, false), items, { '0:0': [items[5].key] });
    expect(letters(p)[0][0]).toEqual(['F']);
  });
  it('keeps the chosen list as is when A = n', () => {
    const items = pool(4);
    const p = plan(cfg(1, 2, 'n'), items, { '0:1': [items[3].key, items[1].key] });
    expect(letters(p)).toEqual([[['A', 'B', 'C', 'D'], ['D', 'B']]]);
  });
  it('ignores keys not in the pool, empty lists and ad sets that do not exist', () => {
    const items = pool(2);
    const p = plan(cfg(1, 1, 'n'), items, { '0:0': ['missing'], '3:3': [items[0].key] });
    expect(letters(p)).toEqual([[['A', 'B']]]);
    expect(p.campaigns[0].adsets[0].overridden).toBe(false);
  });
});

// ─── Naming (§5.4) ──────────────────────────────────────────────────────────

describe('naming', () => {
  it('cleans separators left by empty tokens', () => {
    expect(fillTemplate('{code} | CBO | {date}', { code: '', date: '07/10' })).toBe('CBO | 07/10');
    expect(fillTemplate('A | {x} | B', { x: '' })).toBe('A | B');
    expect(fillTemplate('A · {x} - B', { x: '' })).toBe('A · B');
    expect(fillTemplate('{x} - A -', { x: '' })).toBe('A');
    expect(fillTemplate('A |  {x}  |', { x: '' })).toBe('A');
  });
  it('keeps hyphens inside words and numbers', () => {
    expect(cleanName('Comb | 18-65 | Dead-corner')).toBe('Comb | 18-65 | Dead-corner');
  });
  it('keeps unknown tokens literally and collapses whitespace', () => {
    expect(fillTemplate('{foo}   |  {code}', { code: 'COMB' })).toBe('{foo} | COMB');
  });
  it('cuts to 255 characters', () => {
    expect(fillTemplate('{x}', { x: 'a'.repeat(300) })).toHaveLength(255);
  });
  it('numbers only names that repeat', () => {
    expect(numberDuplicateNames(['A', 'A', 'B', 'A'])).toEqual(['A #1', 'A #2', 'B', 'A #3']);
  });
  it('formats {date} as DD/MM in the given time zone', () => {
    const d = new Date('2026-10-07T20:00:00Z');
    expect(dateToken(d, 'UTC')).toBe('07/10');
    expect(dateToken(d, 'Asia/Ho_Chi_Minh')).toBe('08/10');
  });
  it('{angle} = first angle plus the number of other distinct items', () => {
    const [a, b, c] = pool(3);
    expect(angleToken([a])).toBe('Angle A');
    expect(angleToken([a, a, a])).toBe('Angle A');
    expect(angleToken([a, b, c])).toBe('Angle A +2');
    expect(angleToken([])).toBe('');
  });

  it('names campaigns from the template with every token', () => {
    const p = plan(cfg(1, 1, 'n', true, c => { c.campaign.nameTemplate = '{product} {code} {preset} {structure} {date} {n} {angle}'; }), pool(3));
    expect(p.campaigns[0].name).toBe('Comb COMB My preset 1-1-n 07/10 1 Angle A +2');
  });

  it('adds #1, #2… to identical campaign names when the template has no {n}', () => {
    const p = plan(cfg(3, 1, 'n'), pool(2));
    expect(p.campaigns.map(c => c.name)).toEqual(['COMB | CBO | 07/10 #1', 'COMB | CBO | 07/10 #2', 'COMB | CBO | 07/10 #3']);
  });

  it('uses {n} instead of the suffix when the template has it', () => {
    const p = plan(cfg(3, 1, 'n', true, c => { c.campaign.nameTemplate = '{code} | {n}'; }), pool(2));
    expect(p.campaigns.map(c => c.name)).toEqual(['COMB | 1', 'COMB | 2', 'COMB | 3']);
  });

  it('per-creative campaigns get their own angle and stay unique', () => {
    const p = plan(cfg('n', 1, 1, true, c => { c.campaign.nameTemplate = '{code} | {angle} | {date}'; }), pool(2));
    expect(p.campaigns.map(c => c.name)).toEqual(['COMB | Angle A | 07/10', 'COMB | Angle B | 07/10']);
  });

  it('numbers identical ad set names inside a campaign, and rotates audiences', () => {
    const p = plan(cfg(1, 3, 'n'), pool(2));
    expect(p.campaigns[0].adsets.map(a => a.name)).toEqual([
      'COMB | CBO | 07/10 | Broad #1',
      'COMB | CBO | 07/10 | Broad #2',
      'COMB | CBO | 07/10 | Broad #3'
    ]);
  });

  it('ad set i takes audience i mod count, with every ad set token', () => {
    const config = cfg(1, 3, 'n', true, c => {
      c.adset.nameTemplate = '{n} | {audience} | {country} | {age} | {gender} | {angle}';
      c.adset.audiences = [
        { label: 'Broad', countries: ['US', 'CA'], ageMin: 18, ageMax: 65, gender: 'all' },
        { label: 'Women', countries: ['US'], ageMin: 25, ageMax: 54, gender: 'women' }
      ];
    });
    const p = plan(config, pool(1));
    expect(p.campaigns[0].adsets.map(a => a.audience?.label)).toEqual(['Broad', 'Women', 'Broad']);
    expect(p.campaigns[0].adsets.map(a => a.name)).toEqual([
      '1 | Broad | US,CA | 18-65 | All genders | Angle A',
      '2 | Women | US | 25-54 | Women | Angle A',
      '3 | Broad | US,CA | 18-65 | All genders | Angle A'
    ]);
  });

  it('names post ads "Post <id>" unless they come from a creative', () => {
    const p = plan(cfg(1, 1, 'n'), [post('123_456'), { ...post('123_789'), name: 'Creative X' }]);
    expect(p.campaigns[0].adsets[0].ads.map(a => a.name)).toEqual(['Post 123_456', 'Creative X']);
  });
});

// ─── Issues (§5.5) ──────────────────────────────────────────────────────────

describe('issues', () => {
  it('blocks an empty pool', () => {
    expect(plan(cfg(1, 1, 'n'), []).issues).toContain('Pick at least one creative or post');
  });

  it('blocks more than 50 campaigns', () => {
    expect(plan(cfg('n', 1, 1), pool(51)).issues).toContain('51 campaigns: at most 50 per launch');
  });

  it('blocks more than 50 ad sets in a campaign', () => {
    expect(plan(cfg(1, 'n', 1), pool(51)).issues).toContain('51 ad sets in one campaign: at most 50 per campaign');
  });

  it('blocks more than 50 ads in an ad set', () => {
    expect(plan(cfg(1, 1, 'n'), pool(51)).issues).toContain('51 ads in one ad set: at most 50 per ad set');
  });

  it('blocks more than 200 ads in a campaign', () => {
    const p = plan(cfg(1, 5, 'n'), pool(41));
    expect(p.issues).toContain('205 ads in one campaign: at most 200 per campaign');
    expect(p.issues.some(i => i.includes('per ad set'))).toBe(false);
  });

  it('blocks a preset without audiences', () => {
    const p = plan(cfg(1, 1, 'n', true, c => { c.adset.audiences = []; }), pool(1));
    expect(p.issues).toContain('Ad set · audiences: Add at least one audience');
  });

  it('turns preset errors into readable lines', () => {
    const c = cfg(1, 1, 'n', true, x => { x.campaign.bidStrategy = 'COST_CAP'; });
    expect(configIssues(c)).toEqual(['Campaign · bidAmount: Set the amount for this bid strategy']);
    expect(plan(c, pool(1)).issues).toContain('Campaign · bidAmount: Set the amount for this bid strategy');
    const roas = cfg(1, 1, 'n', true, x => { x.campaign.bidStrategy = 'LOWEST_COST_WITH_MIN_ROAS'; x.campaign.roasGoal = '1.8'; });
    expect(configIssues(roas)).toEqual(['Ad set · optimizationGoal: ROAS goal needs the "Value" optimisation goal']);
    expect(configIssues(cfg(1, 1, 'n'))).toEqual([]);
  });

  describe('setupIssues', () => {
    const config = cfg(1, 1, 'n');
    const items = pool(1);
    it('passes a complete setup', () => {
      expect(setupIssues(SETUP, { config, items })).toEqual([]);
    });
    it('needs an account and a page, all ids numeric', () => {
      expect(setupIssues({ ...SETUP, adAccountId: '', pageId: '' }, { config, items })).toEqual(['Pick an ad account', 'Pick a Facebook page']);
      expect(setupIssues({ ...SETUP, adAccountId: 'act_1', pageId: 'abc', pixelId: 'p1' }, { config, items })).toEqual([
        'Ad account ID must be numeric',
        'Page ID must be numeric',
        'Pixel ID must be numeric'
      ]);
    });
    it('needs a pixel only for pixel goals, and not when adding to an existing ad set', () => {
      expect(setupIssues({ ...SETUP, pixelId: '' }, { config, items })).toEqual(['Pick a pixel: the "Conversions" optimisation goal needs one']);
      const clicks = cfg(1, 1, 'n', true, c => { c.adset.optimizationGoal = 'LINK_CLICKS'; });
      expect(setupIssues({ ...SETUP, pixelId: '' }, { config: clicks, items })).toEqual([]);
      expect(setupIssues({ ...SETUP, pixelId: '' }, { config, items, target: { mode: 'existing', campaignId: '1', adsetId: '2' } })).toEqual([]);
    });
    it('needs a valid landing page only when an ad comes from a creative', () => {
      expect(setupIssues({ ...SETUP, landingUrl: '' }, { config, items })).toEqual(['Pick a landing page']);
      expect(setupIssues({ ...SETUP, landingUrl: 'shop-a.com' }, { config, items })).toEqual(['The landing page URL is not a valid http(s) link']);
      expect(setupIssues({ ...SETUP, landingUrl: '' }, { config, items: [post('123_456')] })).toEqual([]);
    });
    it('caps URL parameters at 1024 characters', () => {
      expect(setupIssues({ ...SETUP, urlTags: 'x'.repeat(1025) }, { config, items })).toEqual(['URL parameters are too long (1025/1024 characters)']);
    });
  });

  describe('targetIssues', () => {
    const existing = (over: Partial<ExistingCampaign> = {}): ExistingCampaign => ({
      externalId: '120200000001',
      name: 'Comb | CBO | 05/10',
      status: 'ACTIVE',
      objective: 'OUTCOME_SALES',
      dailyBudget: '5000',
      lifetimeBudget: null,
      bidStrategy: 'COST_CAP',
      adsets: [{ externalId: '120200000002', name: 'Broad', status: 'ACTIVE', dailyBudget: null }],
      ...over
    });
    const one = plan(cfg(1, 1, 'n'), pool(2));

    it('has nothing to say about a new campaign', () => {
      expect(targetIssues({ mode: 'new' }, { plan: one, config: cfg(1, 1, 'n'), campaigns: [] })).toEqual([]);
    });
    it('needs the campaign picked and present', () => {
      expect(targetIssues({ mode: 'existing', campaignId: null }, { plan: one, config: null, campaigns: [] })).toEqual(['Pick the existing campaign']);
      expect(targetIssues({ mode: 'existing', campaignId: '9' }, { plan: one, config: null, campaigns: [existing()] })).toEqual([
        'The selected campaign is not in this ad account any more'
      ]);
    });
    it('allows one campaign only', () => {
      const p = plan(cfg(3, 1, 'n'), pool(1));
      const out = targetIssues({ mode: 'existing', campaignId: '120200000001' }, {
        plan: p,
        config: cfg(3, 1, 'n', true, c => { c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '25'; }),
        campaigns: [existing()]
      });
      expect(out).toEqual(['An existing campaign takes one campaign: this structure makes 3']);
    });
    it('allows one ad set only when adding to an existing ad set', () => {
      const p = plan(cfg(1, 2, 'n'), pool(1));
      expect(targetIssues({ mode: 'existing', campaignId: '120200000001', adsetId: '120200000002' }, { plan: p, config: cfg(1, 2, 'n'), campaigns: [existing()] })).toEqual([
        'An existing ad set takes one ad set: this structure makes 2'
      ]);
    });
    it('blocks a preset that bids differently from a cost-cap campaign', () => {
      expect(targetIssues({ mode: 'existing', campaignId: '120200000001' }, { plan: one, config: cfg(1, 1, 'n'), campaigns: [existing()] })).toEqual([
        'Comb | CBO | 05/10 bids with Cost per result goal: set the same bid strategy and its amount'
      ]);
      expect(targetIssues({ mode: 'existing', campaignId: '120200000001' }, {
        plan: one, config: cfg(1, 1, 'n'), campaigns: [existing({ bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS' })]
      })).toEqual(['Comb | CBO | 05/10 bids with ROAS goal: set the same bid strategy and its ROAS goal']);
    });
    it('passes when the strategies match, the strategy is unknown, or the campaign is ABO', () => {
      const costCap = cfg(1, 1, 'n', true, c => { c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '25'; });
      const target = { mode: 'existing' as const, campaignId: '120200000001' };
      expect(targetIssues(target, { plan: one, config: costCap, campaigns: [existing()] })).toEqual([]);
      expect(targetIssues(target, { plan: one, config: cfg(1, 1, 'n'), campaigns: [existing({ bidStrategy: null })] })).toEqual([]);
      expect(targetIssues(target, { plan: one, config: cfg(1, 1, 'n'), campaigns: [existing({ dailyBudget: null })] })).toEqual([]);
      expect(targetIssues(target, { plan: one, config: cfg(1, 1, 'n'), campaigns: [existing({ bidStrategy: 'LOWEST_COST_WITHOUT_CAP' })] })).toEqual([]);
    });
  });
});

// ─── Requests (§7.3, §8.4) ──────────────────────────────────────────────────

describe('buildStructureRequests', () => {
  const build = (config: LaunchPresetConfig, items: PoolItem[], extra: Partial<Parameters<typeof buildStructureRequests>[0]> = {}) =>
    buildStructureRequests({ plan: plan(config, items), config, setup: SETUP, ...extra });

  it('CBO, Highest volume: one request per campaign, ads on every ad set, budget on the campaign only', () => {
    const config = cfg(3, 1, 'n');
    const requests = build(config, pool(2));
    expect(requests).toHaveLength(3);
    expectAllValid(requests);
    const r = requests[0];
    expect(r.campaign).toEqual({ mode: 'new', name: 'COMB | CBO | 07/10 #1', objective: 'OUTCOME_SALES', dailyBudget: '50', bidStrategy: 'LOWEST_COST_WITHOUT_CAP', status: 'PAUSED' });
    const adset = r.adsets[0];
    expect(adset).toMatchObject({ mode: 'new', name: 'COMB | CBO | 07/10 #1 | Broad', optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE', pixelId: SETUP.pixelId, status: 'PAUSED' });
    expect(adset).not.toHaveProperty('dailyBudget');
    expect(adset).not.toHaveProperty('bidAmount');
    expect(adset).not.toHaveProperty('bidStrategy');
    expect(adset.mode === 'new' && adset.targeting).toEqual({ countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true });
    expect(adset.ads).toEqual([{ creativeId: uuid(1) }, { creativeId: uuid(2) }]);
    expect(r.destination).toEqual({ url: SETUP.landingUrl, displayLink: 'shop-a.com' });
    expect(r).toMatchObject({ adAccountId: SETUP.adAccountId, pageId: SETUP.pageId, pixelId: SETUP.pixelId, callToAction: 'SHOP_NOW', urlTags: SETUP.urlTags, adStatus: 'PAUSED', ads: [] });
  });

  it('CBO, Cost per result goal: the campaign holds the strategy, ad sets carry the amount (1:1:3 one creative)', () => {
    const config = cfg(1, 1, 3, true, c => { c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '25'; });
    const [r] = build(config, pool(1));
    expectAllValid([r]);
    expect(r.campaign).toMatchObject({ dailyBudget: '50', bidStrategy: 'COST_CAP' });
    expect(r.adsets[0]).toMatchObject({ bidAmount: '25' });
    expect(r.adsets[0]).not.toHaveProperty('bidStrategy');
    expect(r.adsets[0].ads).toEqual([{ creativeId: uuid(1) }, { creativeId: uuid(1) }, { creativeId: uuid(1) }]);
  });

  it('CBO, Bid cap', () => {
    const config = cfg(1, 'n', 1, true, c => { c.campaign.bidStrategy = 'LOWEST_COST_WITH_BID_CAP'; c.campaign.bidAmount = '3.50'; });
    const requests = build(config, pool(3));
    expectAllValid(requests);
    expect(requests[0].adsets.every(a => a.mode === 'new' && a.bidAmount === '3.50')).toBe(true);
  });

  it('ROAS goal: ad sets carry roasGoal with the VALUE goal, never a bid amount', () => {
    const config = cfg(1, 1, 'n', true, c => {
      c.campaign.bidStrategy = 'LOWEST_COST_WITH_MIN_ROAS';
      c.campaign.roasGoal = '1.8';
      c.adset.optimizationGoal = 'VALUE';
    });
    const [r] = build(config, pool(2));
    expectAllValid([r]);
    expect(r.campaign).toMatchObject({ bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS' });
    expect(r.adsets[0]).toMatchObject({ roasGoal: '1.8', optimizationGoal: 'VALUE' });
    expect(r.adsets[0]).not.toHaveProperty('bidAmount');
  });

  it('ABO: no campaign budget, each ad set brings budget and strategy', () => {
    const config = cfg(1, 'n', 1, true, c => { c.campaign.budgetMode = 'ABO'; c.campaign.dailyBudget = '20'; });
    const [r] = build(config, pool(3));
    expectAllValid([r]);
    expect(r.campaign).not.toHaveProperty('dailyBudget');
    expect(r.campaign).not.toHaveProperty('bidStrategy');
    expect(r.adsets).toHaveLength(3);
    for (const a of r.adsets) expect(a).toMatchObject({ dailyBudget: '20', bidStrategy: 'LOWEST_COST_WITHOUT_CAP' });
  });

  it('ABO with a cost cap puts the amount on each ad set', () => {
    const config = cfg(1, 'n', 2, true, c => { c.campaign.budgetMode = 'ABO'; c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '12.50'; });
    const [r] = build(config, pool(4));
    expectAllValid([r]);
    for (const a of r.adsets) expect(a).toMatchObject({ dailyBudget: '50', bidStrategy: 'COST_CAP', bidAmount: '12.50' });
  });

  it('ABO with ROAS goal', () => {
    const config = cfg(1, 2, 'n', true, c => {
      c.campaign.budgetMode = 'ABO';
      c.campaign.bidStrategy = 'LOWEST_COST_WITH_MIN_ROAS';
      c.campaign.roasGoal = '2';
      c.adset.optimizationGoal = 'VALUE';
    });
    const requests = build(config, pool(2));
    expectAllValid(requests);
    for (const a of requests[0].adsets) expect(a).toMatchObject({ bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS', roasGoal: '2' });
  });

  it('maps genders to Meta codes and copies the audience', () => {
    const config = cfg(1, 3, 'n', true, c => {
      c.adset.audiences = [
        { label: 'All', countries: ['US'], ageMin: 18, ageMax: 65, gender: 'all' },
        { label: 'Men', countries: ['GB', 'IE'], ageMin: 21, ageMax: 50, gender: 'men' },
        { label: 'Women', countries: ['US'], ageMin: 30, ageMax: 65, gender: 'women' }
      ];
      c.adset.advantagePlacements = false;
    });
    const [r] = build(config, pool(1));
    expectAllValid([r]);
    const targeting = r.adsets.map(a => (a.mode === 'new' ? a.targeting : null));
    expect(targeting.map(t => t?.genders)).toEqual([[], [1], [2]]);
    expect(targeting[1]).toEqual({ countries: ['GB', 'IE'], ageMin: 21, ageMax: 50, genders: [1], advantagePlacements: false });
  });

  it('sends copy overrides only when not blank', () => {
    const items = pool(2);
    const [r] = build(cfg(1, 1, 'n'), items, {
      copy: { [items[0].creativeId!]: { primaryText: 'New copy', headline: '   ', description: '' } }
    });
    expectAllValid([r]);
    expect(r.adsets[0].ads).toEqual([{ creativeId: uuid(1), primaryText: 'New copy' }, { creativeId: uuid(2) }]);
  });

  it('posts only: no destination, {postId, creativeId?}, never copy or link', () => {
    const items = [post('1000000001_555555555', uuid(9)), post('1000000001_666666666')];
    const requests = buildStructureRequests({
      plan: plan(cfg(1, 1, 'n'), items),
      config: cfg(1, 1, 'n'),
      setup: { ...SETUP, landingUrl: '', displayLink: '' },
      copy: { [uuid(9)]: { primaryText: 'ignored' } }
    });
    expectAllValid(requests);
    expect(requests[0]).not.toHaveProperty('destination');
    expect(requests[0].adsets[0].ads).toEqual([
      { postId: '1000000001_555555555', creativeId: uuid(9) },
      { postId: '1000000001_666666666' }
    ]);
  });

  it('mixed pool keeps the destination', () => {
    const items = [post('1000000001_555555555'), ...pool(1)];
    const [r] = build(cfg(1, 1, 'n'), items);
    expectAllValid([r]);
    expect(r.destination?.url).toBe(SETUP.landingUrl);
  });

  it('leaves out an empty display link and pixel', () => {
    const config = cfg(1, 1, 'n', true, c => { c.adset.optimizationGoal = 'LINK_CLICKS'; });
    const [r] = buildStructureRequests({ plan: plan(config, pool(1)), config, setup: { ...SETUP, displayLink: '', pixelId: '' } });
    expectAllValid([r]);
    expect(r.destination).toEqual({ url: SETUP.landingUrl });
    expect(r).not.toHaveProperty('pixelId');
    expect(r.adsets[0]).not.toHaveProperty('pixelId');
  });

  it('adds the start time to new ad sets', () => {
    const [r] = build(cfg(1, 1, 'n'), pool(1), { startTime: '2026-10-08T02:00:00.000Z' });
    expectAllValid([r]);
    expect(r.adsets[0]).toMatchObject({ startTime: '2026-10-08T02:00:00.000Z' });
  });

  describe('existing campaign', () => {
    const campaign = (over: Partial<ExistingCampaign> = {}): ExistingCampaign => ({
      externalId: '120200000001',
      name: 'Comb | CBO | 05/10',
      status: 'ACTIVE',
      objective: 'OUTCOME_SALES',
      dailyBudget: '5000',
      lifetimeBudget: null,
      bidStrategy: 'COST_CAP',
      adsets: [{ externalId: '120200000002', name: 'Broad', status: 'ACTIVE', dailyBudget: null }],
      ...over
    });

    it('CBO cost cap campaign + matching preset: new ad sets carry the amount, no budget', () => {
      const config = cfg(1, 2, 'n', true, c => { c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '25'; });
      const requests = build(config, pool(2), { target: { mode: 'existing', campaignId: '120200000001' }, existingCampaign: campaign() });
      expect(requests).toHaveLength(1);
      expectAllValid(requests);
      expect(requests[0].campaign).toEqual({ mode: 'existing', campaignId: '120200000001' });
      for (const a of requests[0].adsets) {
        expect(a).toMatchObject({ mode: 'new', bidAmount: '25' });
        expect(a).not.toHaveProperty('dailyBudget');
      }
    });

    it('CBO Highest volume campaign: ad sets carry no bid even if the preset has one', () => {
      const config = cfg(1, 1, 'n', true, c => { c.campaign.bidStrategy = 'COST_CAP'; c.campaign.bidAmount = '25'; });
      const [r] = build(config, pool(1), { target: { mode: 'existing', campaignId: '120200000001' }, existingCampaign: campaign({ bidStrategy: 'LOWEST_COST_WITHOUT_CAP' }) });
      expectAllValid([r]);
      expect(r.adsets[0]).not.toHaveProperty('bidAmount');
    });

    it('CBO campaign with unknown strategy: send what the preset carries', () => {
      const config = cfg(1, 1, 'n', true, c => { c.campaign.bidStrategy = 'LOWEST_COST_WITH_BID_CAP'; c.campaign.bidAmount = '4'; });
      const [r] = build(config, pool(1), { target: { mode: 'existing', campaignId: '120200000001' }, existingCampaign: campaign({ bidStrategy: null }) });
      expectAllValid([r]);
      expect(r.adsets[0]).toMatchObject({ bidAmount: '4' });
    });

    it('ABO campaign: ad sets bring budget and strategy like a new campaign', () => {
      const [r] = build(cfg(1, 1, 'n'), pool(1), { target: { mode: 'existing', campaignId: '120200000001' }, existingCampaign: campaign({ dailyBudget: null, bidStrategy: null }) });
      expectAllValid([r]);
      expect(r.adsets[0]).toMatchObject({ dailyBudget: '50', bidStrategy: 'LOWEST_COST_WITHOUT_CAP' });
    });

    it('existing ad set: one {mode: existing, adsetId, ads}', () => {
      const items = [...pool(2), post('1000000001_555555555')];
      const [r] = build(cfg(1, 1, 'n'), items, {
        target: { mode: 'existing', campaignId: '120200000001', adsetId: '120200000002' },
        existingCampaign: campaign()
      });
      expectAllValid([r]);
      expect(r.adsets).toEqual([{
        mode: 'existing',
        adsetId: '120200000002',
        ads: [{ creativeId: uuid(1) }, { creativeId: uuid(2) }, { postId: '1000000001_555555555' }]
      }]);
      expect(r.destination).toBeDefined();
    });
  });
});
