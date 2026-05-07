/**
 * Backfill: re-sync orders + transactions for the last N days, then recompute
 * DailyPLSnapshot for that range.
 *
 * Usage:
 *   ts-node backend/scripts/backfill-pl.ts [--days=90] [--store=<storeId>] [--no-sync]
 */
import { PrismaClient } from '@prisma/client';
import { syncOrders, syncBalanceTransactions } from '../src/services/order-sync.service';
import { recomputeRange } from '../src/services/daily-pl.service';

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const days = parseInt(String(args.days || '90'), 10);
  const targetStoreId = args.store ? String(args.store) : undefined;
  const skipSync = args['no-sync'] === true;

  const stores = await prisma.shopifyStore.findMany({
    where: { isActive: true, ...(targetStoreId ? { id: targetStoreId } : {}) },
    select: { id: true, userId: true, storeDomain: true }
  });
  if (!stores.length) {
    console.error('No active stores found.');
    process.exit(1);
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`Backfill window: ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)} (${days} days)`);
  console.log(`Stores: ${stores.length}`);

  for (const s of stores) {
    console.log(`\n[${s.storeDomain}] ${skipSync ? 'recompute only' : 'sync + recompute'}…`);
    if (!skipSync) {
      const r = await syncOrders(s.id, { since: from, until: to, pullTransactions: true });
      console.log(`  synced: created=${r.ordersCreated} updated=${r.ordersUpdated} txs=${r.transactionsSynced} errors=${r.errors.length}`);
      if (r.errors.length) {
        for (const e of r.errors.slice(0, 5)) console.log(`    err on order ${e.orderNumber}: ${e.error}`);
      }
      try {
        const b = await syncBalanceTransactions(s.id, from, to);
        console.log(`  balance: updated=${b.updated} of ${b.balanceRows} balance rows ${b.errors.length ? '(errors: ' + b.errors[0] + ')' : ''}`);
      } catch (e: any) {
        console.log(`  balance: failed (${e?.message})`);
      }
    }
    const recomp = await recomputeRange(s.userId, s.id, from, to);
    console.log(`  recomputed: ${recomp.days} days`);
  }

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
