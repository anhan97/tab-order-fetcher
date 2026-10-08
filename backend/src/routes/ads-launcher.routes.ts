/**
 * Ads Launcher API (docs/2026-10-07-dac-ta-ads-launcher.md §7).
 *
 *   GET  /api/ads-launcher/accounts              ad accounts the caller may launch into
 *   GET  /api/ads-launcher/options?adAccountId=  pages, pixels, existing campaigns
 *   GET  /api/ads-launcher/landing?productId=    landing pages grouped by store domain
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
import {
  type LauncherOptions,
  launchRequestSchema,
  postsQuerySchema,
  refreshPostsSchema
} from '../ads-launcher/contract';
import { DEMO_PAGE, DEMO_PIXEL, isDemoAccount } from '../ads-launcher/fake-meta-ads-writer';
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

router.get('/options', ...storeChain('manage'), handle(async (req, res) => {
  const adAccountId = digits(req.query.adAccountId);
  if (!adAccountId) return fail(res, 400, 'invalid_request', 'adAccountId is required');
  const caller = await callerOf(req);
  let writer;
  let isDemo: boolean;
  try {
    ({ writer, isDemo } = await resolveWriter(caller, adAccountId));
  } catch (e) {
    if (accessFail(res, e)) return;
    throw e;
  }

  const warnings: string[] = [];
  const settle = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      if (e instanceof MetaUnavailableError) throw e;
      warnings.push(`${label}: ${(e as Error).message}`);
      return fallback;
    }
  };

  try {
    const [account, pages, pixels, campaigns] = await Promise.all([
      settle('Ad account', writer.getAdAccount(adAccountId), { id: adAccountId, name: adAccountId, currency: null, accountStatus: null }),
      settle('Pages', writer.listPages(adAccountId), []),
      settle('Pixels', writer.listPixels(adAccountId), []),
      isDemo ? demoCampaigns(scopeOf(req).ownerId, adAccountId) : settle('Campaigns', writer.listCampaigns(adAccountId), [])
    ]);
    const data: LauncherOptions = {
      adAccount: { id: account.id || adAccountId, name: account.name, currency: account.currency, accountStatus: account.accountStatus, isDemo },
      pages: isDemo ? [DEMO_PAGE] : pages,
      pixels: isDemo ? [DEMO_PIXEL] : pixels,
      campaigns,
      warnings
    };
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
