/**
 * One-time merge of legacy synthetic users into their real owners.
 *
 * Background: requests without a JWT used to lazy-create a synthetic user
 * `<store-domain>@autocreated.local`, while JWT requests resolved the real
 * user. FB tokens, campaign mappings, daily metrics and orders are all
 * keyed by userId/storeId, so the same person's data ended up split across
 * two identities — "connected but asked to connect again", P&L missing ad
 * spend, etc. resolve-store now prefers the real owner, and this script
 * moves the historical rows over so nothing is orphaned.
 *
 * Matching rule: synthetic user `X@autocreated.local` merges into the real
 * (non-synthetic) user who has a ShopifyStore row for domain X. Ambiguous
 * domains (two real owners) are skipped and reported.
 *
 * Usage:
 *   ts-node backend/scripts/merge-synthetic-users.ts            # dry-run (default)
 *   ts-node backend/scripts/merge-synthetic-users.ts --apply    # write changes
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function mergeOne(synthUserId: string, synthEmail: string, realUserId: string): Promise<void> {
  console.log(`\n→ ${synthEmail} (${synthUserId})  ⇒  real user ${realUserId}`);

  const synthStores = await prisma.shopifyStore.findMany({ where: { userId: synthUserId } });
  const realStores = await prisma.shopifyStore.findMany({ where: { userId: realUserId } });
  const realDomains = new Set(realStores.map(s => s.storeDomain));

  for (const store of synthStores) {
    if (!realDomains.has(store.storeDomain)) {
      // Real user has no row for this domain → re-point the store row
      // itself; every storeId-keyed child (orders, snapshots, COGS) follows
      // for free.
      console.log(`   store ${store.storeDomain}: re-point store row ${store.id}`);
      if (APPLY) {
        await prisma.shopifyStore.update({ where: { id: store.id }, data: { userId: realUserId } });
      }
    } else {
      // Both users have a row for the domain. Keep the row that has the
      // order history (almost always the synthetic one, since legacy-header
      // calls did the syncing) and drop the empty duplicate.
      const realStore = realStores.find(s => s.storeDomain === store.storeDomain)!;
      const [synthOrders, realOrders] = await Promise.all([
        prisma.order.count({ where: { storeId: store.id } }),
        prisma.order.count({ where: { storeId: realStore.id } })
      ]);
      if (synthOrders > realOrders) {
        console.log(`   store ${store.storeDomain}: synth row has ${synthOrders} orders vs ${realOrders} — swap (delete real ${realStore.id}, re-point synth ${store.id})`);
        if (APPLY) {
          await prisma.$transaction(async tx => {
            // Move the few children the real row may have before deleting it.
            await tx.order.updateMany({ where: { storeId: realStore.id }, data: { storeId: store.id } });
            await tx.$executeRaw`UPDATE "CampaignStoreMapping" SET "storeId" = ${store.id} WHERE "storeId" = ${realStore.id}`;
            await tx.$executeRaw`DELETE FROM "DailyPLSnapshot" WHERE "storeId" = ${realStore.id}`;
            await tx.$executeRaw`UPDATE "COGSConfig" SET "storeId" = ${store.id} WHERE "storeId" = ${realStore.id}`;
            await tx.shopifyStore.delete({ where: { id: realStore.id } });
            await tx.shopifyStore.update({ where: { id: store.id }, data: { userId: realUserId } });
          });
        }
      } else {
        console.log(`   store ${store.storeDomain}: real row already has the data (${realOrders} vs ${synthOrders} orders) — move synth children then delete synth row ${store.id}`);
        if (APPLY) {
          await prisma.$transaction(async tx => {
            await tx.order.updateMany({ where: { storeId: store.id }, data: { storeId: realStore.id } });
            await tx.$executeRaw`UPDATE "CampaignStoreMapping" SET "storeId" = ${realStore.id} WHERE "storeId" = ${store.id}`;
            await tx.$executeRaw`DELETE FROM "DailyPLSnapshot" WHERE "storeId" = ${store.id}`;
            await tx.$executeRaw`UPDATE "COGSConfig" SET "storeId" = ${realStore.id} WHERE "storeId" = ${store.id}`;
            await tx.shopifyStore.delete({ where: { id: store.id } });
          });
        }
      }
    }
  }

  // userId-keyed tables. Move each synthetic row unless the real user
  // already holds a row with the same unique key (e.g. they reconnected FB
  // after the split) — in that clash the real user's fresher row wins and
  // the synthetic leftover is deleted.
  const moves: Array<{ table: string; conflictOn: string }> = [
    { table: 'UserFacebookConnection', conflictOn: 'r."fbAppId" = t."fbAppId"' },
    { table: 'UserFacebookApp', conflictOn: 'r."fbAppId" = t."fbAppId"' },
    { table: 'FacebookAdAccountAccess', conflictOn: 'r."accountId" = t."accountId"' },
    { table: 'CampaignStoreMapping', conflictOn: 'r."campaignId" = t."campaignId"' },
    { table: 'FbCampaignDailyMetric', conflictOn: 'r."accountId" = t."accountId" AND r."campaignId" = t."campaignId" AND r."date" = t."date"' }
  ];
  for (const { table, conflictOn } of moves) {
    const count = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM "${table}" WHERE "userId" = $1`, synthUserId
    );
    const n = Number(count[0]?.n || 0);
    if (n === 0) continue;
    console.log(`   ${table}: ${n} rows → real user`);
    if (APPLY) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" t SET "userId" = $2
         WHERE t."userId" = $1
           AND NOT EXISTS (SELECT 1 FROM "${table}" r WHERE r."userId" = $2 AND ${conflictOn})`,
        synthUserId, realUserId
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "userId" = $1`, synthUserId
      );
    }
  }

  // FacebookAppUserAccess grants point at the synthetic user as assignee.
  const grants = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "FacebookAppUserAccess" WHERE "assignedUserId" = ${synthUserId}
  `;
  if (Number(grants[0]?.n || 0) > 0) {
    console.log(`   FacebookAppUserAccess: ${grants[0].n} grants → real user`);
    if (APPLY) {
      await prisma.$executeRaw`
        UPDATE "FacebookAppUserAccess" g SET "assignedUserId" = ${realUserId}
        WHERE g."assignedUserId" = ${synthUserId}
          AND NOT EXISTS (
            SELECT 1 FROM "FacebookAppUserAccess" r
            WHERE r."userFbAppId" = g."userFbAppId" AND r."assignedUserId" = ${realUserId}
          )
      `;
      await prisma.$executeRaw`DELETE FROM "FacebookAppUserAccess" WHERE "assignedUserId" = ${synthUserId}`;
    }
  }

  // Leave the (now-empty) synthetic user in place unless everything moved —
  // deleting it is safe only when no FK still references it.
  if (APPLY) {
    const leftStores = await prisma.shopifyStore.count({ where: { userId: synthUserId } });
    if (leftStores === 0) {
      try {
        await prisma.user.delete({ where: { id: synthUserId } });
        console.log(`   deleted synthetic user ${synthEmail}`);
      } catch {
        console.log(`   synthetic user ${synthEmail} kept (still referenced somewhere)`);
      }
    }
  }
}

async function main() {
  console.log(`merge-synthetic-users — ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}`);

  const synths = await prisma.user.findMany({
    where: { email: { endsWith: '@autocreated.local' } },
    select: { id: true, email: true }
  });
  if (synths.length === 0) {
    console.log('No synthetic users found — nothing to do.');
    return;
  }
  console.log(`Found ${synths.length} synthetic user(s).`);

  for (const synth of synths) {
    const domain = synth.email.replace(/@autocreated\.local$/, '');
    const owners = await prisma.shopifyStore.findMany({
      where: { storeDomain: domain, userId: { not: synth.id } },
      include: { user: { select: { id: true, email: true } } }
    });
    const realOwners = Array.from(new Map(
      owners
        .filter(o => !o.user.email.endsWith('@autocreated.local'))
        .map(o => [o.user.id, o.user] as const)
    ).values());

    if (realOwners.length === 0) {
      console.log(`\n→ ${synth.email}: no real owner for domain "${domain}" yet — skipped (will merge once they register the store).`);
      continue;
    }
    if (realOwners.length > 1) {
      console.log(`\n→ ${synth.email}: AMBIGUOUS — ${realOwners.length} real users own "${domain}" (${realOwners.map(u => u.email).join(', ')}). Skipped; merge manually.`);
      continue;
    }
    await mergeOne(synth.id, synth.email, realOwners[0].id);
  }

  console.log('\nDone.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
