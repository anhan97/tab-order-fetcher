/**
 * Delegation, end to end against a real Postgres.
 *
 * The capability table is unit-tested next door; this exercises the part only
 * a database can prove: that a StoreMember row actually makes someone else's
 * store resolvable, that it carries the granted role and no more, and that
 * revoking it takes the access away again.
 *
 * OPT-IN: runs only when TEST_DATABASE_URL is set, and connects through that
 * URL explicitly instead of DATABASE_URL. That is deliberate — Prisma picks up
 * backend/.env by itself, so a plain `vitest run` would otherwise create and
 * delete rows in the developer's real dev database. Requiring a separate
 * variable makes touching a live DB something you have to ask for.
 *
 * To run it:
 *
 *   docker run -d --name tof-test-db -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=tof_test -p 55433:5432 postgres:16-alpine
 *   cd backend
 *   DATABASE_URL="postgresql://postgres:test@localhost:55433/tof_test?schema=public" npx prisma migrate deploy
 *   cd ..
 *   TEST_DATABASE_URL="postgresql://postgres:test@localhost:55433/tof_test?schema=public" \
 *     npx vitest run backend/tests/store-member.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveStoreAccess, listAccessibleStores, can } from '../src/lib/store-access';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// Explicit datasource, never the ambient DATABASE_URL: this test writes and
// deletes rows and must not be able to do that to a dev database by accident.
const db = TEST_DB_URL
  ? new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
  : null;

/**
 * Probe at MODULE level, not in beforeAll. `describe` bodies run at collection
 * time — before any hook — so a flag set in beforeAll is still false when the
 * it/it.skip choice is made, and every test would silently skip.
 */
