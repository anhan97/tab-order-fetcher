/**
 * Ads Launcher API (docs/2026-10-07-dac-ta-ads-launcher.md §7).
 *
 *   GET  /api/ads-launcher/accounts              ad accounts the caller may launch into
 *   GET  /api/ads-launcher/options?adAccountId=  pages, pixels, existing campaigns
 *   GET  /api/ads-launcher/landing?productId=    landing pages grouped by store domain
 *   GET  /api/ads-launcher/interests?adAccountId=&q=  detailed-targeting interest search
 *   GET  /api/ads-launcher/history               campaigns the launcher created
 *   POST /api/ads-launcher/launch                one campaign per request
 *   GET  /api/ads-launcher/posts                 posts the launcher's ads run
 *   POST /api/ads-launcher/posts/refresh         ask Meta for missing post ids
 *
 * "ads_launcher.use" maps to the store's `manage` capability (owner/manager),
 * the same gate the existing campaign builder uses; admins may use any ad
 * account (`ads_manager.view_all_users`).
 */
import express, { type Request, type Response } from 'express';
import { listAccessibleStores } from '../lib/store-access';
import { z } from 'zod';
import {
  type LaunchHistoryPage,
  type LaunchHistoryRow,
  type LauncherOptions,
  creatorDisplayName,
  launchRequestSchema,
  postsQuerySchema,
  refreshPostsSchema
} from '../ads-launcher/contract';
import { DEMO_PIXEL, isDemoAccount } from '../ads-launcher/fake-meta-ads-writer';
import { callerOf, fail, handle, ok, scopeOf, storeChain, zodFail } from '../ads-launcher/http';
import { LaunchError, launchAds, noCache } from '../ads-launcher/launch-ads.use-case';
import { idempotencyKey, launchAssetCache, prismaIdempotency } from '../ads-launcher/launch-state';
import { diskMediaSource } from '../ads-launcher/media-storage';
import { MetaUnavailableError, knownBidStrategy } from '../ads-launcher/meta-ads-writer';
import { listPosts, refreshPostIds } from '../ads-launcher/posts.service';
import { prisma, prismaLaunchRepo } from '../ads-launcher/prisma-launch-repo';
import { landingFor } from '../ads-launcher/shopify-catalog';
import { AccessError, listLauncherAccounts, resolveWriter } from '../ads-launcher/token-owner';

const router = express.Router();
const idempotency = prismaIdempotency(prisma);
const repo = prismaLaunchRepo(prisma);

function accessFail(res: Response, e: unknown): boolean {
  if (e instanceof AccessError) {
    fail(res, e.status, e.code, e.message);
    return true;
  }
  if (e instanceof MetaUnavailableError) {
    fail(res, 502, 'meta_unavailable', e.message);
    return true;
  }
  return false;
}

const digits = (v: unknown) => (typeof v === 'string' && /^\d{1,30}$/.test(v.replace(/^act_/, '')) ? v.replace(/^act_/, '') : null);

router.get('/accounts', ...storeChain('manage'), handle(async (req, res) => {
  ok(res, { items: await listLauncherAccounts(await callerOf(req)) });
}));

/**
 * Options cost ~8-10 Meta calls (account, 4 page sources with paging,
 * pixels, campaigns + ad sets, audiences). Opening the wizard, the quick
 * launch dialog or switching tabs must not spend that every time — that is
 * how an ad account hits Meta's rate limit (#17/2446079). Pages, pixels and
 * audiences barely change: 10 min. Campaigns: 2 min, dropped after a launch.
 * A load that came back with warnings is kept only 1 min. `?refresh=1` skips it.
 */
const STATIC_TTL_MS = 10 * 60_000;
const CAMPAIGNS_TTL_MS = 2 * 60_000;
const PARTIAL_TTL_MS = 60_000;
interface CachedOptions {
  base: Omit<LauncherOptions, 'campaigns' | 'warnings'>;
  baseWarnings: string[];
  baseAt: number;
  campaigns: LauncherOptions['campaigns'] | null;
  campaignWarnings: string[];
  campaignsAt: number;
}
const optionsCache = new Map<string, CachedOptions>();
const fresh = (at: number, ttl: number, warnings: string[]) => Date.now() - at < (warnings.length ? Math.min(ttl, PARTIAL_TTL_MS) : ttl);

/** After a launch the account's campaign list is stale for everyone. */
function forgetCampaigns(adAccountId: string): void {
  for (const [key, entry] of optionsCache) if (key.endsWith(`:${adAccountId}`)) entry.campaigns = null;
}

