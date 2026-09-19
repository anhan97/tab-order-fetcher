/**
 * Re-cost a store's orders after its COGS prices change.
 *
 * An order's cost is frozen onto its line items when the order is synced.
 * Orders that arrived BEFORE a price was entered therefore stayed uncosted
 * until someone ran "Sync + recompute" on Daily P&L — so one store showed
 * costs and another didn't, depending on whether that button had been pressed.
 *
 * Now every COGS edit schedules this for the store: re-cost its unpaid orders
 * from the last RECOMPUTE_DAYS days, then refresh the saved P&L days they fall
 * on. Debounced — the grid autosaves cell by cell, and a burst of edits
 * should cost one run, not fifty. Orders already paid to the supplier keep
 * their frozen cost (recomputeOrderCostSnapshots skips them).
 */
import { PrismaClient } from '@prisma/client';
import { recomputeOrderCostSnapshots } from './order-sync.service';
import {
  computeAndSaveForDate, invalidateTodayCache, parseTzOffsetMinutes, localCalendarDateUTC
} from './daily-pl.service';

const prisma = new PrismaClient();

export const RECOMPUTE_DAYS = 90;
const DEBOUNCE_MS = parseInt(process.env.COST_RECOMPUTE_DEBOUNCE_MS || '15000', 10);

export async function recomputeStoreCosts(storeId: string, days = RECOMPUTE_DAYS): Promise<{ orders: number; plDays: number }> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId }, select: { userId: true } });
  if (!store) return { orders: 0, plDays: 0 };

  const since = new Date(Date.now() - days * 86_400_000);
  const orders = await prisma.order.findMany({
    where: { storeId, supplierSettlementId: null, processedAt: { gte: since } },
    select: { id: true, processedAt: true }
  });

  const tz = parseTzOffsetMinutes(process.env.PL_DEFAULT_TZ || 'Etc/GMT+6');
  const dayKeys = new Map<number, Date>();
  for (const o of orders) {
    await recomputeOrderCostSnapshots(store.userId, storeId, o.id);
    if (o.processedAt) {
      const cal = localCalendarDateUTC(o.processedAt, tz);
      dayKeys.set(cal.getTime(), cal);
    }
  }

  // Today is computed live; every earlier day has a saved snapshot to refresh.
  const today = localCalendarDateUTC(new Date(), tz).getTime();
  let plDays = 0;
  for (const [key, cal] of dayKeys) {
    if (key >= today) continue;
    await computeAndSaveForDate(store.userId, storeId, cal, tz);
    plDays++;
  }
  invalidateTodayCache(store.userId, storeId);
  return { orders: orders.length, plDays };
}

const pending = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const rerun = new Set<string>();

/** Fire-and-forget, coalesced per store. */
export function scheduleStoreCostRecompute(storeId: string): void {
  const t = pending.get(storeId);
  if (t) clearTimeout(t);
  pending.set(storeId, setTimeout(() => {
    pending.delete(storeId);
    void run(storeId);
  }, DEBOUNCE_MS));
}

async function run(storeId: string): Promise<void> {
  // An edit landing mid-run needs a fresh pass once this one ends.
  if (running.has(storeId)) { rerun.add(storeId); return; }
  running.add(storeId);
  try {
    const r = await recomputeStoreCosts(storeId);
    console.log(`[cost-recompute] ${storeId}: ${r.orders} orders, ${r.plDays} P&L days refreshed`);
  } catch (e: any) {
    console.error(`[cost-recompute] ${storeId} failed:`, e?.message || e);
  } finally {
    running.delete(storeId);
    if (rerun.delete(storeId)) scheduleStoreCostRecompute(storeId);
  }
}
