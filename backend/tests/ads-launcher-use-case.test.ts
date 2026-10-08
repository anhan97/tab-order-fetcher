/**
 * LaunchAds with the fake writer and an in-memory repo (§15.1 "Use case"):
 * creative sharing, launch cache, partial failures, mirror failures as
 * warnings, scope, name numbering, post id read-back, bid rules.
 */
import { describe, it, expect } from 'vitest';
import { launchRequestSchema, type LaunchRequest } from '../src/ads-launcher/contract';
import { FakeMetaAdsWriter, type FakeWriterOptions } from '../src/ads-launcher/fake-meta-ads-writer';
import { launchAssetCache } from '../src/ads-launcher/launch-state';
import { MetaUnavailableError } from '../src/ads-launcher/meta-ads-writer';
import {
  type AdMirror,
  type CreativeRecord,
  type LaunchDeps,
  type LaunchRepo,
  LaunchError,
  launchAds
} from '../src/ads-launcher/launch-ads.use-case';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C3 = '33333333-3333-4333-8333-333333333333';
const ARCHIVED = '44444444-4444-4444-8444-444444444444';
const OTHER_STORE = '55555555-5555-4555-8555-555555555555';
const VIDEO = '66666666-6666-4666-8666-666666666666';

const creative = (id: string, over: Partial<CreativeRecord> = {}): CreativeRecord => ({
  id,
  name: `Me | angle ${id.slice(0, 1)} | CODE - 07/10/2026`,
  status: 'active',
  primaryText: `Body ${id.slice(0, 1)}`,
  headline: `Head ${id.slice(0, 1)}`,
  description: null,
  mediaType: 'image',
  mediaPath: `creatives/s1/${id}.jpg`,
  posterPath: null,
  thumbUrl: `/api/media/creatives/s1/${id}.jpg`,
  mediaUrl: `/api/media/creatives/s1/${id}.jpg`,
  ...over
});

function memoryRepo(opts: { failAdMirror?: (r: AdMirror) => boolean; failCampaignMirror?: boolean } = {}) {
  const library = new Map<string, CreativeRecord & { storeId: string }>([
    [C1, { ...creative(C1), storeId: 's1' }],
    [C2, { ...creative(C2), storeId: 's1' }],
    [C3, { ...creative(C3), storeId: 's1' }],
    [ARCHIVED, { ...creative(ARCHIVED, { status: 'archived' }), storeId: 's1' }],
    [OTHER_STORE, { ...creative(OTHER_STORE), storeId: 's2' }],
    [VIDEO, { ...creative(VIDEO, { mediaType: 'video', mediaPath: 'creatives/s1/v.mp4', posterPath: 'creatives/s1/v.poster.jpg' }), storeId: 's1' }]
  ]);
  const campaigns = new Map<string, any>();
  const adsets = new Map<string, any>();
  const ads = new Map<string, AdMirror & { id: string }>();
  let seq = 0;
  const repo: LaunchRepo = {
    async loadCreatives(ids, scope) {
      return ids.map(id => library.get(id)).filter(c => c && c.storeId === scope.storeId) as CreativeRecord[];
    },
    async findCampaign(_o, externalId) {
      const c = campaigns.get(externalId);
      return c ? { id: c.id, adAccountId: c.adAccountId, name: c.name, dailyBudget: c.dailyBudget, bidStrategy: c.bidStrategy, raw: c.raw } : null;
    },
    async upsertCampaign(r) {
      if (opts.failCampaignMirror) throw new Error('db down');
      const id = campaigns.get(r.externalId)?.id ?? `mc${++seq}`;
      campaigns.set(r.externalId, { ...r, id });
      return { id };
    },
    async findAdset(_o, externalId) {
      const a = adsets.get(externalId);
      return a ? { id: a.id, campaignExternalId: a.campaignExternalId, name: a.name } : null;
    },
    async upsertAdset(r) {
      const camp = [...campaigns.values()].find(c => c.id === r.campaignId);
      const id = adsets.get(r.externalId)?.id ?? `ma${++seq}`;
      adsets.set(r.externalId, { ...r, id, campaignExternalId: camp?.externalId });
      return { id };
    },
    async upsertAd(r) {
      if (opts.failAdMirror?.(r)) throw new Error('db down');
      const id = `ad${++seq}`;
      ads.set(r.externalId, { ...r, id });
      return { id };
    },
    async latestAdForPost() {
      return { title: 'Old title', body: 'Old body', thumbnailUrl: 'https://x/t.jpg', imageUrl: null, link: 'https://old' };
    }
  };
  return { repo, campaigns, adsets, ads };
}

