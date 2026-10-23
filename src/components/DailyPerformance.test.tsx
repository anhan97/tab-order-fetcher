import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { DayPL } from '@/lib/ecom-metrics';
import { DailyPerformanceTable, EcomKpiGrid } from './DailyPerformance';

const day = (date: string, over: Partial<DayPL> = {}): DayPL => ({
  date, grossRevenue: 1050, refunds: 50, netRevenue: 1000, basecost: 300, paymentFees: 30,
  fbAdSpend: 350, otherAdSpend: 50, appFees: 10, operatingCost: 10, grossProfit: 670, netProfit: 200,
  orderCount: 20, fbPurchaseValue: null, fbPurchases: null, ...over
});
const idleDay = (date: string) => day(date, {
  grossRevenue: 0, refunds: 0, netRevenue: 0, basecost: 0, paymentFees: 0, fbAdSpend: 0, otherAdSpend: 0,
  appFees: 0, operatingCost: 0, grossProfit: 0, netProfit: 0, orderCount: 0
});

describe('DailyPerformanceTable', () => {
  it('one row per day, newest first, under a total computed from the sums', () => {
    render(<DailyPerformanceTable days={[day('2026-10-19'), day('2026-10-20', { netProfit: -100 }), idleDay('2026-10-21')]} />);
    const rows = screen.getAllByRole('row').slice(1); // header
    expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Total', 'Wed, Oct 21', 'Tue, Oct 20', 'Mon, Oct 19']);
    const total = within(rows[0]).getAllByRole('cell').map(c => c.textContent);
    // Revenue, Net profit, Profit %, Ad spend, MER …
    expect(total.slice(1, 6)).toEqual(['$2,000', '$100', '5.0%', '$800', '2.50×']);
    // A losing day shows a negative margin; an empty day shows no ratios.
    expect(within(rows[2]).getByText('-10.0%')).toBeInTheDocument();
    expect(within(rows[1]).getAllByText('—').length).toBeGreaterThan(3);
    expect(rows[1].className).toMatch(/text-slate-400/);
  });

  it('a single day says how to compare days', () => {
    render(<DailyPerformanceTable days={[day('2026-10-19')]} />);
    expect(screen.getByText(/pick 7d or 30d above/i)).toBeInTheDocument();
  });
});

describe('EcomKpiGrid', () => {
  it('shows profit % and MER against its break-even', () => {
    render(<EcomKpiGrid days={[day('2026-10-19')]} />);
    expect(screen.getByText('20.0%')).toBeInTheDocument();
    expect(screen.getByText('2.50×')).toBeInTheDocument();
    expect(screen.getByText(/Break-even 1\.67×/)).toBeInTheDocument();
  });
});
