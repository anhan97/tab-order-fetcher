/**
 * FbMetaAdsWriter against a fake fetch: batches of 50, per-element errors,
 * null elements, a whole batch failing, and the breaker (§15.1 "Writer").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FbMetaAdsWriter } from '../src/ads-launcher/fb-meta-ads-writer';
import { MetaApiError, MetaUnavailableError } from '../src/ads-launcher/meta-ads-writer';
import * as breaker from '../src/ads-launcher/meta-breaker';

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; body: URLSearchParams | null }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    calls.push({ url, body });
    const r = handler(url, init);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (id: string) => ({ code: 200, body: JSON.stringify({ id }) });
const err = (message: string, code = 100) => ({ code: 400, body: JSON.stringify({ error: { message, code, error_user_msg: `${message} (user)` } }) });

beforeEach(() => breaker.reset());

describe('batch', () => {
  it('splits into chunks of 50 and lines results up with inputs', async () => {
    let n = 0;
    const { fn, calls } = fakeFetch((_url, init) => {
      const batch = JSON.parse((init!.body as URLSearchParams).get('batch')!);
      return { status: 200, body: batch.map(() => ok(String(++n))) };
    });
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    const items = Array.from({ length: 120 }, (_, i) => ({ name: `c${i}` }));
    const res = await w.createCreatives('123', items);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].body!.get('batch')!)).toHaveLength(50);
    expect(JSON.parse(calls[2].body!.get('batch')!)).toHaveLength(20);
    expect(calls[0].body!.get('include_headers')).toBe('false');
    const op = JSON.parse(calls[0].body!.get('batch')!)[0];
    expect(op).toEqual({ method: 'POST', relative_url: 'act_123/adcreatives', body: 'name=c0' });
    expect(res.map(r => r.id)).toEqual(Array.from({ length: 120 }, (_, i) => String(i + 1)));
  });

  it('one bad element fails only itself; null means Meta gave up', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: [ok('1'), err('Invalid image hash'), null] }));
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    const res = await w.createAds('123', [{}, {}, {}]);
    expect(res[0]).toEqual({ id: '1' });
    expect(res[1].error).toBe('Invalid image hash (user) (#100)');
    expect(res[2].error).toMatch(/did not finish/);
  });

  it('a whole failed request fails only its own chunk', async () => {
    let call = 0;
    const { fn } = fakeFetch((_url, init) => {
      call++;
      const batch = JSON.parse((init!.body as URLSearchParams).get('batch')!);
      if (call === 2) return { status: 500, body: 'oops' };
      return { status: 200, body: batch.map((_: unknown, i: number) => ok(`${call}-${i}`)) };
    });
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    const res = await w.createCreatives('1', Array.from({ length: 101 }, () => ({})));
    expect(res.slice(0, 50).every(r => r.id)).toBe(true);
    expect(res.slice(50, 100).every(r => r.error)).toBe(true);
    expect(res[100].id).toBe('3-0');
  });

  it('reads post ids per element', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: [
      { code: 200, body: JSON.stringify({ creative: { effective_object_story_id: '11_22' } }) },
      { code: 200, body: JSON.stringify({ creative: {} }) },
      err('nope')
    ] }));
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    const res = await w.readAdPostIds(['a', 'b', 'c']);
    expect(res[0]).toEqual({ postId: '11_22' });
    expect(res[1]).toEqual({ postId: null });
    expect(res[2].postId).toBeNull();
    expect(res[2].error).toBeTruthy();
  });
});

describe('transient errors, video polling, rate limits', () => {
  it('flags "try again later" / is_transient elements as transient, not permanent ones', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: [
      { code: 400, body: JSON.stringify({ error: { message: 'Invalid parameter', code: 100, error_subcode: 1487390, error_user_msg: 'The Adcreative Create Failed for the following reason: Something went wrong. Please try again later', fbtrace_id: 'AbC123' } }) },
      { code: 400, body: JSON.stringify({ error: { message: 'Invalid page', code: 100, error_subcode: 33 } }) },
      { code: 500, body: JSON.stringify({ error: { message: 'Unknown', code: 1, is_transient: true } }) }
    ] }));
    const res = await new FbMetaAdsWriter('tok', { fetch: fn }).createCreatives('1', [{}, {}, {}]);
    expect(res[0]).toMatchObject({ transient: true, error: expect.stringContaining('[trace AbC123]') });
    expect(res[1].transient).toBe(false);
    expect(res[2].transient).toBe(true);
  });

  it('asks about every pending video in one call', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: {
      v1: { status: { video_status: 'ready' } },
      v2: { status: { video_status: 'processing' } },
      v3: { status: { video_status: 'error', processing_phase: { error: { message: 'Bad codec' } } } }
    } }));
    const st = await new FbMetaAdsWriter('tok', { fetch: fn }).getVideoStatuses(['v1', 'v2', 'v3']);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get('ids')).toBe('v1,v2,v3');
    expect(st.get('v1')!.status).toBe('ready');
    expect(st.get('v2')!.status).toBe('processing');
    expect(st.get('v3')).toEqual({ status: 'error', detail: 'Bad codec' });
  });

  it('an ad account rate limit blocks only that ad account, and says how long', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 400, body: { error: { message: 'There have been too many calls from this ad-account. Please wait a bit and try again.', code: 17, error_subcode: 2446079 } } }));
    const busy = new FbMetaAdsWriter('tok-rl', { fetch: fn, adAccountId: '111' });
    await expect(busy.createCampaign('111', {})).rejects.toBeInstanceOf(MetaApiError);
    await expect(busy.createCampaign('111', {})).rejects.toThrow(/rate-limiting this ad account.*about \d+ min/);
    expect(calls).toHaveLength(1);
    // Same token, another ad account: still allowed.
    expect(() => new FbMetaAdsWriter('tok-rl', { fetch: fn, adAccountId: '222' }).assertAvailable()).not.toThrow();
  });
});

describe('pages', () => {
  it('unions linked, own, business-owned and client pages, follows paging, linked first', async () => {
    const { fn, calls } = fakeFetch(url => {
      const path = new URL(url).pathname;
      if (url.includes('cursor=2')) return { status: 200, body: { data: [{ id: '5', name: 'Zeta (page 2)' }] } };
      if (path.endsWith('/act_9')) return { status: 200, body: { id: 'act_9', business: { id: 'B1' } } };
      if (path.endsWith('/promote_pages')) return { status: 200, body: { data: [{ id: '1', name: 'Linked', instagram_business_account: { id: 'IG1' } }] } };
      if (path.endsWith('/me/accounts')) return { status: 200, body: { data: [{ id: '2', name: 'Mine' }, { id: '1', name: 'Linked' }] } };
      if (path.endsWith('/B1/owned_pages')) {
        return { status: 200, body: { data: [{ id: '3', name: 'Brand' }], paging: { next: 'https://graph.facebook.com/v23.0/B1/owned_pages?cursor=2&access_token=tok' } } };
      }
      if (path.endsWith('/B1/client_pages')) return { status: 200, body: { data: [{ id: '4', name: 'Client', instagram_business_account: { id: 'IG4' } }] } };
      return { status: 404, body: { error: { message: 'unexpected ' + path, code: 100 } } };
    });
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    const { pages, warnings } = await w.listPages('9');
    expect(warnings).toEqual([]);
    expect(pages.map(p => p.externalId)).toEqual(['1', '3', '4', '2', '5']);
    expect(pages[0]).toMatchObject({ linked: true, instagramUserId: 'IG1' });
    expect(pages.find(p => p.externalId === '4')).toMatchObject({ linked: false, instagramUserId: 'IG4' });
    expect(calls.some(c => c.url.includes('cursor=2'))).toBe(true);
  });

  it('a failing source becomes a warning, not an empty picker', async () => {
    const { fn } = fakeFetch(url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/act_9')) return { status: 200, body: { id: 'act_9' } }; // no business
      if (path.endsWith('/promote_pages')) return { status: 400, body: { error: { message: 'No permission', code: 200 } } };
      if (path.endsWith('/me/accounts')) return { status: 200, body: { data: [{ id: '2', name: 'Mine' }] } };
      return { status: 404, body: { error: { message: 'unexpected', code: 100 } } };
    });
    const { pages, warnings } = await new FbMetaAdsWriter('tok', { fetch: fn }).listPages('9');
    expect(pages.map(p => p.externalId)).toEqual(['2']);
    expect(warnings[0]).toMatch(/linked to the ad account/);
  });
});

describe('single calls + breaker', () => {
  it('posts form fields with objects as JSON', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { id: '99' } }));
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    expect(await w.createCampaign('5', { name: 'X', special_ad_categories: [] })).toEqual({ id: '99' });
    expect(calls[0].url).toMatch(/\/act_5\/campaigns$/);
    expect(calls[0].body!.get('special_ad_categories')).toBe('[]');
    expect(calls[0].body!.get('access_token')).toBe('tok');
  });

  it('surfaces Meta errors as MetaApiError with the user message', async () => {
    const { fn } = fakeFetch(() => ({ status: 400, body: { error: { message: 'Bad', code: 100, error_subcode: 33, error_user_msg: 'Explained' } } }));
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    await expect(w.createAdSet('5', {})).rejects.toMatchObject({ name: 'MetaApiError', message: 'Explained (#100/33)', code: 100 });
    expect(await w.getCampaign('1')).toBeNull(); // #100 → not found
  });

  it('expired token opens the breaker: no further network calls', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 400, body: { error: { message: 'Session expired', code: 190 } } }));
    const w = new FbMetaAdsWriter('tok-x', { fetch: fn });
    await expect(w.createCampaign('5', {})).rejects.toBeInstanceOf(MetaApiError);
    await expect(w.createCampaign('5', {})).rejects.toBeInstanceOf(MetaUnavailableError);
    expect(calls).toHaveLength(1);
    expect(() => new FbMetaAdsWriter('tok-x', { fetch: fn }).assertAvailable()).toThrow(MetaUnavailableError);
    expect(() => new FbMetaAdsWriter('other', { fetch: fn }).assertAvailable()).not.toThrow();
  });

  it('uploads images as base64 bytes and reads the hash', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { images: { 'a.jpg': { hash: 'HASH' } } } }));
    const w = new FbMetaAdsWriter('tok', { fetch: fn });
    expect(await w.uploadImage('5', { bytes: Buffer.from('abc'), name: 'a.jpg' })).toEqual({ hash: 'HASH' });
    expect(calls[0].body!.get('bytes')).toBe(Buffer.from('abc').toString('base64'));
  });
});
