/**
 * History queries for past auto-launch attempts + rollback helper.
 *
 * Rollback path: if a launch went partial / failed AND we have a
 * campaignId, we can DELETE that campaign on FB (the cascade kills its
 * ad sets + ads). The local history row gets status=rolled_back so the
 * merchant sees what happened.
 */

import { PrismaClient } from '@prisma/client';
import { deleteCampaignOnFb } from './fb-ad-launch.service';

const prisma = new PrismaClient();

export async function listHistory(userId: string, opts?: { limit?: number; accountId?: string }) {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  return prisma.adLaunchHistory.findMany({
    where: { userId, ...(opts?.accountId ? { accountId: opts.accountId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, accountId: true, campaignId: true, campaignName: true,
      status: true, totalAds: true, successAds: true, failedAds: true,
      errorSummary: true, createdAt: true, updatedAt: true,
      _count: { select: { items: true } }
    }
  });
}

export async function getHistoryDetail(userId: string, id: string) {
  const row = await prisma.adLaunchHistory.findFirst({
    where: { id, userId },
    include: { items: { orderBy: { createdAt: 'asc' } } }
  });
  return row;
}

/**
 * Roll back a launch by deleting its FB campaign. Local history is
 * preserved (status flipped to rolled_back) so the merchant has a record.
 *
 * Returns { ok, message }. ok=false when no campaignId is on the row
 * (nothing to roll back on FB) or FB rejected the delete.
 */
export async function rollbackHistory(
  userId: string,
  id: string,
  fallbackToken?: string
): Promise<{ ok: boolean; message: string }> {
  const row = await prisma.adLaunchHistory.findFirst({ where: { id, userId } });
  if (!row) return { ok: false, message: 'Launch not found' };
  if (!row.campaignId) {
    // Nothing on FB to delete — just mark it rolled back so it doesn't
    // keep showing as actionable.
    await prisma.adLaunchHistory.update({ where: { id }, data: { status: 'rolled_back' } });
    return { ok: true, message: 'No FB campaign was created — marked rolled_back locally.' };
  }
  try {
    await deleteCampaignOnFb(row.campaignId, row.accountId, fallbackToken);
    await prisma.adLaunchHistory.update({
      where: { id },
      data: { status: 'rolled_back', errorSummary: `Rolled back at ${new Date().toISOString()}` }
    });
    return { ok: true, message: `Campaign ${row.campaignId} deleted on Facebook.` };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}
