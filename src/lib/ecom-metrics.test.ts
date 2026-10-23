import { describe, it, expect } from 'vitest';
import { merHealth, metricsOf, toDayPL, type DayPL } from './ecom-metrics';

const day = (over: Partial<DayPL> = {}): DayPL => ({
  date: '2026-10-20',
  grossRevenue: 1050,
  refunds: 50,
  netRevenue: 1000,
  basecost: 300,
  paymentFees: 30,
  fbAdSpend: 350,
  otherAdSpend: 50,
  appFees: 10,
  operatingCost: 10,
  grossProfit: 670,
  netProfit: 200,
  orderCount: 20,
  fbPurchaseValue: null,
  fbPurchases: null,
  ...over
});

describe('metricsOf', () => {
  it('one day: the usual ecom ratios', () => {
    const m = metricsOf([day()]);
    expect(m).toMatchObject({ revenue: 1000, orders: 20, aov: 50, adSpend: 400, mer: 2.5, cpa: 20, cogs: 300, cogsPct: 0.3, profitPct: 0.2, profitPerOrder: 10 });
    expect(m.grossMargin).toBeCloseTo(0.67);
    expect(m.refundRate).toBeCloseTo(50 / 1050);
    // Profit before ads = 600 → break-even MER = 1000 / 600.
    expect(m.breakEvenMer).toBeCloseTo(1.6667, 3);
    expect(m.otherCosts).toBe(50);
    expect(m.roas).toBeNull();
  });

  it('ratios come from the sums, not the average of the days', () => {
    const m = metricsOf([
      day({ netRevenue: 1000, fbAdSpend: 500, otherAdSpend: 0 }), // MER 2
      day({ netRevenue: 100, fbAdSpend: 10, otherAdSpend: 0 }) // MER 10
    ]);
    expect(m.mer).toBeCloseTo(1100 / 510); // not (2 + 10) / 2
  });

  it('ROAS only over days Meta reported a purchase value for', () => {
    const m = metricsOf([day({ fbAdSpend: 100, fbPurchaseValue: 300 }), day({ fbAdSpend: 900, fbPurchaseValue: null })]);
    expect(m.roas).toBe(3);
  });

  it('nothing to divide by → null, never 0 or Infinity', () => {
    const m = metricsOf([day({ netRevenue: 0, grossRevenue: 0, orderCount: 0, fbAdSpend: 0, otherAdSpend: 0, netProfit: -20, grossProfit: 0 })]);
    expect(m).toMatchObject({ aov: null, mer: null, cpa: null, cogsPct: null, profitPct: null, profitPerOrder: null, refundRate: null });
    expect(metricsOf([])).toMatchObject({ revenue: 0, orders: 0, mer: null, roas: null });
  });

  it('losing money even before ads: no break-even MER, MER is "bad"', () => {
    const m = metricsOf([day({ netProfit: -500 })]); // before ads = -100
    expect(m.breakEvenMer).toBeNull();
    expect(merHealth(m)).toBe('bad');
  });

  it('merHealth compares MER with its break-even', () => {
    expect(merHealth(metricsOf([day()]))).toBe('good');
    expect(merHealth(metricsOf([day({ netProfit: -100 })]))).toBe('bad'); // before ads 300 → BE 3.33 > 2.5
    expect(merHealth(metricsOf([day({ fbAdSpend: 0, otherAdSpend: 0 })]))).toBeNull();
  });
});

describe('toDayPL', () => {
  it('reads Decimal strings and keeps missing Meta values as null', () => {
    const d = toDayPL({ date: '2026-10-20T00:00:00.000Z', netRevenue: '12.50', orderCount: 3, fbPurchaseValue: undefined, fbPurchases: '2' });
    expect(d).toMatchObject({ date: '2026-10-20', netRevenue: 12.5, orderCount: 3, fbPurchaseValue: null, fbPurchases: 2, basecost: 0 });
  });
});