const media = { readBytes: async (p: string) => Buffer.from(p), publicUrl: () => null };

function deps(writerOpts: FakeWriterOptions = {}, repoOpts = {}, extra: Partial<LaunchDeps> = {}) {
  const writer = new FakeMetaAdsWriter({ isolated: true, ...writerOpts });
  const mem = memoryRepo(repoOpts);
  const silent = { error: () => undefined, warn: () => undefined };
  return {
    writer,
    mem,
    deps: { writer, repo: mem.repo, media, scope: { ownerId: 'o1', storeId: 's1', actorId: 'u1' }, isDemo: true, videoPoll: { attempts: 3, intervalMs: 0 }, log: silent, ...extra } as LaunchDeps
  };
}

let reqSeq = 0;
function request(over: Record<string, unknown> = {}, adsets?: unknown[]): LaunchRequest {
  return launchRequestSchema.parse({
    adAccountId: '900000000000001',
    pageId: '900000000000101',
    pixelId: '900000000000201',
    campaign: { mode: 'new', name: 'COMB | CBO | 07/10', objective: 'OUTCOME_SALES', dailyBudget: '50', status: 'PAUSED' },
    adsets: adsets ?? [{
      mode: 'new', name: 'COMB | Broad', optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE',
      targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true }, status: 'PAUSED',
      ads: [{ creativeId: C1 }, { creativeId: C2 }]
    }],
    destination: { url: 'https://shop-a.com/products/comb', displayLink: 'shop-a.com' },
    callToAction: 'SHOP_NOW',
    adStatus: 'PAUSED',
    requestId: `7b0c1c9e-8a43-4d36-9e37-${String(++reqSeq).padStart(12, '0')}`,
    ...over
  });
}

const newAdset = (name: string, ads: unknown[], over: Record<string, unknown> = {}) => ({
  mode: 'new', name, optimizationGoal: 'OFFSITE_CONVERSIONS', conversionEvent: 'PURCHASE',
  targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true }, status: 'PAUSED', ads, ...over
});

