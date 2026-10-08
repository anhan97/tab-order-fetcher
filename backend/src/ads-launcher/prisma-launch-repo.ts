/**
 * Prisma adapter for LaunchRepo. Mirrors upsert on (ownerId, externalId) so a
 * later sync merges into the same rows instead of creating duplicates.
 */
import { PrismaClient, Prisma, type AdCreative } from '@prisma/client';
import type { CreativeRecord, LaunchRepo } from './launch-ads.use-case';
import { publicPath } from './media-storage';

export const prisma = new PrismaClient();

const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

export function toCreativeRecord(c: AdCreative): CreativeRecord {
  const mediaUrl = publicPath(c.mediaPath);
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    primaryText: c.primaryText,
    headline: c.headline,
    description: c.description,
    mediaType: c.mediaType === 'video' ? 'video' : 'image',
    mediaPath: c.mediaPath,
    posterPath: c.posterPath,
    thumbUrl: c.posterPath ? publicPath(c.posterPath) : c.mediaType === 'image' ? mediaUrl : null,
    mediaUrl
  };
}

export function prismaLaunchRepo(db: PrismaClient = prisma): LaunchRepo {
  return {
    async loadCreatives(ids, scope) {
      if (ids.length === 0) return [];
      const rows = await db.adCreative.findMany({ where: { id: { in: ids }, storeId: scope.storeId, deletedAt: null } });
      return rows.map(toCreativeRecord);
    },

    async findCampaign(ownerId, externalId) {
      const row = await db.metaCampaign.findUnique({ where: { ownerId_externalId: { ownerId, externalId } } });
      if (!row || row.deletedAt) return null;
      return { id: row.id, adAccountId: row.adAccountId, name: row.name, dailyBudget: row.dailyBudget, bidStrategy: row.bidStrategy, raw: row.raw };
    },

    async upsertCampaign(r) {
      const data = {
        storeId: r.storeId,
        adAccountId: r.adAccountId,
        name: r.name,
        status: r.status,
        objective: r.objective,
        dailyBudget: r.dailyBudget,
        bidStrategy: r.bidStrategy,
        raw: json(r.raw),
        deletedAt: null
      };
      const row = await db.metaCampaign.upsert({
        where: { ownerId_externalId: { ownerId: r.ownerId, externalId: r.externalId } },
        create: { ownerId: r.ownerId, externalId: r.externalId, ...data },
        update: data
      });
      return { id: row.id };
    },

    async findAdset(ownerId, externalId) {
      const row = await db.metaAdSet.findUnique({
        where: { ownerId_externalId: { ownerId, externalId } },
        include: { campaign: { select: { externalId: true } } }
      });
      if (!row || row.deletedAt) return null;
      return { id: row.id, campaignExternalId: row.campaign.externalId, name: row.name };
    },

    async upsertAdset(r) {
      const data = {
        campaignId: r.campaignId,
        adAccountId: r.adAccountId,
        name: r.name,
        status: r.status,
        dailyBudget: r.dailyBudget,
        bidStrategy: r.bidStrategy,
        optimizationGoal: r.optimizationGoal,
        targeting: json(r.targeting),
        raw: json(r.raw),
        deletedAt: null
      };
      const row = await db.metaAdSet.upsert({
        where: { ownerId_externalId: { ownerId: r.ownerId, externalId: r.externalId } },
        create: { ownerId: r.ownerId, externalId: r.externalId, ...data },
        update: data
      });
      return { id: row.id };
    },

    async upsertAd(r) {
      const data = {
        storeId: r.storeId,
        adsetId: r.adsetId,
        adAccountId: r.adAccountId,
        name: r.name,
        status: r.status,
        creativeId: r.creativeId,
        metaCreativeId: r.metaCreativeId,
        pageId: r.pageId,
        link: r.link,
        displayLink: r.displayLink,
        urlTags: r.urlTags,
        title: r.title,
        body: r.body,
        thumbnailUrl: r.thumbnailUrl,
        imageUrl: r.imageUrl,
        callToActionType: r.callToActionType,
        creativeData: json(r.creativeData),
        launchId: r.launchId,
        launchedBy: r.launchedBy,
        deletedAt: null,
        // Only ever SET the post id — never wipe a known one (§10.1).
        ...(r.postId ? { postId: r.postId, postCheckedAt: new Date() } : {})
      };
      const row = await db.metaAd.upsert({
        where: { ownerId_externalId: { ownerId: r.ownerId, externalId: r.externalId } },
        create: { ownerId: r.ownerId, externalId: r.externalId, ...data },
        update: data
      });
      return { id: row.id };
    },

    async latestAdForPost(ownerId, postId) {
      const row = await db.metaAd.findFirst({
        where: { ownerId, postId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { title: true, body: true, thumbnailUrl: true, imageUrl: true, link: true }
      });
      return row ?? null;
    }
  };
}
