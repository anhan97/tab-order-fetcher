/**
 * The two "needs attention" views on the Fulfillment page, defined once.
 *
 *   STUCK  — shipped a while ago, still not delivered. Something to chase the
 *            supplier / carrier about.
 *   ISSUES — an order that needs someone to act, each with a reason:
 *              shipping_error   carrier reports a failure / exception
 *              tracking_missing tracking still unknown to the carrier 7+ days
 *                               after shipping
 *              paid_not_shipped paid, still not shipped after 5 days
 *              missing_cost     a product has no COGS price, so P&L and the
 *                               supplier payable are understated
 *
 * Both are about CURRENT state, so the page's date filter does not apply to
 * them — an order shipped a month ago is exactly what STUCK is for.
 *
 * `where` builders feed Prisma; `issueReasons` labels a loaded row. They must
 * agree, which is why both live here.
 */
import type { Prisma } from '@prisma/client';

export const DEFAULT_STUCK_DAYS = 15;
export const PAID_NOT_SHIPPED_DAYS = 5;
export const TRACKING_UNKNOWN_DAYS = 7;

/**
 * Carrier states that mean delivery went wrong. Shopify's
 * fulfillment.shipment_status and 17track's normalized status share the
 * deliveryStatus column, so both vocabularies are listed. Compared
 * case-insensitively.
 */
export const SHIPPING_ERROR_STATUSES = [
  'failure', 'attempted_delivery',                     // Shopify
  'DeliveryFailure', 'Exception', 'Expired'           // 17track
];
const TRACKING_UNKNOWN_STATUSES = ['NotFound'];

export type IssueReason = 'shipping_error' | 'tracking_missing' | 'paid_not_shipped' | 'missing_cost';

const DAY = 86_400_000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

const anyStatus = (values: string[]): Prisma.OrderWhereInput[] =>
  values.map(v => ({ deliveryStatus: { equals: v, mode: 'insensitive' as const } }));

/** Shipped before the cutoff — by ship date when known, else by order date. */
const shippedBefore = (cutoff: Date): Prisma.OrderWhereInput => ({
  OR: [
    { shippedAt: { lt: cutoff } },
    { shippedAt: null, processedAt: { lt: cutoff } }
  ]
});

export function stuckWhere(now: Date, stuckDays: number): Prisma.OrderWhereInput {
  return {
    fulfillStatus: 'SHIPPED',
    // fulfillStatus flips to DELIVERED on delivery, but a carrier can report
    // "delivered" before our lifecycle catches up. Nulls must stay in: a SQL
    // NOT on a NULL column would silently drop them.
    OR: [
      { deliveryStatus: null },
      { NOT: { deliveryStatus: { equals: 'delivered', mode: 'insensitive' } } }
    ],
    AND: [shippedBefore(daysAgo(now, stuckDays))]
  };
}

export function issuesWhere(now: Date): Prisma.OrderWhereInput {
  return {
    NOT: { fulfillStatus: 'CANCELLED' },
    OR: [
      { fulfillStatus: 'SHIPPED', OR: anyStatus(SHIPPING_ERROR_STATUSES) },
      {
        fulfillStatus: 'SHIPPED',
        OR: anyStatus(TRACKING_UNKNOWN_STATUSES),
        AND: [shippedBefore(daysAgo(now, TRACKING_UNKNOWN_DAYS))]
      },
      {
        status: 'paid',
        fulfillStatus: { in: ['PENDING', 'PROCESSING'] },
        processedAt: { lt: daysAgo(now, PAID_NOT_SHIPPED_DAYS) }
      },
      { lineItems: { some: { variantId: { not: null }, unitBasecost: null } } }
    ]
  };
}

interface IssueRow {
  status: string;
  fulfillStatus: string;
  deliveryStatus: string | null;
  processedAt: Date | null;
  shippedAt: Date | null;
  lineItems: Array<{ variantId: bigint | string | null; unitBasecost: unknown }>;
}

const eqAny = (v: string | null, list: string[]) =>
  !!v && list.some(x => x.toLowerCase() === v.toLowerCase());

/** Why this order is in ISSUES. Empty when it isn't — mirrors issuesWhere. */
export function issueReasons(o: IssueRow, now: Date): IssueReason[] {
  if (o.fulfillStatus === 'CANCELLED') return [];
  const reasons: IssueReason[] = [];
  const shippedRef = o.shippedAt ?? o.processedAt;

  if (o.fulfillStatus === 'SHIPPED' && eqAny(o.deliveryStatus, SHIPPING_ERROR_STATUSES)) {
    reasons.push('shipping_error');
  }
  if (
    o.fulfillStatus === 'SHIPPED' &&
    eqAny(o.deliveryStatus, TRACKING_UNKNOWN_STATUSES) &&
    shippedRef && shippedRef < daysAgo(now, TRACKING_UNKNOWN_DAYS)
  ) {
    reasons.push('tracking_missing');
  }
  if (
    o.status === 'paid' &&
    (o.fulfillStatus === 'PENDING' || o.fulfillStatus === 'PROCESSING') &&
    o.processedAt && o.processedAt < daysAgo(now, PAID_NOT_SHIPPED_DAYS)
  ) {
    reasons.push('paid_not_shipped');
  }
  if (o.lineItems.some(li => li.variantId !== null && li.variantId !== undefined && (li.unitBasecost === null || li.unitBasecost === undefined))) {
    reasons.push('missing_cost');
  }
  return reasons;
}

/** Whole days since the parcel left, and whether that date is only estimated. */
export function daysSinceShipped(o: { shippedAt: Date | null; processedAt: Date | null }, now: Date) {
  const ref = o.shippedAt ?? o.processedAt;
  return {
    days: ref ? Math.floor((now.getTime() - ref.getTime()) / DAY) : null,
    estimated: !o.shippedAt
  };
}

export function parseStuckDays(raw: unknown): number {
  const n = parseInt(String(raw ?? ''), 10);
  return n >= 1 && n <= 365 ? n : DEFAULT_STUCK_DAYS;
}
