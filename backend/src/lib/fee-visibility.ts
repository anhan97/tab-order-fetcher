/**
 * Payment gateway fees are visible only with the store's `fees.view`
 * permission (owners and system admins always have it; members only when an
 * admin grants it).
 *
 * Hiding the fee column alone would not hide anything — net revenue − COGS −
 * gross profit gives the fee straight back. So for a caller without the
 * permission every fee figure is removed AND profit is reported before
 * payment fees: grossProfit and netProfit get the fee added back. Their
 * numbers stay internally consistent, just without the fee deduction.
 */
import type { Request } from 'express';
import { hasStoreCapability } from '../middleware/resolve-store';

export const canSeeFees = (req: Request): boolean => hasStoreCapability(req, 'fees.view');

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** One P&L row (snapshot, live breakdown, period bucket) without its fees. */
function maskRow(row: Record<string, unknown>): Record<string, unknown> {
  const fee = num(row.paymentFees);
  const out: Record<string, unknown> = { ...row, paymentFees: null };
  if ('grossProfit' in row) out.grossProfit = round2(num(row.grossProfit) + fee);
  if ('netProfit' in row) out.netProfit = round2(num(row.netProfit) + fee);
  return out;
}

/**
 * Walk a JSON response and mask every P&L row in it (any plain object with a
 * `paymentFees` key). Dates, Decimals and other class instances pass through.
 */
export function maskPaymentFees<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => maskPaymentFees(v)) as unknown as T;
  if (!isPlainObject(value)) return value;
  const base = 'paymentFees' in value ? maskRow(value) : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) out[k] = k === 'paymentFees' ? v : maskPaymentFees(v);
  return out as T;
}

/** The response as this caller may see it. */
export function feesFor<T>(req: Request, body: T): T {
  return canSeeFees(req) ? body : maskPaymentFees(body);
}
