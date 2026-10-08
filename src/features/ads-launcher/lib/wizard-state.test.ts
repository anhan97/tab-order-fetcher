import { describe, expect, it } from 'vitest';
import { DEFAULT_URL_TAGS, STARTER_PRESETS, type CreativeDto, type LaunchPresetConfig, type LaunchResult, type PostRow } from '@contract/ads-launcher';
import { barePostItem, creativeToPoolItem, mergePool, parsePostIds, poolProduct, postToPoolItem } from './pool';
import { initialWizardState, memoryOf, wizardReducer, type WizardState } from './wizard-state';
import { runToastTitle, summarizeRun, type LaunchRunEntry } from './launch-run';
import { minorToMajor, formatMoney } from './format';

const creativeDto = (id: string, productId = 'p1'): CreativeDto => ({
  id,
  storeId: 's',
  productId,
  productTitle: 'Comb',
  productCode: 'COMB',
  productHandle: 'comb',
  name: `Creative ${id}`,
  angle: 'Angle',
  primaryText: null,
  headline: 'Hi',
  description: null,
  status: 'active',
  mediaType: 'image',
  mediaUrl: `https://cdn/${id}.webp`,
  thumbUrl: null,
  width: null,
  height: null,
  createdBy: 'u',
  creatorName: 'Me',
  createdAt: '2026-10-01T00:00:00Z',
  adsCount: 0
});

const postRow = (postId: string): PostRow => ({
  postId,
  pageId: postId.split('_')[0],
  pageName: 'Page',
  permalink: 'https://facebook.com/x',
  thumbnailUrl: null,
  isVideo: true,
  headline: 'H',
  primaryText: 'P',
  link: null,
  creative: { id: 'c-uuid', name: 'Creative X', angle: 'A' },
  product: { id: 'p2', title: 'Brush', code: 'BR', imageUrl: null },
  ads: 1,
  activeAds: 1,
  adAccounts: [],
  lastAd: null,
  firstUsedAt: '',
  lastUsedAt: '',
  currency: 'USD',
  metrics: { spend: '0', impressions: 0, clicks: 0, purchases: 0, revenue: '0', roas: null, cpa: null }
});

const config = (): LaunchPresetConfig => JSON.parse(JSON.stringify(STARTER_PRESETS[2].config));

describe('pool', () => {
  it('turns creatives and posts into keyed items', () => {
    expect(creativeToPoolItem(creativeDto('a'))).toMatchObject({ key: 'a', kind: 'creative', creativeId: 'a', thumbUrl: 'https://cdn/a.webp' });
    expect(postToPoolItem(postRow('123_456'))).toMatchObject({ key: 'post:123_456', kind: 'post', creativeId: 'c-uuid', name: 'Creative X', mediaType: 'video' });
    expect(barePostItem('123_456')).toMatchObject({ key: 'post:123_456', name: 'Post 123_456', creativeId: null });
  });
  it('parses pasted post IDs', () => {
    expect(parsePostIds('123_456, 123_456\n789_012 nope 1_2')).toEqual({ valid: ['123_456', '789_012'], invalid: ['nope', '1_2'] });
  });
  it('merges without duplicates and infers the product from the first item that knows it', () => {
    const a = creativeToPoolItem(creativeDto('a'));
    const merged = mergePool([barePostItem('123_456')], [a, a]);
    expect(merged.map(i => i.key)).toEqual(['post:123_456', 'a']);
    expect(poolProduct(merged)).toEqual({ id: 'p1', title: 'Comb', code: 'COMB' });
    expect(poolProduct([])).toBeNull();
  });
});

