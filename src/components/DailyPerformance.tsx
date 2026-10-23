/**
 * Ecommerce KPIs for the dashboard range, and the same numbers day by day.
 *
 * Every figure comes from /api/pl/daily (the Daily P&L source) through
 * lib/ecom-metrics, so the cards, the total row and each day agree with the
 * P&L tab. On a phone the table scrolls inside its card with the date column
 * pinned — the page itself never scrolls sideways.
 */
import { useMemo } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { metricsOf, merHealth, type DayPL, type EcomMetrics } from '@/lib/ecom-metrics';
import { cn } from '@/lib/utils';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** Totals in whole dollars; per-order figures (AOV, CPA) keep the cents. */
const money = (n: number) => usd0.format(n);
const perOrder = (n: number) => usd2.format(n);
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
const times = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}×`);
const orNil = (n: number | null, f: (v: number) => string) => (n == null ? '—' : f(n));

/** A day with nothing on it (no orders, no spend): shown grey, not as a $0 "profit". */
const idle = (m: EcomMetrics) => m.revenue === 0 && m.adSpend === 0 && m.netProfit === 0;

/** Net margin: red below 0, amber under 10 %, green above. */
const profitTone = (p: number | null) =>
  p == null ? 'text-slate-400' : p < 0 ? 'text-rose-600' : p < 0.1 ? 'text-amber-600' : 'text-emerald-600';
const merTone = (m: EcomMetrics) => {
  const h = merHealth(m);
  return h === 'good' ? 'text-emerald-600' : h === 'bad' ? 'text-rose-600' : '';
};

// ─── KPI cards ──────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, valueClass, title }: { label: string; value: string; sub?: React.ReactNode; valueClass?: string; title?: string }) {
  return (
    <Card title={title}>
      <CardContent className="p-3 sm:p-4">
        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className={cn('mt-1 truncate text-lg font-semibold tabular-nums text-slate-900 sm:text-2xl', valueClass)}>{value}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-slate-500 sm:text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function EcomKpiGrid({ days }: { days: readonly DayPL[] }) {
  const m = useMemo(() => metricsOf(days), [days]);
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <Kpi label="Revenue" value={money(m.revenue)} sub={<>{m.orders} orders · AOV {orNil(m.aov, perOrder)}</>} title="Net revenue (after refunds and tax)" />
      <Kpi
        label="Net profit"
        value={money(m.netProfit)}
        valueClass={m.netProfit < 0 ? 'text-rose-600' : 'text-emerald-600'}
        sub={<><span className={cn('font-semibold', profitTone(m.profitPct))}>{pct(m.profitPct)}</span> margin · {orNil(m.profitPerOrder, perOrder)}/order</>}
        title="Net revenue − COGS − fees − ad spend − app fees − operating costs"
      />
      <Kpi label="Ad spend" value={money(m.adSpend)} sub={<>CPA {orNil(m.cpa, perOrder)}</>} title="Facebook + other ads. CPA = ad spend ÷ orders" />
      <Kpi
        label="MER"
        value={times(m.mer)}
        valueClass={merTone(m)}
        sub={<>Break-even {times(m.breakEvenMer)}</>}
        title="Revenue ÷ all ad spend. Above break-even MER the period makes money."
      />
      <Kpi label="ROAS (Meta)" value={times(m.roas)} sub="Purchase value ÷ FB spend" title="As reported by Meta — only for days Meta data is kept" />
      <Kpi label="COGS" value={pct(m.cogsPct)} sub={<>{money(m.cogs)} of revenue</>} title="Product + supplier shipping cost ÷ revenue" />
      <Kpi label="Gross margin" value={pct(m.grossMargin)} sub={<>{money(m.grossProfit)} gross profit</>} title="(Revenue − COGS − payment fees) ÷ revenue" />
      <Kpi label="Refund rate" value={pct(m.refundRate)} sub="Refunds ÷ gross revenue" />
    </div>
  );
}

// ─── Daily table ────────────────────────────────────────────────────────────

const dayLabel = (ymd: string) => {
  const [y, mo, d] = ymd.split('-').map(Number);
  return format(new Date(y, mo - 1, d, 12), 'EEE, MMM d');
};

const COLUMNS: Array<{ key: string; label: string; title: string; cell: (m: EcomMetrics) => React.ReactNode; className?: (m: EcomMetrics) => string }> = [
  // Most-watched first: on a phone Revenue, Net profit and Profit % show without scrolling.
  { key: 'rev', label: 'Revenue', title: 'Net revenue', cell: m => money(m.revenue) },
  { key: 'np', label: 'Net profit', title: 'Net profit', cell: m => money(m.netProfit), className: m => cn('font-medium', idle(m) ? 'text-slate-400' : m.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700') },
  { key: 'pp', label: 'Profit %', title: 'Net profit ÷ revenue', cell: m => pct(m.profitPct), className: m => cn('font-semibold', profitTone(m.profitPct)) },
  { key: 'spend', label: 'Ad spend', title: 'Facebook + other ads', cell: m => money(m.adSpend) },
  { key: 'mer', label: 'MER', title: 'Revenue ÷ ad spend', cell: m => times(m.mer), className: m => cn('font-medium', merTone(m)) },
  { key: 'bemer', label: 'BE MER', title: 'Break-even MER: the MER at which net profit is $0', cell: m => times(m.breakEvenMer), className: () => 'text-slate-500' },
  { key: 'orders', label: 'Orders', title: 'Orders', cell: m => m.orders },
  { key: 'aov', label: 'AOV', title: 'Revenue ÷ orders', cell: m => orNil(m.aov, perOrder) },
  { key: 'cpa', label: 'CPA', title: 'Ad spend ÷ orders', cell: m => orNil(m.cpa, perOrder) },
  { key: 'roas', label: 'ROAS', title: 'Meta-reported purchase value ÷ FB spend', cell: m => times(m.roas) },
  { key: 'cogs', label: 'COGS %', title: 'COGS ÷ revenue', cell: m => pct(m.cogsPct) }
];

const stickyCell = 'sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 px-3 py-2 text-left';

export function DailyPerformanceTable({ days, loading }: { days: readonly DayPL[]; loading?: boolean }) {
  const rows = useMemo(() => [...days].sort((a, b) => b.date.localeCompare(a.date)).map(d => ({ date: d.date, m: metricsOf([d]) })), [days]);
  const total = useMemo(() => metricsOf(days), [days]);
  return (
    <Card className="min-w-0">
      <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-base sm:text-lg">
          <span>Daily performance</span>
          <span className="text-xs font-normal text-slate-500">
            {rows.length === 1 ? 'One day — pick 7d or 30d above to compare days' : `${rows.length} days · newest first`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <th className={cn(stickyCell, 'bg-white font-medium')}>Day</th>
                {COLUMNS.map(c => (
                  <th key={c.key} title={c.title} className="whitespace-nowrap px-3 py-2 text-right font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold">
                <td className={cn(stickyCell, 'bg-slate-50')}>Total</td>
                {COLUMNS.map(c => (
                  <td key={c.key} className={cn('whitespace-nowrap px-3 py-2 text-right', c.className?.(total))}>{c.cell(total)}</td>
                ))}
              </tr>
              {loading && rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
              )}
              {rows.map(({ date, m }) => (
                <tr key={date} className={cn('border-b border-slate-100 last:border-0 hover:bg-slate-50/60', idle(m) && 'text-slate-400')}>
                  <td className={cn(stickyCell, 'bg-white font-medium text-slate-700')}>{dayLabel(date)}</td>
                  {COLUMNS.map(c => (
                    <td key={c.key} className={cn('whitespace-nowrap px-3 py-2 text-right', c.className?.(m))}>{c.cell(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-4 pt-3 text-[11px] leading-relaxed text-slate-500 sm:px-0 sm:pb-0">
          <b>MER</b> = revenue ÷ all ad spend · <b>BE MER</b> = the MER at which net profit is $0 (green MER is above it) ·{' '}
          <b>ROAS</b> = Meta-reported, recent days only · <b>CPA</b> = ad spend ÷ orders · <b>Profit %</b> = net profit ÷ revenue
        </p>
      </CardContent>
    </Card>
  );
}
