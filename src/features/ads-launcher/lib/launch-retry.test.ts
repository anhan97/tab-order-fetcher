import { describe, it, expect } from 'vitest';
import { launchRequestSchema, type LaunchRequest, type LaunchResult } from '@contract/ads-launcher';
import { mergeRetry, retryJobs, summarizeRun, type LaunchRunEntry } from './launch-run';

const C = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const adset = (name: string, ads: LaunchRequest['ads']) => ({
  mode: 'new' as const, name, optimizationGoal: 'OFFSITE_CONVERSIONS' as const, conversionEvent: 'PURCHASE' as const,
  targeting: { countries: ['US'], ageMin: 18, ageMax: 65, genders: [] as Array<1 | 2>, advantagePlacements: true },
  status: 'PAUSED' as const, ads
});

const request: LaunchRequest = launchRequestSchema.parse({
  adAccountId: '111',
  pageId: '222',
  campaign: { mode: 'new', name: 'Camp', objective: 'OUTCOME_SALES', dailyBudget: '50', status: 'PAUSED' },
  adsets: [adset('A', [{ creativeId: C(1) }, { creativeId: C(2) }, { creativeId: C(3) }]), adset('B', [{ creativeId: C(4) }])],
  destination: { url: 'https://shop.example/p' },
  callToAction: 'SHOP_NOW',
  adStatus: 'PAUSED',
  requestId: '10000000-0000-4000-8000-000000000000',
  launchId: '20000000-0000-4000-8000-000000000000'
});

const okResult = (over: Partial<LaunchResult> = {}): LaunchResult => ({
  campaign: { status: 'ok', externalId: '900', name: 'Camp' },
  adsets: [
    {
      status: 'ok', externalId: '901', name: 'A',
      ads: [
        { status: 'failed', name: 'X #1', creativeId: C(1), error: 'Something went wrong. Please try again later' },
        { status: 'ok', name: 'X #2', externalId: '9012', creativeId: C(2) },
        { status: 'failed', name: 'X #3', creativeId: C(3), error: 'Something went wrong' }
      ]
    },
    { status: 'failed', name: 'B', error: 'Targeting too narrow', ads: [{ status: 'skipped', name: 'Y', creativeId: C(4) }] }
  ],
  summary: { adsCreated: 1, adsFailed: 3, adsetsCreated: 1, campaignCreated: true },
  ...over
});

let ids = 0;
const newId = () => `30000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

describe('retryJobs', () => {
  it('campaign exists: only failed ads into the existing ad set (names kept), uncreated ad set again whole', () => {
    const [job] = retryJobs([{ index: 0, request, result: okResult(), error: null }], newId);
    expect(job.mode).toBe('merge');
    expect(job.request.campaign).toEqual({ mode: 'existing', campaignId: '900' });
    expect(job.request.requestId).not.toBe(request.requestId);
    expect(job.request.adsets[0]).toEqual({ mode: 'existing', adsetId: '901', ads: [{ creativeId: C(1), name: 'X #1' }, { creativeId: C(3), name: 'X #3' }] });
    expect(job.request.adsets[1]).toMatchObject({ mode: 'new', name: 'B', ads: [{ creativeId: C(4) }] });
    expect(job.targets).toEqual([{ adsetIndex: 0, adIndexes: [0, 2] }, { adsetIndex: 1, adIndexes: null }]);
    // Still a valid request for the API.
    expect(launchRequestSchema.safeParse(job.request).success).toBe(true);
  });

  it('a request that errored goes again with the SAME requestId (server replays if it had finished)', () => {
    const [job] = retryJobs([{ index: 0, request, result: null, error: 'Network error' }], newId);
    expect(job).toMatchObject({ mode: 'replace', request: { requestId: request.requestId } });
  });

  it('a campaign that was not created goes again whole with a new requestId', () => {
    const failedCampaign = okResult({ campaign: { status: 'failed', name: 'Camp', error: 'Account disabled' } });
    const [job] = retryJobs([{ index: 0, request, result: failedCampaign, error: null }], newId);
    expect(job.mode).toBe('replace');
    expect(job.request.campaign).toEqual(request.campaign);
    expect(job.request.requestId).not.toBe(request.requestId);
  });

  it('nothing failed → nothing to retry', () => {
    const allOk = okResult({
      adsets: [{ status: 'ok', externalId: '901', name: 'A', ads: [{ status: 'ok', name: 'X', externalId: '1' }] }]
    });
    expect(retryJobs([{ index: 0, request, result: allOk, error: null }], newId)).toEqual([]);
  });
});

describe('mergeRetry', () => {
  it('folds retried ads and ad sets back in place and recounts', () => {
    const entry: LaunchRunEntry = { index: 0, request, result: okResult(), error: null };
    const [job] = retryJobs([entry], newId);
    const merged = mergeRetry(entry, job, {
      error: null,
      result: {
        campaign: { status: 'ok', externalId: '900', name: 'Camp' },
        adsets: [
          { status: 'ok', externalId: '901', name: 'A', ads: [{ status: 'ok', name: 'X #1', externalId: '9011' }, { status: 'failed', name: 'X #3', error: 'Still failing' }] },
          { status: 'ok', externalId: '902', name: 'B', ads: [{ status: 'ok', name: 'Y', externalId: '9021' }] }
        ],
        summary: { adsCreated: 2, adsFailed: 1, adsetsCreated: 1, campaignCreated: false }
      }
    });
    const a = merged.result!.adsets[0].ads;
    expect(a.map(x => x.status)).toEqual(['ok', 'ok', 'failed']);
    expect(a[2].error).toBe('Still failing');
    expect(merged.result!.adsets[1]).toMatchObject({ status: 'ok', externalId: '902' });
    expect(merged.result!.summary).toEqual({ adsCreated: 3, adsFailed: 1, adsetsCreated: 2, campaignCreated: true });
    expect(summarizeRun([merged])).toMatchObject({ ok: 3, failed: 1 });
  });

  it('a retry request that failed outright keeps the ads failed with its reason', () => {
    const entry: LaunchRunEntry = { index: 0, request, result: okResult(), error: null };
    const [job] = retryJobs([entry], newId);
    const merged = mergeRetry(entry, job, { result: null, error: 'Meta is rate-limiting this ad account' });
    expect(merged.result!.adsets[0].ads[0]).toMatchObject({ status: 'failed', error: 'Meta is rate-limiting this ad account' });
    expect(merged.result!.adsets[0].ads[1].status).toBe('ok');
  });
});
