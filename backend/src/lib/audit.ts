/**
 * Append-only audit trail for sensitive mutations. Best-effort: an audit
 * failure must never fail the mutation it describes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function audit(entry: {
  userId?: string | null;
  actorUserId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        metadata: (entry.metadata as any) ?? undefined
      }
    });
  } catch (e: any) {
    console.warn(`[audit] failed to record ${entry.action}:`, e?.message);
  }
}
