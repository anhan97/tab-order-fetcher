/**
 * Posts tab (§7.4) and "Refresh post IDs" (§7.5, §10.1).
 *
 * A post = every mirrored ad running the same effective_object_story_id.
 * Metrics come from the ad-level insight snapshots when this install syncs
 * them; money is summed as integer cents (BigInt), never as floats.
 */
import { Prisma } from '@prisma/client';
import {
  type PostRow,
  type PostsPage,
  type PostsQuery,
  type RefreshPostsResult,
  LIMITS,
  POST_ID_RE,
  postPermalink
} from './contract';
import type { MetaAdsWriter } from './meta-ads-writer';
import { publicPath } from './media-storage';
import { prisma } from './prisma-launch-repo';
import type { StoreScope } from './creatives.service';

const RANGE_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, lifetime: null };

/**
 * Today in the system time zone (APP_TIMEZONE, else the server's), as the
 * UTC-midnight Date the insight snapshots use for "that day".
 */
export function todayAsUtcDay(now: Date = new Date(), timeZone = process.env.APP_TIMEZONE || undefined): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "12.34" → 1234n; tolerant of Prisma Decimal / numbers. */
function toCents(v: unknown): bigint {
  const s = String(v ?? '0');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return 0n;
  const cents = BigInt(m[2]) * 100n + BigInt(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -cents : cents;
}

const centsToString = (c: bigint) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;

function adFilters(scope: StoreScope, q: { adAccountId?: string; productId?: string; creativeId?: string }): Prisma.MetaAdWhereInput {
  return {
    ownerId: scope.ownerId,
    storeId: scope.storeId,
    deletedAt: null,
    ...(q.adAccountId ? { adAccountId: q.adAccountId } : {}),
    ...(q.creativeId ? { creativeId: q.creativeId } : {}),
    ...(q.productId ? { creative: { productId: q.productId } } : {})
  };
}

export async function listPosts(scope: StoreScope, q: PostsQuery): Promise<PostsPage> {
  const where: Prisma.MetaAdWhereInput = {
    ...adFilters(scope, q),
    postId: q.postIds ? { in: q.postIds } : { not: null },
    ...(q.source === 'library' ? { creativeId: { not: null } } : {}),
    ...(q.q
      ? {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { postId: { contains: q.q } },
          { title: { contains: q.q, mode: 'insensitive' } },
          { body: { contains: q.q, mode: 'insensitive' } },
          { creative: { name: { contains: q.q, mode: 'insensitive' } } },
          { creative: { angle: { contains: q.q, mode: 'insensitive' } } }
        ]
      }
      : {})
  };

  const [ads, missingPostIds] = await Promise.all([
    prisma.metaAd.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: {
        creative: { select: { id: true, name: true, angle: true, productId: true, productTitle: true, productCode: true, productImageUrl: true, mediaType: true, posterPath: true, mediaPath: true } },
        adset: { select: { campaign: { select: { name: true } } } }
      }
    }),
    prisma.metaAd.count({ where: { ...adFilters(scope, q), postId: null } })
  ]);

  // Metrics per ad from synced ad-level snapshots, if any.
  const days = RANGE_DAYS[q.range];
  const to = todayAsUtcDay();
  const from = days ? new Date(to.getTime() - (days - 1) * 86_400_000) : null;
  const metricRows = ads.length === 0 ? [] : await prisma.facebookAdInsightSnapshot.groupBy({
    by: ['entityId'],
    where: { level: 'ad', entityId: { in: ads.map(a => a.externalId) }, ...(from ? { date: { gte: from } } : {}) },
    _sum: { spend: true, impressions: true, clicks: true, purchases: true, purchaseValue: true }
  }).catch(() => []);
  const metricsByAd = new Map(metricRows.map(r => [r.entityId, r._sum]));

  const accountIds = [...new Set(ads.map(a => a.adAccountId))];
  const currencies = accountIds.length === 0 ? [] : await prisma.$queryRaw<Array<{ accountId: string; currency: string | null }>>`
    SELECT "accountId", "currency" FROM "FacebookAdAccountAssignment" WHERE "accountId" IN (${Prisma.join(accountIds)})
  `.catch(() => []);
  const currencyByAccount = new Map(currencies.map(c => [c.accountId, c.currency]));

  interface Acc {
    rows: typeof ads;
    spend: bigint; revenue: bigint; impressions: bigint; clicks: bigint; purchases: number;
  }
  const groups = new Map<string, Acc>();
  for (const ad of ads) {
    const g = groups.get(ad.postId!) ?? { rows: [], spend: 0n, revenue: 0n, impressions: 0n, clicks: 0n, purchases: 0 };
    g.rows.push(ad);
    const m = metricsByAd.get(ad.externalId);
    if (m) {
      g.spend += toCents(m.spend);
      g.revenue += toCents(m.purchaseValue);
      g.impressions += BigInt(m.impressions ?? 0);
      g.clicks += BigInt(m.clicks ?? 0);
      g.purchases += m.purchases ?? 0;
    }
    groups.set(ad.postId!, g);
  }

  let items: PostRow[] = [...groups.entries()].map(([postId, g]) => {
    const newest = g.rows[0]; // rows are newest first
    const oldest = g.rows[g.rows.length - 1];
    const withCreative = g.rows.find(r => r.creative);
    const c = withCreative?.creative ?? null;
    const accounts = [...new Set(g.rows.map(r => r.adAccountId))];
    const accountCurrencies = [...new Set(accounts.map(a => currencyByAccount.get(a) ?? null))];
    const thumb = c ? (c.posterPath ? publicPath(c.posterPath) : c.mediaType === 'image' ? publicPath(c.mediaPath) : null) : null;
    return {
      postId,
      pageId: postId.split('_')[0],
      pageName: null,
      permalink: postPermalink(postId),
      thumbnailUrl: thumb ?? newest.thumbnailUrl ?? newest.imageUrl ?? null,
      isVideo: c?.mediaType === 'video',
      headline: newest.title,
      primaryText: newest.body,
      link: newest.link,
      creative: c ? { id: c.id, name: c.name, angle: c.angle } : null,
      product: c ? { id: c.productId, title: c.productTitle, code: c.productCode, imageUrl: c.productImageUrl } : null,
      ads: g.rows.length,
      activeAds: g.rows.filter(r => r.status === 'ACTIVE').length,
      adAccounts: accounts,
      lastAd: { id: newest.externalId, name: newest.name, campaignName: newest.adset?.campaign?.name ?? null, effectiveStatus: newest.status },
      firstUsedAt: oldest.createdAt.toISOString(),
      lastUsedAt: newest.createdAt.toISOString(),
      currency: accountCurrencies.length === 1 ? accountCurrencies[0] : null,
      metrics: {
        spend: centsToString(g.spend),
        impressions: Number(g.impressions),
        clicks: Number(g.clicks),
        purchases: g.purchases,
        revenue: centsToString(g.revenue),
        roas: g.spend > 0n ? Number(g.revenue) / Number(g.spend) : null,
        cpa: g.purchases > 0 ? centsToString(g.spend / BigInt(g.purchases)) : null
      }
    };
  });

  if (q.status === 'active') items = items.filter(p => p.activeAds > 0);
  const cmp: Record<string, (a: PostRow, b: PostRow) => number> = {
    spend: (a, b) => Number(toCents(b.metrics.spend) - toCents(a.metrics.spend)),
    purchases: (a, b) => b.metrics.purchases - a.metrics.purchases,
    roas: (a, b) => (b.metrics.roas ?? -1) - (a.metrics.roas ?? -1),
    recent: () => 0
  };
  items.sort((a, b) => cmp[q.sort](a, b) || b.lastUsedAt.localeCompare(a.lastUsedAt));

  const total = items.length;
  const start = (q.page - 1) * q.pageSize;
  return {
    items: items.slice(start, start + q.pageSize),
    total,
    hasMore: start + q.pageSize < total,
    range: { from: from ? from.toISOString().slice(0, 10) : null, to: to.toISOString().slice(0, 10) },
    missingPostIds
  };
}

