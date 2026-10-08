/**
 * `/ads-launcher?creatives=a,b&posts=123_456&preset=<id>&account=<id>` (§3.1).
 * Parameters only initialise the wizard; the page removes them once read.
 */
import { LIMITS, POST_ID_RE } from '@contract/ads-launcher';

export const LAUNCHER_PATH = '/ads-launcher';

export interface LauncherDeepLink {
  creativeIds: string[];
  postIds: string[];
  presetId: string | null;
  accountId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v: string | null) => [...new Set((v ?? '').split(',').map(s => s.trim()).filter(Boolean))];

export function parseLauncherLink(params: URLSearchParams): LauncherDeepLink {
  const account = (params.get('account') ?? '').trim().replace(/^act_/, '');
  const preset = (params.get('preset') ?? '').trim();
  return {
    creativeIds: list(params.get('creatives')).filter(id => UUID_RE.test(id)).slice(0, 200),
    postIds: list(params.get('posts')).filter(id => POST_ID_RE.test(id)).slice(0, LIMITS.postIdsPerLookup),
    presetId: preset && preset.length <= 100 ? preset : null,
    accountId: /^\d{1,30}$/.test(account) ? account : null
  };
}

export const hasLauncherParams = (params: URLSearchParams) =>
  ['creatives', 'posts', 'preset', 'account'].some(k => params.has(k));

export function launcherLink(link: Partial<LauncherDeepLink>): string {
  const sp = new URLSearchParams();
  if (link.creativeIds?.length) sp.set('creatives', link.creativeIds.join(','));
  if (link.postIds?.length) sp.set('posts', link.postIds.join(','));
  if (link.presetId && !link.presetId.startsWith('starter:')) sp.set('preset', link.presetId);
  if (link.accountId) sp.set('account', link.accountId);
  const qs = sp.toString().replace(/%2C/gi, ',');
  return qs ? `${LAUNCHER_PATH}?${qs}` : LAUNCHER_PATH;
}
