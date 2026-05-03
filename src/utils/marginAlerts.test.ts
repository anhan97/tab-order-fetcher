import { describe, it, expect } from 'vitest';
import { computeMargins, detectMarginAlerts, PLTotals } from './marginAlerts';

const baseTotals: PLTotals = {
  netRevenue: 0,
  grossProfit: 0,
  netProfit: 0,
  cogs: 0,
  shippingCost: 0,
  paymentFees: 0,
  fbAdSpend: 0,
  otherAdSpend: 0,
  appFees: 0,
  operatingCost: 0,
  refunds: 0,
  orderCount: 0
};

describe('computeMargins', () => {
  it('returns nulls when netRevenue is 0', () => {
    const m = computeMargins(baseTotals);
    expect(m.gpm).toBeNull();
    expect(m.cm).toBeNull();
    expect(m.npm).toBeNull();
  });

  it('computes GPM/CM/NPM correctly', () => {
    const m = computeMargins({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 600,
      netProfit: 200,
      cogs: 250,
      shippingCost: 80,
      paymentFees: 30,
      fbAdSpend: 350,
      otherAdSpend: 50,
      appFees: 20,
      operatingCost: 30,
      orderCount: 20
    });
    expect(m.gpm).toBeCloseTo(0.6, 5);
    expect(m.cm).toBeCloseTo((1000 - 250 - 80 - 30 - 350 - 50) / 1000, 5); // 0.24
    expect(m.npm).toBeCloseTo(0.2, 5);
  });
});

describe('detectMarginAlerts', () => {
  it('returns "no data" info alert when there are no orders', () => {
    const alerts = detectMarginAlerts(baseTotals);
    expect(alerts.length).toBe(1);
    expect(alerts[0].id).toBe('no-data');
    expect(alerts[0].severity).toBe('info');
  });

  it('flags net loss as critical', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 200,
      netProfit: -100,
      cogs: 600,
      fbAdSpend: 300,
      orderCount: 10
    });
    const ids = alerts.map(a => a.id);
    expect(ids).toContain('net-loss');
    expect(alerts.find(a => a.id === 'net-loss')!.severity).toBe('critical');
  });

  it('flags low contribution margin', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 250,
      netProfit: 50,
      cogs: 350,
      shippingCost: 80,
      paymentFees: 30,
      fbAdSpend: 460, // CM = (1000 - 350 - 80 - 30 - 460) / 1000 = 8%
      orderCount: 10
    });
    const cm = alerts.find(a => a.id === 'cm-critical');
    expect(cm).toBeDefined();
    expect(cm!.severity).toBe('critical');
  });

  it('flags low GPM as critical', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 200, // GPM = 20%
      netProfit: 50,
      cogs: 700,
      shippingCost: 50,
      paymentFees: 30,
      orderCount: 10
    });
    const gpm = alerts.find(a => a.id === 'gpm-critical');
    expect(gpm).toBeDefined();
  });

  it('flags warn-level GPM at 35%', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 350, // GPM = 35%
      netProfit: 100,
      cogs: 550,
      shippingCost: 80,
      paymentFees: 20,
      orderCount: 10
    });
    const gpm = alerts.find(a => a.id === 'gpm-warning');
    expect(gpm).toBeDefined();
    expect(gpm!.severity).toBe('warning');
  });

  it('flags refund rate >5%', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 600,
      netProfit: 200,
      refunds: 80,
      orderCount: 10
    });
    expect(alerts.find(a => a.id === 'refund-rate')!.severity).toBe('warning');

    const heavy = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 600,
      netProfit: 200,
      refunds: 150, // 15%
      orderCount: 10
    });
    expect(heavy.find(a => a.id === 'refund-rate')!.severity).toBe('critical');
  });

  it('returns no alerts when everything is healthy', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 600,
      netProfit: 250,
      cogs: 300,
      shippingCost: 50,
      paymentFees: 20,
      fbAdSpend: 250,
      otherAdSpend: 30,
      appFees: 20,
      operatingCost: 30,
      refunds: 10,
      orderCount: 30
    });
    expect(alerts.length).toBe(0);
  });

  it('orders alerts critical → warning → info', () => {
    const alerts = detectMarginAlerts({
      ...baseTotals,
      netRevenue: 1000,
      grossProfit: 200, // critical GPM
      netProfit: 50,
      cogs: 600,
      shippingCost: 200,
      refunds: 70, // warning refund
      orderCount: 10
    });
    // critical alerts must come before warning
    const crit = alerts.findIndex(a => a.severity === 'critical');
    const warn = alerts.findIndex(a => a.severity === 'warning');
    expect(crit).toBeLessThan(warn);
  });
});