describe('wizardReducer', () => {
  const s0 = initialWizardState({ adAccountId: '1', urlTags: 'x=1', presetId: 'p' });

  it('starts from the remembered setup with Meta url tags as default', () => {
    expect(s0.setup).toMatchObject({ adAccountId: '1', urlTags: 'x=1' });
    expect(s0.presetId).toBe('p');
    expect(initialWizardState().setup.urlTags).toBe(DEFAULT_URL_TAGS);
  });

  it('toggles pool items in selection order and prunes overrides', () => {
    const a = creativeToPoolItem(creativeDto('a'));
    const b = creativeToPoolItem(creativeDto('b'));
    let s: WizardState = wizardReducer(s0, { type: 'pool/toggle', item: b });
    s = wizardReducer(s, { type: 'pool/toggle', item: a });
    expect(s.pool.map(i => i.key)).toEqual(['b', 'a']);
    s = wizardReducer(s, { type: 'override', key: '0:0', itemKeys: ['a', 'b'] });
    s = wizardReducer(s, { type: 'pool/toggle', item: b });
    expect(s.pool.map(i => i.key)).toEqual(['a']);
    expect(s.overrides).toEqual({ '0:0': ['a'] });
    s = wizardReducer(s, { type: 'pool/remove', key: 'a' });
    expect(s.overrides).toEqual({});
  });

  it('clears overrides when the structure changes, marks edits as modified', () => {
    let s = wizardReducer(s0, { type: 'preset', presetId: 'p', config: config() });
    expect(s.dirty).toBe(false);
    s = wizardReducer(s, { type: 'override', key: '0:1', itemKeys: ['x'] });
    s = wizardReducer(s, { type: 'config', config: { ...s.config!, campaign: { ...s.config!.campaign, dailyBudget: '99' } } });
    expect(s.dirty).toBe(true);
    expect(s.overrides).toEqual({ '0:1': ['x'] });
    s = wizardReducer(s, { type: 'config', config: { ...s.config!, structure: { ...s.config!.structure, adsPerAdset: 2 } } });
    expect(s.overrides).toEqual({});
  });

  it('needs a confirmation for ACTIVE', () => {
    let s = wizardReducer(s0, { type: 'preset', presetId: 'p', config: config() });
    s = wizardReducer(s, { type: 'status', status: 'ACTIVE', confirmed: true });
    expect(s.config!.status).toBe('ACTIVE');
    expect(s.activeConfirmed).toBe(true);
    s = wizardReducer(s, { type: 'status', status: 'PAUSED' });
    expect(s.activeConfirmed).toBe(false);
  });

  it('changing the account drops the existing campaign target', () => {
    let s = wizardReducer(s0, { type: 'target', target: { mode: 'existing', campaignId: '5' } });
    s = wizardReducer(s, { type: 'account', adAccountId: '2' });
    expect(s.target).toEqual({ mode: 'new' });
    expect(s.setup.adAccountId).toBe('2');
  });

  it('"Launch more" keeps setup and preset, starts a new pool', () => {
    let s = wizardReducer(s0, { type: 'preset', presetId: 'p', config: config() });
    s = wizardReducer(s, { type: 'pool/add', items: [creativeToPoolItem(creativeDto('a'))] });
    s = wizardReducer(s, { type: 'copy', creativeId: 'a', patch: { headline: 'New' } });
    s = wizardReducer(s, { type: 'launchMore' });
    expect(s.pool).toEqual([]);
    expect(s.copy).toEqual({});
    expect(s.setup.adAccountId).toBe('1');
    expect(s.config).not.toBeNull();
    expect(s.step).toBe(1);
  });

  it('remembers only the setup fields', () => {
    expect(Object.keys(memoryOf(s0)).sort()).toEqual(['adAccountId', 'displayLink', 'pageId', 'pixelId', 'presetId', 'storeId', 'urlTags']);
  });
});

describe('launch run summary', () => {
  const result = (adsCreated: number, adsFailed: number, campaignFailed = false): LaunchResult => ({
    campaign: { status: campaignFailed ? 'failed' : 'ok', name: 'C' },
    adsets: [],
    summary: { adsCreated, adsFailed, adsetsCreated: 1, campaignCreated: !campaignFailed }
  });
  const entry = (r: LaunchResult | null, error: string | null = null): LaunchRunEntry => ({ index: 0, request: {} as never, result: r, error });

  it('sums created and failed ads plus whole failures', () => {
    const t = summarizeRun([entry(result(3, 1)), entry(null, 'Boom'), entry(result(0, 0, true))]);
    expect(t).toEqual({ ok: 3, failed: 3, campaignsCreated: 1, adsetsCreated: 2 });
    expect(runToastTitle(t)).toBe('3 launched, 3 failed');
    expect(runToastTitle(summarizeRun([entry(result(4, 0))]))).toBe('4 ads launched');
  });
});

describe('format', () => {
  it('converts minor units with strings', () => {
    expect(minorToMajor('5000')).toBe('50.00');
    expect(minorToMajor('7')).toBe('0.07');
    expect(minorToMajor(null)).toBeNull();
    expect(formatMoney('12.5', 'USD')).toBe('$12.50');
  });
});