// ─── Refresh post IDs (§10.1) ───────────────────────────────────────────────

export type WriterFor = (adAccountId: string) => Promise<MetaAdsWriter>;

export async function refreshPostIds(
  scope: StoreScope,
  q: { adAccountId?: string; productId?: string; creativeId?: string },
  writerFor: WriterFor,
  accountName: (adAccountId: string) => string = id => id
): Promise<RefreshPostsResult> {
  const recheckBefore = new Date(Date.now() - LIMITS.postRecheckHours * 3_600_000);
  const candidateWhere: Prisma.MetaAdWhereInput = {
    ...adFilters(scope, q),
    postId: null,
    OR: [{ postCheckedAt: null }, { postCheckedAt: { lt: recheckBefore } }]
  };
  const candidates = await prisma.metaAd.findMany({
    where: candidateWhere,
    orderBy: { createdAt: 'desc' },
    take: LIMITS.refreshAdsPerRun,
    select: { id: true, externalId: true, adAccountId: true }
  });

  const byAccount = new Map<string, typeof candidates>();
  for (const c of candidates) byAccount.set(c.adAccountId, [...(byAccount.get(c.adAccountId) ?? []), c]);

  let checked = 0;
  let found = 0;
  const failures: RefreshPostsResult['failures'] = [];
  for (const [adAccountId, ads] of byAccount) {
    let writer: MetaAdsWriter;
    try {
      writer = await writerFor(adAccountId);
    } catch (e) {
      failures.push({ adAccountId, name: accountName(adAccountId), error: (e as Error).message });
      continue;
    }
    let results: Array<{ postId: string | null; error?: string }>;
    try {
      results = await writer.readAdPostIds(ads.map(a => a.externalId));
    } catch (e) {
      failures.push({ adAccountId, name: accountName(adAccountId), error: (e as Error).message });
      continue;
    }
    const now = new Date();
    for (let i = 0; i < ads.length; i++) {
      const postId = results[i]?.postId;
      const valid = !!postId && postId.length <= 100 && POST_ID_RE.test(postId);
      // Every ad asked gets stamped, post or not, so the next run moves on.
      await prisma.metaAd.update({
        where: { id: ads[i].id },
        data: { postCheckedAt: now, ...(valid ? { postId } : {}) }
      });
      checked++;
      if (valid) found++;
    }
  }
  const remaining = await prisma.metaAd.count({ where: candidateWhere });
  return { checked, found, remaining, failures };
}
