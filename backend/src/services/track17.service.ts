/**
 * 17Track integration (optional — enabled when TRACK17_API_KEY is set).
 *
 * Register tracking numbers, pull carrier status, and auto-advance orders:
 * carrier says Delivered → Order.fulfillStatus = DELIVERED. Runs for
 * SHIPPED orders via the order-sync scheduler tick.
 */
import { PrismaClient } from '@prisma/client';
import { audit } from '../lib/audit';

const prisma = new PrismaClient();
const API_BASE = 'https://api.17track.net/track/v2.2';

function apiKey(): string | null {
  return process.env.TRACK17_API_KEY || null;
}

export function isTrack17Enabled(): boolean {
  return !!apiKey();
}

async function call(path: string, body: unknown): Promise<any> {
  const key = apiKey();
  if (!key) throw new Error('TRACK17_API_KEY not configured');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { '17token': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`17track ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function registerTracking(trackingNumber: string): Promise<void> {
  await call('/register', [{ number: trackingNumber }]);
}

/** Normalize 17track's package status to our deliveryStatus vocabulary. */
function normalizeStatus(raw: string | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    InfoReceived: 'InfoReceived',
    InTransit: 'InTransit',
    OutForDelivery: 'OutForDelivery',
    Delivered: 'Delivered',
    AvailableForPickup: 'AvailableForPickup',
    DeliveryFailure: 'DeliveryFailure',
    Exception: 'Exception',
    Expired: 'Expired',
    NotFound: 'NotFound'
  };
  return map[raw] ?? raw;
}

/**
 * Sync every SHIPPED order that has a tracking number. Batches of 40
 * (17track API limit per call). Delivered → DELIVERED transition + audit.
 */
export async function syncShippedOrders(): Promise<{ checked: number; delivered: number; errors: string[] }> {
  const result = { checked: 0, delivered: 0, errors: [] as string[] };
  if (!isTrack17Enabled()) return result;

  const orders = await prisma.order.findMany({
    where: { fulfillStatus: 'SHIPPED', trackingNumber: { not: null } },
    select: { id: true, userId: true, orderNumber: true, trackingNumber: true, deliveryStatus: true },
    take: 2000
  });
  if (orders.length === 0) return result;

  for (let i = 0; i < orders.length; i += 40) {
    const batch = orders.filter(o => o.trackingNumber).slice(i, i + 40);
    try {
      // Register is idempotent (already-registered numbers just error softly
      // inside the response envelope, which we ignore).
      await call('/register', batch.map(o => ({ number: o.trackingNumber })));
      const info = await call('/gettrackinfo', batch.map(o => ({ number: o.trackingNumber })));
      const accepted: any[] = info?.data?.accepted || [];
      for (const item of accepted) {
        const order = batch.find(o => o.trackingNumber === item.number);
        if (!order) continue;
        result.checked++;
        const status = normalizeStatus(item.track_info?.latest_status?.status);
        if (!status || status === order.deliveryStatus) continue;
        const delivered = status === 'Delivered';
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryStatus: status, ...(delivered ? { fulfillStatus: 'DELIVERED' } : {}) }
        });
        if (delivered) {
          result.delivered++;
          await audit({
            userId: order.userId,
            actorUserId: null,
            action: 'order.delivered_by_carrier',
            target: order.orderNumber,
            metadata: { trackingNumber: order.trackingNumber }
          });
        }
      }
    } catch (e: any) {
      result.errors.push((e?.message || String(e)).slice(0, 150));
    }
  }
  if (result.checked || result.errors.length) {
    console.log(`[17track] checked ${result.checked}, delivered ${result.delivered}${result.errors.length ? `, errors: ${result.errors.join(' | ')}` : ''}`);
  }
  return result;
}
