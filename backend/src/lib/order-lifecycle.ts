/**
 * Internal fulfillment lifecycle — state machine as data, validated
 * server-side on every transition (ported from the Fulfillment platform).
 *
 *   PENDING ────► PROCESSING ────► SHIPPED ────► DELIVERED (terminal)
 *      │              │
 *      ├──► SHIPPED   └──► CANCELLED (terminal)
 *      └──► CANCELLED
 *
 * Side-effect transitions (not via updateStatus):
 *   - setting a tracking number on PENDING/PROCESSING → SHIPPED
 *   - carrier reports Delivered (17Track)             → DELIVERED
 */
export const FULFILL_STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type FulfillStatus = typeof FULFILL_STATUSES[number];

export const ORDER_FULFILL_TRANSITIONS: Record<FulfillStatus, FulfillStatus[]> = {
  PENDING: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: []
};

export function isFulfillStatus(v: string): v is FulfillStatus {
  return (FULFILL_STATUSES as readonly string[]).includes(v);
}

export function canTransition(from: string, to: string): boolean {
  if (!isFulfillStatus(from) || !isFulfillStatus(to)) return false;
  return ORDER_FULFILL_TRANSITIONS[from].includes(to);
}
