import { describe, expect, it } from 'vitest';
import { hasLauncherParams, launcherLink, parseLauncherLink } from './deep-link';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

describe('launcher deep link', () => {
  it('parses creatives, posts, preset and account, dropping junk', () => {
    const p = parseLauncherLink(new URLSearchParams(`creatives=${A},nope,${B},${A}&posts=123_456,bad,789_012&preset=p1&account=act_900000000000001`));
    expect(p).toEqual({ creativeIds: [A, B], postIds: ['123_456', '789_012'], presetId: 'p1', accountId: '900000000000001' });
  });

  it('returns empties without params', () => {
    const empty = new URLSearchParams('');
    expect(parseLauncherLink(empty)).toEqual({ creativeIds: [], postIds: [], presetId: null, accountId: null });
    expect(hasLauncherParams(empty)).toBe(false);
    expect(hasLauncherParams(new URLSearchParams('posts=1_2'))).toBe(true);
  });

  it('builds a readable link and round-trips', () => {
    const url = launcherLink({ creativeIds: [A, B], postIds: ['123_456'], presetId: 'p1', accountId: '42' });
    expect(url).toBe(`/ads-launcher?creatives=${A},${B}&posts=123_456&preset=p1&account=42`);
    expect(parseLauncherLink(new URLSearchParams(url.split('?')[1]))).toEqual({ creativeIds: [A, B], postIds: ['123_456'], presetId: 'p1', accountId: '42' });
  });

  it('leaves out fallback starter presets and empty parts', () => {
    expect(launcherLink({ presetId: 'starter:cbo-all-in-one', creativeIds: [] })).toBe('/ads-launcher');
  });
});
