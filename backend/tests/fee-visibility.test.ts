/**
 * Without fees.view a caller must not be able to see — or work out — the
 * payment gateway fees: the fee goes, and profit is reported before it.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { maskPaymentFees } from '../src/lib/fee-visibility';

describe('maskPaymentFees', () => {
  it('drops the fee and adds it back to gross and net profit', () => {
    const row = { date: '2026-10-20', netRevenue: 1000, basecost: 300, paymentFees: 35, grossProfit: 665, netProfit: 200 };
    expect(maskPaymentFees(row)).toEqual({ date: '2026-10-20', netRevenue: 1000, basecost: 300, paymentFees: null, grossProfit: 700, netProfit: 235 });
    // Net revenue − COGS − gross profit no longer reveals a fee.
    const m = maskPaymentFees(row) as typeof row;
    expect(m.netRevenue - m.basecost - m.grossProfit).toBe(0);
  });

  it('reads Prisma Decimals from stored snapshots', () => {
    const row = { paymentFees: new Prisma.Decimal('12.34'), grossProfit: new Prisma.Decimal('100.00'), netProfit: new Prisma.Decimal('-5.50') };
    expect(maskPaymentFees(row)).toEqual({ paymentFees: null, grossProfit: 112.34, netProfit: 6.84 });
  });

  it('masks every row of a nested response and leaves the rest alone', () => {
    const at = new Date('2026-10-20T00:00:00Z');
    const body = {
      snapshots: [{ date: at, paymentFees: 10, netProfit: 50 }, { date: at, paymentFees: 0, netProfit: -5 }],
      today: { breakdown: { paymentFees: 3, grossProfit: 30, netProfit: 9 }, ageSeconds: 12 },
      tzOffsetMinutes: 360
    };
    const out = maskPaymentFees(body);
    expect(out.snapshots).toEqual([{ date: at, paymentFees: null, netProfit: 60 }, { date: at, paymentFees: null, netProfit: -5 }]);
    expect(out.snapshots[0].date).toBe(at);
    expect(out.today.breakdown).toEqual({ paymentFees: null, grossProfit: 33, netProfit: 12 });
    expect(out.tzOffsetMinutes).toBe(360);
    expect(maskPaymentFees({ ok: true, days: 3 })).toEqual({ ok: true, days: 3 });
    expect(maskPaymentFees(null)).toBeNull();
  });
});
