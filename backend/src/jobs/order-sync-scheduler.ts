/**
 * Periodic incremental order sync for every active store — the safety net
 * under the webhook path (missed deliveries, stores connected before
 * webhooks existed, fee backfill via transactions).
 *
 * Interval: ORDER_SYNC_INTERVAL_MIN (default 10). In-flight guard so a slow
 * Shopify page-through never stacks a second run on top.
 */
import { PrismaClient } from '@prisma/client';
import { syncOrders } from '../services/order-sync.service';
import { syncShippedOrders, isTrack17Enabled } from '../services/track17.service';

const prisma = new PrismaClient();
const INTERVAL_MS = parseInt(process.env.ORDER_SYNC_INTERVAL_MIN || '10', 10) * 60 * 1000;
const BOOT_DELAY_MS = 2 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastReport: { ranAt: string; stores: number; created: number; updated: number; errors: string[] } | null = null;

export async function runOnce(): Promise<void> {
  if (inFlight) {
    console.log('[order-sync] previous run still in flight — skipping tick');
    return;
  }
  inFlight = true;
  const ranAt = new Date().toISOString();
  let created = 0, updated = 0;
  const errors: string[] = [];
  try {
    const stores = await prisma.shopifyStore.findMany({ where: { isActive: true } });
    for (const store of stores) {
      try {
        const r = await syncOrders(store.id, { pullTransactions: false });
        created += r.ordersCreated;
        updated += r.ordersUpdated;
        if (r.errors.length) errors.push(`${store.storeDomain}: ${r.errors.length} order errors`);
      } catch (e: any) {
        errors.push(`${store.storeDomain}: ${(e?.message || String(e)).slice(0, 150)}`);
      }
    }
    // Carrier delivery check for SHIPPED orders (no-op without TRACK17_API_KEY).
    if (isTrack17Enabled()) {
      const t = await syncShippedOrders();
      if (t.errors.length) errors.push(...t.errors.map(e => `17track: ${e}`));
    }

    lastReport = { ranAt, stores: stores.length, created, updated, errors };
    if (created || updated || errors.length) {
      console.log(`[order-sync] tick: ${stores.length} stores, +${created}/${updated} orders${errors.length ? `, errors: ${errors.join(' | ')}` : ''}`);
    }
  } catch (e: any) {
    console.error('[order-sync] fatal tick error:', e?.message || e);
  } finally {
    inFlight = false;
  }
}

export function startOrderSyncScheduler(): void {
  if (timer || bootTimer) return;
  if (process.env.ORDER_SYNC_DISABLED === '1') {
    console.log('[order-sync] disabled via env');
    return;
  }
  console.log(`[order-sync] scheduler starting — every ${INTERVAL_MS / 60000}min`);
  bootTimer = setTimeout(() => { runOnce(); bootTimer = null; }, BOOT_DELAY_MS);
  timer = setInterval(runOnce, INTERVAL_MS);
}

export function stopOrderSyncScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
}

export function getStatus() {
  return { enabled: process.env.ORDER_SYNC_DISABLED !== '1', intervalMin: INTERVAL_MS / 60000, lastReport };
}