router.get('/options', ...storeChain('manage'), handle(async (req, res) => {
  const adAccountId = digits(req.query.adAccountId);
  if (!adAccountId) return fail(res, 400, 'invalid_request', 'adAccountId is required');
  const refresh = req.query.refresh === '1';
  const caller = await callerOf(req);
  let writer;
  let isDemo: boolean;
  try {
    ({ writer, isDemo } = await resolveWriter(caller, adAccountId));
  } catch (e) {
    if (accessFail(res, e)) return;
    throw e;
  }

  const settle = async <T>(warnings: string[], label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      if (e instanceof MetaUnavailableError) throw e;
      warnings.push(`${label}: ${(e as Error).message}`);
      return fallback;
    }
  };

  const key = `${caller.actorId}:${caller.ownerId}:${adAccountId}`;
  const hit = refresh ? undefined : optionsCache.get(key);
  const entry: CachedOptions = hit ?? { base: null as never, baseWarnings: [], baseAt: 0, campaigns: null, campaignWarnings: [], campaignsAt: 0 };

  try {
    const needBase = !hit || !fresh(entry.baseAt, STATIC_TTL_MS, entry.baseWarnings);
    const needCampaigns = isDemo || !hit || !entry.campaigns || !fresh(entry.campaignsAt, CAMPAIGNS_TTL_MS, entry.campaignWarnings);
    await Promise.all([
      needBase && (async () => {
        const warnings: string[] = [];
        const [account, pageList, pixels, audiences] = await Promise.all([
          settle(warnings, 'Ad account', writer.getAdAccount(adAccountId), { id: adAccountId, name: adAccountId, currency: null, accountStatus: null }),
          settle(warnings, 'Pages', writer.listPages(adAccountId), { pages: [], warnings: [] }),
          settle(warnings, 'Pixels', writer.listPixels(adAccountId), []),
          settle(warnings, 'Audiences', writer.listCustomAudiences(adAccountId), [])
        ]);
        warnings.push(...pageList.warnings);
        entry.base = {
          adAccount: { id: account.id || adAccountId, name: account.name, currency: account.currency, accountStatus: account.accountStatus, isDemo },
          pages: pageList.pages,
          pixels: isDemo ? [DEMO_PIXEL] : pixels,
          audiences
        };
        entry.baseWarnings = warnings;
        entry.baseAt = Date.now();
      })(),
      needCampaigns && (async () => {
        const warnings: string[] = [];
        entry.campaigns = isDemo
          ? await demoCampaigns(scopeOf(req).ownerId, adAccountId)
          : await settle(warnings, 'Campaigns', writer.listCampaigns(adAccountId), []);
        entry.campaignWarnings = warnings;
        entry.campaignsAt = Date.now();
      })()
    ]);
    optionsCache.set(key, entry);
    const data: LauncherOptions = { ...entry.base, campaigns: entry.campaigns ?? [], warnings: [...entry.baseWarnings, ...entry.campaignWarnings] };
    ok(res, data);
  } catch (e) {
    if (accessFail(res, e)) return;
    throw e;
  }
}));

/** Demo campaigns live only in the mirror (the fake writer forgets on restart). */
async function demoCampaigns(ownerId: string, adAccountId: string): Promise<LauncherOptions['campaigns']> {
  const rows = await prisma.metaCampaign.findMany({
    where: { ownerId, adAccountId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { adsets: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } }
  });
  return rows.map(c => ({
    externalId: c.externalId,
    name: c.name,
    status: c.status,
    objective: c.objective,
    dailyBudget: c.dailyBudget,
    lifetimeBudget: null,
    bidStrategy: knownBidStrategy((c.raw as any)?.bid_strategy ?? c.bidStrategy),
    adsets: c.adsets.map(a => ({ externalId: a.externalId, name: a.name, status: a.status, dailyBudget: a.dailyBudget }))
  }));
}

router.get('/interests', ...storeChain('manage'), handle(async (req, res) => {
  const adAccountId = digits(req.query.adAccountId);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!adAccountId) return fail(res, 400, 'invalid_request', 'adAccountId is required');
  if (q.length < 2) return ok(res, { items: [] });
  try {
    const { writer } = await resolveWriter(await callerOf(req), adAccountId);
    ok(res, { items: await writer.searchInterests(q) });
  } catch (e) {
    if (accessFail(res, e)) return;
    throw e;
  }
}));

const historyQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