let live = false;
if (!db) {
  console.warn('[store-member] TEST_DATABASE_URL not set — skipping integration test');
} else if (process.env.DATABASE_URL !== TEST_DB_URL) {
  // store-access.ts builds its own PrismaClient from DATABASE_URL, so the code
  // under test would query a DIFFERENT database than the one this file seeds —
  // green or red for the wrong reason, and rows written into whatever
  // DATABASE_URL happens to point at. Both must name the same throwaway DB.
  console.warn(
    '[store-member] DATABASE_URL must equal TEST_DATABASE_URL (the code under test reads DATABASE_URL) — skipping'
  );
} else {
  try {
    // Prove the schema is migrated too, not merely that something answers, so
    // an un-migrated database skips cleanly instead of failing deep inside.
    await db.$queryRaw`SELECT 1 FROM "StoreMember" LIMIT 1`;
    live = true;
  } catch (e: any) {
    console.warn('[store-member] test DB unreachable or un-migrated — skipping:', String(e?.message).slice(0, 160));
  }
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DOMAIN = `delegated-${suffix}.myshopify.com`;

let ownerId = '';
let memberId = '';
let outsiderId = '';
let storeId = '';

beforeAll(async () => {
  if (!live || !db) return;

  const mk = async (who: string) =>
    (await db.user.create({
      data: { email: `${who}-${suffix}@storemember.test`, password: 'x', isVerified: true, status: 'ACTIVE' }
    })).id;

  ownerId = await mk('owner');
  memberId = await mk('member');
  outsiderId = await mk('outsider');

  storeId = (await db.shopifyStore.create({
    data: { userId: ownerId, storeDomain: DOMAIN, accessToken: 'encrypted-blob', isActive: true }
  })).id;
});

afterAll(async () => {
  if (!db) return;
  try {
    if (storeId) {
      await db.storeMember.deleteMany({ where: { storeId } });
      await db.shopifyStore.deleteMany({ where: { id: storeId } });
    }
    // Sweep by the test-only email suffix so a half-finished run still cleans
    // up after itself rather than leaving rows for the next one.
    if (live) await db.user.deleteMany({ where: { email: { endsWith: '@storemember.test' } } });
  } finally {
    await db.$disconnect();
  }
});

const maybe = () => (live ? it : it.skip);

describe('store delegation via StoreMember', () => {
  maybe()('the owner resolves as owner', async () => {
    const a = await resolveStoreAccess(ownerId, { storeDomain: DOMAIN });
    expect(a).not.toBeNull();
    expect(a!.level).toBe('owner');
    expect(a!.ownerId).toBe(ownerId);
    expect(a!.storeId).toBe(storeId);
  });

  maybe()('someone with no grant cannot reach the store at all', async () => {
    expect(await resolveStoreAccess(outsiderId, { storeDomain: DOMAIN })).toBeNull();
    expect(await resolveStoreAccess(outsiderId, { storeId })).toBeNull();
    expect(await listAccessibleStores(outsiderId)).toEqual([]);
  });

  maybe()('granting cs makes the store resolvable at exactly that level', async () => {
    await db!.storeMember.create({ data: { userId: memberId, storeId, role: 'cs', grantedBy: ownerId } });

    const a = await resolveStoreAccess(memberId, { storeDomain: DOMAIN });
    expect(a).not.toBeNull();
    expect(a!.level).toBe('cs');
    // The store still belongs to the owner — delegation is not a transfer.
    expect(a!.ownerId).toBe(ownerId);

    expect(can(a!.level, 'read')).toBe(true);
    expect(can(a!.level, 'fulfill')).toBe(true);
    expect(can(a!.level, 'costs')).toBe(false);
    expect(can(a!.level, 'manage')).toBe(false);
  });

  maybe()('the granted store shows up in the member store list, tagged', async () => {
    const stores = await listAccessibleStores(memberId);
    expect(stores).toHaveLength(1);
    expect(stores[0].id).toBe(storeId);
    expect(stores[0].access).toBe('cs');
    expect(stores[0].ownerId).toBe(ownerId);
  });

  maybe()('re-granting changes the role in place instead of stacking rows', async () => {
    await db!.storeMember.upsert({
      where: { userId_storeId: { userId: memberId, storeId } },
      create: { userId: memberId, storeId, role: 'finance' },
      update: { role: 'finance' }
    });

    expect(await db!.storeMember.count({ where: { userId: memberId, storeId } })).toBe(1);
    const a = await resolveStoreAccess(memberId, { storeDomain: DOMAIN });
    expect(a!.level).toBe('finance');
    expect(can(a!.level, 'costs')).toBe(true);
    expect(can(a!.level, 'fulfill')).toBe(false);
  });

  maybe()('a junk role in the DB degrades to viewer, never to more access', async () => {
    await db!.storeMember.update({
      where: { userId_storeId: { userId: memberId, storeId } },
      data: { role: 'superuser' }
    });
    const a = await resolveStoreAccess(memberId, { storeDomain: DOMAIN });
    expect(a!.level).toBe('viewer');
    expect(can(a!.level, 'fulfill')).toBe(false);
    expect(can(a!.level, 'costs')).toBe(false);
  });

  maybe()('revoking removes access immediately', async () => {
    await db!.storeMember.deleteMany({ where: { userId: memberId, storeId } });
    expect(await resolveStoreAccess(memberId, { storeDomain: DOMAIN })).toBeNull();
    expect(await listAccessibleStores(memberId)).toEqual([]);
  });

  maybe()('deactivating the store hides it from members and owner alike', async () => {
    await db!.storeMember.create({ data: { userId: memberId, storeId, role: 'manager' } });
    expect(await resolveStoreAccess(memberId, { storeDomain: DOMAIN })).not.toBeNull();

    await db!.shopifyStore.update({ where: { id: storeId }, data: { isActive: false } });
    expect(await resolveStoreAccess(memberId, { storeDomain: DOMAIN })).toBeNull();
    expect(await listAccessibleStores(memberId)).toEqual([]);
    expect(await listAccessibleStores(ownerId)).toEqual([]);

    await db!.shopifyStore.update({ where: { id: storeId }, data: { isActive: true } });
  });

  maybe()('deleting the member cascades the grant away', async () => {
    const doomed = await db!.user.create({
      data: { email: `doomed-${suffix}@storemember.test`, password: 'x', isVerified: true, status: 'ACTIVE' }
    });
    await db!.storeMember.create({ data: { userId: doomed.id, storeId, role: 'viewer' } });

    await db!.user.delete({ where: { id: doomed.id } });
    expect(await db!.storeMember.count({ where: { userId: doomed.id } })).toBe(0);
  });
});
