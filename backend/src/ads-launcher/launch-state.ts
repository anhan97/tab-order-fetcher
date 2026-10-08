/**
 * Per-launch state the spec keeps in Redis (§8.1 step 4, §8.6). This app has
 * no Redis, so:
 *
 *   - idempotency → the AdLaunchRequest table (survives restarts; a retry
 *     with the same requestId never creates twice)
 *   - asset cache → process memory (single backend process). Losing it only
 *     costs an extra upload, never a launch.
 *
 * Neither ever blocks a launch: storage errors are logged and treated as
 * "no record" / "cache empty".
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { LaunchResult } from './contract';
import type { AssetCache } from './launch-ads.use-case';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Idempotency ────────────────────────────────────────────────────────────

export type ClaimOutcome =
  | { state: 'claimed' }
  | { state: 'done'; result: LaunchResult }
  | { state: 'running' }
  /** Storage failed: launch anyway, we only lose replay. */
  | { state: 'unavailable' };

export interface IdempotencyStore {
  claim(key: string): Promise<ClaimOutcome>;
  complete(key: string, result: LaunchResult): Promise<void>;
  release(key: string): Promise<void>;
}

export const idempotencyKey = (ownerId: string, requestId: string) => `ads-launcher:launch:${ownerId}:${requestId}`;

export function prismaIdempotency(prisma: PrismaClient, log: Pick<Console, 'error'> = console): IdempotencyStore {
  return {
    async claim(key) {
      try {
        // Expired rows (24h) behave as absent.
        await prisma.adLaunchRequest.deleteMany({ where: { OR: [{ key, expiresAt: { lt: new Date() } }, { expiresAt: { lt: new Date(Date.now() - DAY_MS) } }] } });
        const inserted = await prisma.$executeRaw`
          INSERT INTO "AdLaunchRequest" ("key", "status", "createdAt", "expiresAt")
          VALUES (${key}, 'running', NOW(), ${new Date(Date.now() + DAY_MS)})
          ON CONFLICT ("key") DO NOTHING
        `;
        if (inserted === 1) return { state: 'claimed' };
        const row = await prisma.adLaunchRequest.findUnique({ where: { key } });
        if (!row) return { state: 'unavailable' };
        if (row.status === 'done' && row.result) return { state: 'done', result: row.result as unknown as LaunchResult };
        return { state: 'running' };
      } catch (e) {
        log.error('[ads-launcher] idempotency claim failed — launching without replay', e);
        return { state: 'unavailable' };
      }
    },
    async complete(key, result) {
      try {
        await prisma.adLaunchRequest.update({
          where: { key },
          data: { status: 'done', result: result as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + DAY_MS) }
        });
      } catch (e) {
        log.error('[ads-launcher] idempotency complete failed', e);
      }
    },
    async release(key) {
      try {
        await prisma.adLaunchRequest.deleteMany({ where: { key } });
      } catch (e) {
        log.error('[ads-launcher] idempotency release failed', e);
      }
    }
  };
}

// ─── Asset cache ────────────────────────────────────────────────────────────

const MAX_ENTRIES = 10_000;
const memory = new Map<string, { value: unknown; expires: number }>();

/** Cache shared by every request carrying the same launchId (one launch). */
export function launchAssetCache(ownerId: string, launchId: string): AssetCache {
  const k = (kind: string, hash: string) => `ads-launcher:assets:${ownerId}:${launchId}:${kind}:${hash}`;
  return {
    async get<T>(kind: 'media' | 'creative', hash: string) {
      const hit = memory.get(k(kind, hash));
      if (!hit) return null;
      if (hit.expires < Date.now()) {
        memory.delete(k(kind, hash));
        return null;
      }
      return hit.value as T;
    },
    async set(kind, hash, value) {
      if (memory.size >= MAX_ENTRIES) {
        const now = Date.now();
        for (const [key, v] of memory) if (v.expires < now) memory.delete(key);
        // Still full: drop the oldest inserted entries.
        for (const key of memory.keys()) {
          if (memory.size < MAX_ENTRIES) break;
          memory.delete(key);
        }
      }
      memory.set(k(kind, hash), { value, expires: Date.now() + DAY_MS });
    }
  };
}