describe('LaunchAds', () => {
  it('creates campaign → ad set → ads and mirrors them', async () => {
    const { writer, mem, deps: d } = deps();
    const r = await launchAds(request(), d);
    expect(r.campaign.status).toBe('ok');
    expect(r.summary).toEqual({ adsCreated: 2, adsFailed: 0, adsetsCreated: 1, campaignCreated: true });
    expect(writer.count('createCampaign')).toBe(1);
    expect(writer.count('uploadImage')).toBe(2);
    expect(writer.count('createCreatives')).toBe(1);
    expect(writer.count('createAds')).toBe(1);
    expect(mem.ads.size).toBe(2);
    const ad = [...mem.ads.values()][0];
    expect(ad).toMatchObject({ creativeId: C1, link: 'https://shop-a.com/products/comb', displayLink: 'shop-a.com', title: 'Head 1', body: 'Body 1', status: 'PAUSED' });
    expect(ad.postId).toMatch(/^900000000000101_\d+$/);
    expect(r.adsets[0].ads[0].postId).toBe(ad.postId);
    expect([...mem.campaigns.values()][0].raw).toMatchObject({ launched_by: 'ads-launcher', demo: true, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' });
  });

  it('1:1:3 with one creative + cost cap 25: three numbered ads share ONE Meta creative', async () => {
    const { writer, deps: d } = deps();
    const r = await launchAds(request(
      { campaign: { mode: 'new', name: 'C', objective: 'OUTCOME_SALES', dailyBudget: '50', bidStrategy: 'COST_CAP', status: 'PAUSED' } },
      [newAdset('AS', [{ creativeId: C1 }, { creativeId: C1 }, { creativeId: C1 }], { bidAmount: '25' })]
    ), d);
    expect(r.adsets[0].ads.map(a => a.name)).toEqual([
      'Me | angle 1 | CODE - 07/10/2026 #1', 'Me | angle 1 | CODE - 07/10/2026 #2', 'Me | angle 1 | CODE - 07/10/2026 #3'
    ]);
    const createCreatives = writer.calls.find(c => c.op === 'createCreatives')!;
    expect((createCreatives.payload as unknown[]).length).toBe(1);
    expect(writer.count('uploadImage')).toBe(1);
    const campaign = writer.calls.find(c => c.op === 'createCampaign')!.payload as any;
    expect(campaign.bid_strategy).toBe('COST_CAP');
    expect((writer.calls.find(c => c.op === 'createAdSet')!.payload as any).bid_amount).toBe('2500');
  });

  it('Instagram account of the page goes on every creative', async () => {
    const { writer, deps: d } = deps();
    await launchAds(request({ instagramUserId: '900000000000301' }), d);
    const items = writer.calls.find(c => c.op === 'createCreatives')!.payload as any[];
    expect(items.every(i => i.object_story_spec.instagram_user_id === '900000000000301')).toBe(true);
  });

  it('targeting audiences and interests reach the ad set', async () => {
    const { writer, deps: d } = deps();
    await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }], {
      targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [], advantagePlacements: true, customAudienceIds: ['900000000000402'], excludedAudienceIds: ['900000000000401'], interestIds: ['6003107902433'] }
    })]), d);
    const t = (writer.calls.find(c => c.op === 'createAdSet')!.payload as any).targeting;
    expect(t).toMatchObject({
      custom_audiences: [{ id: '900000000000402' }],
      excluded_custom_audiences: [{ id: '900000000000401' }],
      flexible_spec: [{ interests: [{ id: '6003107902433' }] }]
    });
  });

  it('ROAS goal 1.8: VALUE + roas_average_floor 18000', async () => {
    const { writer, deps: d } = deps();
    await launchAds(request(
      { campaign: { mode: 'new', name: 'C', objective: 'OUTCOME_SALES', dailyBudget: '50', bidStrategy: 'LOWEST_COST_WITH_MIN_ROAS', status: 'PAUSED' } },
      [newAdset('AS', [{ creativeId: C1 }], { roasGoal: '1.8', optimizationGoal: 'VALUE' })]
    ), d);
    const adset = writer.calls.find(c => c.op === 'createAdSet')!.payload as any;
    expect(adset.optimization_goal).toBe('VALUE');
    expect(adset.bid_constraints).toEqual({ roas_average_floor: 18000 });
    expect(adset.bid_amount).toBeUndefined();
  });

  it('same creative in several ad sets → one upload, one Meta creative', async () => {
    const { writer, deps: d } = deps();
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }]), newAdset('B', [{ creativeId: C1 }]), newAdset('C', [{ creativeId: C1 }])]), d);
    expect(r.summary.adsCreated).toBe(3);
    expect(writer.count('uploadImage')).toBe(1);
    expect((writer.calls.find(c => c.op === 'createCreatives')!.payload as unknown[]).length).toBe(1);
    expect(writer.count('createAds')).toBe(3);
  });

  it('copy override → its own Meta creative', async () => {
    const { writer, deps: d } = deps();
    await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }, { creativeId: C1, primaryText: 'Other copy' }])]), d);
    const items = writer.calls.find(c => c.op === 'createCreatives')!.payload as any[];
    expect(items).toHaveLength(2);
    expect(items[1].object_story_spec.link_data.message).toBe('Other copy');
    expect(writer.count('uploadImage')).toBe(1);
  });

  it('launch cache: the 2nd campaign of a launch skips upload and creative creation', async () => {
    const { writer, deps: d } = deps();
    const cache = launchAssetCache('o1', '9b0c1c9e-8a43-4d36-9e37-000000000001');
    await launchAds(request({ launchId: '9b0c1c9e-8a43-4d36-9e37-000000000001' }), { ...d, cache });
    const before = { up: writer.count('uploadImage'), cr: writer.count('createCreatives') };
    const r = await launchAds(request({ launchId: '9b0c1c9e-8a43-4d36-9e37-000000000001' }), { ...d, cache });
    expect(r.summary.adsCreated).toBe(2);
    expect(writer.count('uploadImage')).toBe(before.up);
    expect(writer.count('createCreatives')).toBe(before.cr);
    expect(writer.count('createCampaign')).toBe(2);
  });

  it('a cache that throws only costs an upload', async () => {
    const { deps: d } = deps();
    const broken = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } };
    const r = await launchAds(request(), { ...d, cache: broken });
    expect(r.summary.adsCreated).toBe(2);
  });

  it('one failing Meta creative fails only the ads that need it', async () => {
    const { deps: d } = deps({ failCreative: f => ((f.object_story_spec as any)?.link_data?.message === 'Body 2' ? 'Image too small' : null) });
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }, { creativeId: C2 }, { creativeId: C3 }])]), d);
    expect(r.adsets[0].ads.map(a => a.status)).toEqual(['ok', 'failed', 'ok']);
    expect(r.adsets[0].ads[1].error).toBe('Image too small');
    expect(r.summary).toMatchObject({ adsCreated: 2, adsFailed: 1 });
  });

  it('one failing ad in a batch fails only itself', async () => {
    let n = 0;
    const { deps: d } = deps({ failAd: () => (++n === 2 ? 'Ad rejected' : null) });
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }, { creativeId: C2 }, { creativeId: C3 }])]), d);
    expect(r.adsets[0].ads.map(a => a.status)).toEqual(['ok', 'failed', 'ok']);
  });

  it('an upload failure fails only that creative\'s ads', async () => {
    const { deps: d } = deps({ failUpload: name => (name.includes(C2) ? 'Upload refused' : null) });
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: C1 }, { creativeId: C2 }])]), d);
    expect(r.adsets[0].ads[1]).toMatchObject({ status: 'failed', error: 'Upload failed: Upload refused' });
    expect(r.adsets[0].ads[0].status).toBe('ok');
  });

  it('mirror failure after Meta created the ad → ok + warning, never failed', async () => {
    const { deps: d } = deps({}, { failAdMirror: (r: AdMirror) => r.creativeId === C2 });
    const r = await launchAds(request(), d);
    expect(r.adsets[0].ads[1]).toMatchObject({ status: 'ok', warning: expect.stringMatching(/not saved locally/) });
    expect(r.adsets[0].ads[1].externalId).toBeTruthy();
    expect(r.summary.adsCreated).toBe(2);
  });

  it('campaign mirror failure → warning on campaign and children, all still ok', async () => {
    const { deps: d } = deps({}, { failCampaignMirror: true });
    const r = await launchAds(request(), d);
    expect(r.campaign).toMatchObject({ status: 'ok', warning: expect.any(String) });
    expect(r.adsets[0].status).toBe('ok');
    expect(r.adsets[0].ads.every(a => a.status === 'ok' && a.warning)).toBe(true);
  });

  it('Meta outage AFTER the campaign exists → items fail, request still answers (no retry → no duplicate)', async () => {
    const { deps: d } = deps();
    const outage = new MetaUnavailableError('Meta is unavailable for this Facebook connection', 60_000);
    d.writer.createAdSet = async () => { throw outage; };
    const r = await launchAds(request(), d);
    expect(r.campaign.status).toBe('ok');
    expect(r.summary.campaignCreated).toBe(true);
    expect(r.adsets[0]).toMatchObject({ status: 'failed', error: outage.message });
  });

  it('Meta outage BEFORE anything exists → thrown (route answers 502)', async () => {
    const { deps: d } = deps();
    d.writer.createCampaign = async () => { throw new MetaUnavailableError('down', 60_000); };
    await expect(launchAds(request(), d)).rejects.toBeInstanceOf(MetaUnavailableError);
  });

  it('campaign failure → everything below skipped', async () => {
    const { writer, deps: d } = deps({ failCampaign: () => 'Account disabled' });
    const r = await launchAds(request(), d);
    expect(r.campaign).toMatchObject({ status: 'failed', error: 'Account disabled' });
    expect(r.adsets[0].status).toBe('skipped');
    expect(r.adsets[0].ads.every(a => a.status === 'skipped')).toBe(true);
    expect(r.summary).toEqual({ adsCreated: 0, adsFailed: 2, adsetsCreated: 0, campaignCreated: false });
    expect(writer.count('uploadImage')).toBe(0);
  });

  it('one failing ad set does not stop its siblings', async () => {
    const { deps: d } = deps({ failAdset: f => (f.name === 'Bad' ? 'Targeting too narrow' : null) });
    const r = await launchAds(request({}, [newAdset('Bad', [{ creativeId: C1 }]), newAdset('Good', [{ creativeId: C2 }])]), d);
    expect(r.adsets[0]).toMatchObject({ status: 'failed', error: 'Targeting too narrow' });
    expect(r.adsets[0].ads[0].status).toBe('skipped');
    expect(r.adsets[1].status).toBe('ok');
    expect(r.summary.adsetsCreated).toBe(1);
  });

  it('ABO ad set without budget fails with a reason (existing ABO campaign)', async () => {
    const { writer, deps: d } = deps();
    const abo = await writer.createCampaign('900000000000001', { name: 'Old ABO', status: 'PAUSED' });
    const r = await launchAds(request({ campaign: { mode: 'existing', campaignId: abo.id } }, [
      newAdset('NoBudget', [{ creativeId: C1 }]),
      newAdset('WithBudget', [{ creativeId: C1 }], { dailyBudget: '20' })
    ]), d);
    expect(r.adsets[0]).toMatchObject({ status: 'failed', error: 'ABO ad sets need a daily budget' });
    expect(r.adsets[1].status).toBe('ok');
    expect(r.summary.campaignCreated).toBe(false);
  });

  it('existing cost-cap campaign: ad set without amount fails, with amount passes', async () => {
    const { writer, deps: d } = deps();
    const cc = await writer.createCampaign('900000000000001', { name: 'CC', status: 'PAUSED', daily_budget: '5000', bid_strategy: 'COST_CAP' });
    const r = await launchAds(request({ campaign: { mode: 'existing', campaignId: cc.id } }, [
      newAdset('A', [{ creativeId: C1 }]),
      newAdset('B', [{ creativeId: C1 }], { bidAmount: '12' })
    ]), d);
    expect(r.adsets[0].status).toBe('failed');
    expect(r.adsets[0].error).toMatch(/bid amount/);
    expect(r.adsets[1].status).toBe('ok');
    const sent = writer.calls.filter(c => c.op === 'createAdSet').map(c => c.payload as any);
    expect(sent.at(-1).bid_amount).toBe('1200');
  });

  it('existing campaign in another account → campaign failed', async () => {
    const { writer, deps: d } = deps();
    const other = await writer.createCampaign('777', { name: 'X', status: 'PAUSED' });
    const r = await launchAds(request({ campaign: { mode: 'existing', campaignId: other.id } }), d);
    expect(r.campaign.status).toBe('failed');
  });

  it('existing ad set: ads go into it, nothing new created', async () => {
    const { writer, deps: d } = deps();
    const camp = await writer.createCampaign('900000000000001', { name: 'Camp', status: 'PAUSED', daily_budget: '5000' });
    const as = await writer.createAdSet('900000000000001', { name: 'Old set', campaign_id: camp.id, status: 'PAUSED' });
    const r = await launchAds(request({ campaign: { mode: 'existing', campaignId: camp.id } }, [{ mode: 'existing', adsetId: as.id, ads: [{ creativeId: C1 }] }]), d);
    expect(r.adsets[0]).toMatchObject({ status: 'ok', name: 'Old set', externalId: as.id });
    expect(r.summary).toMatchObject({ adsCreated: 1, adsetsCreated: 0, campaignCreated: false });
  });

  it('old post: no upload, object_story_id creative, link to its creative kept, text borrowed', async () => {
    const { writer, mem, deps: d } = deps();
    const r = await launchAds(request({ destination: undefined }, [newAdset('A', [
      { postId: '900000000000101_555555555', creativeId: C1 },
      { postId: '900000000000101_555555555', creativeId: C1 }
    ])]), d);
    expect(writer.count('uploadImage')).toBe(0);
    const items = writer.calls.find(c => c.op === 'createCreatives')!.payload as any[];
    expect(items).toEqual([{ name: 'Me | angle 1 | CODE - 07/10/2026 #1', object_story_id: '900000000000101_555555555', url_tags: expect.any(String) }]);
    expect(r.adsets[0].ads.map(a => a.postId)).toEqual(['900000000000101_555555555', '900000000000101_555555555']);
    const ad = [...mem.ads.values()][0];
    expect(ad).toMatchObject({ creativeId: C1, postId: '900000000000101_555555555', title: 'Old title', link: 'https://old' });
  });

  it('post whose linked creative is out of scope still runs, link dropped', async () => {
    const { mem, deps: d } = deps();
    const r = await launchAds(request({ destination: undefined }, [newAdset('A', [{ postId: '900000000000101_555', creativeId: OTHER_STORE }])]), d);
    expect(r.adsets[0].ads[0]).toMatchObject({ status: 'ok', name: 'Post 900000000000101_555' });
    expect([...mem.ads.values()][0].creativeId).toBeNull();
  });

  it('scope: creative of another store → 404, nothing created', async () => {
    const { writer, deps: d } = deps();
    await expect(launchAds(request({}, [newAdset('A', [{ creativeId: OTHER_STORE }])]), d)).rejects.toMatchObject({ status: 404, code: 'creative_not_found' });
    expect(writer.calls).toHaveLength(0);
  });

  it('archived creative → 404 with restore hint', async () => {
    const { deps: d } = deps();
    const e = await launchAds(request({}, [newAdset('A', [{ creativeId: ARCHIVED }])]), d).catch(x => x);
    expect(e).toBeInstanceOf(LaunchError);
    expect(e.message).toMatch(/restore it in the library/);
  });

  it('video: waits for processing, uploads the poster as thumbnail', async () => {
    const { writer, deps: d } = deps({ videoStatuses: ['processing', 'ready'] });
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: VIDEO }])]), d);
    expect(r.summary.adsCreated).toBe(1);
    expect(writer.count('getVideoStatus')).toBe(2);
    expect(writer.count('uploadImage')).toBe(1);
    const item = (writer.calls.find(c => c.op === 'createCreatives')!.payload as any[])[0];
    expect(item.object_story_spec.video_data).toMatchObject({ title: 'Head 6', message: 'Body 6', image_hash: expect.stringMatching(/^fakehash/) });
  });

  it('video processing error fails only its ads', async () => {
    const { deps: d } = deps({ videoStatuses: ['error'] });
    const r = await launchAds(request({}, [newAdset('A', [{ creativeId: VIDEO }, { creativeId: C1 }])]), d);
    expect(r.adsets[0].ads[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not process the video/) });
    expect(r.adsets[0].ads[1].status).toBe('ok');
  });
});