/** Campaigns the launcher created in this store, newest first. */
router.get('/history', ...storeChain('manage'), handle(async (req, res) => {
  const parsed = historyQuery.safeParse(req.query);
  if (!parsed.success) return zodFail(res, parsed.error);
  const { page, pageSize } = parsed.data;
  const scope = scopeOf(req);
  const where = {
    ownerId: scope.ownerId,
    storeId: scope.storeId,
    deletedAt: null,
    raw: { path: ['launched_by'], equals: 'ads-launcher' }
  };
  const [rows, total] = await Promise.all([
    prisma.metaCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { adsets: { where: { deletedAt: null }, select: { _count: { select: { ads: { where: { deletedAt: null } } } } } } }
    }),
    prisma.metaCampaign.count({ where })
  ]);
  const actorIds = [...new Set(rows.map(r => (r.raw as any)?.actor_id).filter((v): v is string => typeof v === 'string'))];
  const users = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
    : [];
  const names = new Map(users.map(u => [u.id, creatorDisplayName(u)]));
  const items: LaunchHistoryRow[] = rows.map(r => {
    const raw = (r.raw ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      externalId: r.externalId,
      name: r.name,
      adAccountId: r.adAccountId,
      isDemo: raw.demo === true || isDemoAccount(r.adAccountId),
      status: r.status,
      objective: r.objective,
      dailyBudget: r.dailyBudget,
      bidStrategy: r.bidStrategy,
      adsets: r.adsets.length,
      ads: r.adsets.reduce((n, a) => n + a._count.ads, 0),
      launchedBy: typeof raw.actor_id === 'string' ? names.get(raw.actor_id) ?? null : null,
      createdAt: r.createdAt.toISOString()
    };
  });
  const data: LaunchHistoryPage = { items, total, hasMore: page * pageSize < total };
  ok(res, data);
}));

router.get('/landing', ...storeChain('manage'), handle(async (req, res) => {
  const productId = typeof req.query.productId === 'string' && /^\d{1,40}$/.test(req.query.productId) ? req.query.productId : null;
  if (!productId) return fail(res, 400, 'invalid_request', 'productId is required');
  const scope = scopeOf(req);
  const known = await prisma.adCreative.findFirst({
    where: { storeId: scope.storeId, productId, productHandle: { not: null } },
    select: { productHandle: true },
    orderBy: { createdAt: 'desc' }
  });
  const otherStores = (await listAccessibleStores(scope.actorId)).map(s => ({ id: s.id, storeDomain: s.storeDomain, accessToken: s.accessToken, name: s.name }));
  const items = await landingFor({ activeStoreId: scope.storeId, productId, knownHandle: known?.productHandle, otherStores });
  ok(res, { items });
}));

router.post('/launch', ...storeChain('manage'), handle(async (req: Request, res: Response) => {
  const parsed = launchRequestSchema.safeParse(req.body);
  if (!parsed.success) return zodFail(res, parsed.error);
  const request = parsed.data;
  const scope = scopeOf(req);
  const caller = await callerOf(req);

  let writer;
  let isDemo: boolean;
  try {
    ({ writer, isDemo } = await resolveWriter(caller, request.adAccountId));
  } catch (e) {
    if (accessFail(res, e)) return;
    throw e;
  }

  const key = idempotencyKey(scope.ownerId, request.requestId);
  const claim = await idempotency.claim(key);
  if (claim.state === 'done') {
    return ok(res, claim.result, claim.result.campaign.status === 'ok' ? 201 : 200);
  }
  if (claim.state === 'running') {
    return fail(res, 409, 'launch_in_progress', 'This launch request is already running');
  }

  try {
    const result = await launchAds(request, {
      writer,
      repo,
      media: diskMediaSource,
      cache: request.launchId ? launchAssetCache(scope.ownerId, request.launchId) : noCache,
      scope,
      isDemo
    });
    await idempotency.complete(key, result);
    if (result.summary.campaignCreated || result.summary.adsetsCreated > 0) forgetCampaigns(request.adAccountId);
    ok(res, result, result.campaign.status === 'ok' ? 201 : 200);
  } catch (e) {
    // Let a corrected retry through instead of answering 409 for a day.
    await idempotency.release(key);
    if (e instanceof LaunchError) return fail(res, e.status, e.code, e.message, e.details);
    if (accessFail(res, e)) return;
    throw e;
  }
}));

router.get('/posts', ...storeChain('read'), handle(async (req, res) => {
  const parsed = postsQuerySchema.safeParse(req.query);
  if (!parsed.success) return zodFail(res, parsed.error);
  ok(res, await listPosts(scopeOf(req), parsed.data));
}));

router.post('/posts/refresh', ...storeChain('manage'), handle(async (req, res) => {
  const parsed = refreshPostsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodFail(res, parsed.error);
  const caller = await callerOf(req);
  const accounts = await listLauncherAccounts(caller).catch(() => []);
  const names = new Map(accounts.map(a => [a.id, a.name]));
  const result = await refreshPostIds(
    scopeOf(req),
    parsed.data,
    async adAccountId => (await resolveWriter(caller, adAccountId)).writer,
    id => names.get(id) ?? (isDemoAccount(id) ? 'Demo account' : id)
  );
  ok(res, result);
}));

export default router;
