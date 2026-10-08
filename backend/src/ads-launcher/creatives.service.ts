/**
 * Creative library: one row per uploaded image/video, scoped to a store.
 * Visible to everyone who can open the store; changed by those who can manage it.
 */
import type { AdCreative, Prisma } from '@prisma/client';
import { type CreativeDto, creativeName, creatorDisplayName } from './contract';
import { publicPath } from './media-storage';
import { prisma } from './prisma-launch-repo';

export interface StoreScope {
  ownerId: string;
  storeId: string;
  actorId: string;
}

const NAME_TZ = process.env.APP_TIMEZONE || undefined;

export function toCreativeDto(c: AdCreative & { _count?: { ads: number } }): CreativeDto {
  const mediaUrl = publicPath(c.mediaPath);
  return {
    id: c.id,
    storeId: c.storeId,
    productId: c.productId,
    productTitle: c.productTitle,
    productCode: c.productCode,
    productHandle: c.productHandle,
    name: c.name,
    angle: c.angle,
    primaryText: c.primaryText,
    headline: c.headline,
    description: c.description,
    status: c.status === 'archived' ? 'archived' : 'active',
    mediaType: c.mediaType === 'video' ? 'video' : 'image',
    mediaUrl,
    thumbUrl: c.posterPath ? publicPath(c.posterPath) : c.mediaType === 'image' ? mediaUrl : null,
    width: c.width,
    height: c.height,
    createdBy: c.createdBy,
    creatorName: c.creatorName,
    createdAt: c.createdAt.toISOString(),
    adsCount: c._count?.ads ?? 0
  };
}

const withAdsCount = { _count: { select: { ads: { where: { deletedAt: null } } } } } as const;

export async function listCreatives(scope: StoreScope, q: {
  ids?: string[];
  productId?: string;
  status?: 'active' | 'archived';
  launched?: 'not' | 'all';
  q?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: CreativeDto[]; total: number; notLaunched: number }> {
  const base: Prisma.AdCreativeWhereInput = {
    storeId: scope.storeId,
    deletedAt: null,
    ...(q.ids ? { id: { in: q.ids } } : {}),
    ...(q.productId ? { productId: q.productId } : {}),
    ...(q.status && !q.ids ? { status: q.status } : {}),
    ...(q.q
      ? {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { angle: { contains: q.q, mode: 'insensitive' } },
          { primaryText: { contains: q.q, mode: 'insensitive' } },
          { headline: { contains: q.q, mode: 'insensitive' } }
        ]
      }
      : {})
  };
  const notLaunchedWhere: Prisma.AdCreativeWhereInput = { ...base, ads: { none: { deletedAt: null } } };
  const where = q.launched === 'not' ? notLaunchedWhere : base;
  const [rows, total, notLaunched] = await Promise.all([
    prisma.adCreative.findMany({
      where,
      include: withAdsCount,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize
    }),
    prisma.adCreative.count({ where }),
    prisma.adCreative.count({ where: notLaunchedWhere })
  ]);
  let items = rows.map(toCreativeDto);
  if (q.ids) {
    // Keep the caller's order (pool order).
    const order = new Map(q.ids.map((id, i) => [id, i]));
    items = items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return { items, total, notLaunched };
}

export async function getCreative(scope: StoreScope, id: string): Promise<AdCreative | null> {
  return prisma.adCreative.findFirst({ where: { id, storeId: scope.storeId, deletedAt: null } });
}

export async function getCreativeDto(scope: StoreScope, id: string): Promise<CreativeDto | null> {
  const row = await prisma.adCreative.findFirst({ where: { id, storeId: scope.storeId, deletedAt: null }, include: withAdsCount });
  return row ? toCreativeDto(row) : null;
}

export async function creatorNameFor(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } });
  return creatorDisplayName(u ?? {});
}

export async function createCreative(scope: StoreScope, input: {
  product: { id: string; title: string; handle: string | null; code: string; imageUrl: string | null };
  angle: string;
  primaryText?: string | null;
  headline?: string | null;
  description?: string | null;
  mediaType: 'image' | 'video';
  mediaPath: string;
  posterPath: string | null;
  mediaMime: string;
  mediaSize: number;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
}): Promise<CreativeDto> {
  const creator = await creatorNameFor(scope.actorId);
  const now = new Date();
  const row = await prisma.adCreative.create({
    data: {
      ownerId: scope.ownerId,
      storeId: scope.storeId,
      productId: input.product.id,
      productTitle: input.product.title,
      productHandle: input.product.handle || null,
      productCode: input.product.code,
      productImageUrl: input.product.imageUrl,
      createdBy: scope.actorId,
      creatorName: creator,
      name: creativeName(creator, input.angle, input.product.code, now, NAME_TZ),
      angle: input.angle,
      primaryText: input.primaryText || null,
      headline: input.headline || null,
      description: input.description || null,
      mediaType: input.mediaType,
      mediaPath: input.mediaPath,
      posterPath: input.posterPath,
      mediaMime: input.mediaMime,
      mediaSize: input.mediaSize,
      width: input.width ?? null,
      height: input.height ?? null,
      originalName: input.originalName?.slice(0, 255) ?? null,
      createdAt: now
    },
    include: withAdsCount
  });
  return toCreativeDto(row);
}

/** Copy edits regenerate the name; the creator and the created date stay. */
export async function updateCreative(scope: StoreScope, id: string, input: {
  angle: string;
  primaryText?: string | null;
  headline?: string | null;
  description?: string | null;
}): Promise<CreativeDto | null> {
  const row = await getCreative(scope, id);
  if (!row) return null;
  const updated = await prisma.adCreative.update({
    where: { id },
    data: {
      angle: input.angle,
      name: creativeName(row.creatorName, input.angle, row.productCode, row.createdAt, NAME_TZ),
      ...(input.primaryText !== undefined ? { primaryText: input.primaryText || null } : {}),
      ...(input.headline !== undefined ? { headline: input.headline || null } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {})
    },
    include: withAdsCount
  });
  return toCreativeDto(updated);
}

export async function setCreativeStatus(scope: StoreScope, id: string, status: 'active' | 'archived'): Promise<CreativeDto | null> {
  const row = await getCreative(scope, id);
  if (!row) return null;
  const updated = await prisma.adCreative.update({ where: { id }, data: { status }, include: withAdsCount });
  return toCreativeDto(updated);
}

/** Soft delete. Files stay on disk: ads already running on Meta reference copies Meta holds. */
export async function deleteCreative(scope: StoreScope, id: string): Promise<boolean> {
  const res = await prisma.adCreative.updateMany({ where: { id, storeId: scope.storeId, deletedAt: null }, data: { deletedAt: new Date() } });
  return res.count > 0;
}

export async function creativeCountsByProduct(storeId: string): Promise<Map<string, number>> {
  const rows = await prisma.adCreative.groupBy({ by: ['productId'], where: { storeId, deletedAt: null, status: 'active' }, _count: { _all: true } });
  return new Map(rows.map(r => [r.productId, r._count._all]));
}
