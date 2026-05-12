/**
 * Three at-a-glance charts that live in the Overview tab on /orders:
 *
 *   1. Net Profit by day (bar, red bars when negative)
 *   2. ROAS by day (line, with a 1.0× breakeven reference line)
 *   3. Cost breakdown pie (range total, split by category)
 *
 * Data source: /api/pl/daily — same endpoint Daily P&L uses, so numbers
 * are guaranteed to match the breakdown table.
 *
 * Range comes from the parent (date picker on the Orders page). When the
 * range or store changes, the charts refetch.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';

interface DailyRow {
  date: string;
  netProfit: number;
  fbAdSpend: number;
  otherAdSpend: number;
  netRevenue: number;
  basecost: number;
  paymentFees: number;
  appFees: number;
  operatingCost: number;
  fbPurchaseValue?: number;
}

const COLORS = {
  basecost:      '#0ea5e9',  // sky
  fbAdSpend:     '#f43f5e',  // rose
  otherAdSpend:  '#a855f7',  // purple
  paymentFees:   '#f59e0b',  // amber
  appFees:       '#14b8a6',  // teal
  operatingCost: '#64748b'   // slate
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const num = (v: any): number => {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
};

interface OverviewChartsProps {
  /** Lifted from OrdersPage — same range that drives the other tabs. */
  from: Date;
  to: Date;
}

export const OverviewCharts = ({ from, to }: OverviewChartsProps) => {
  const { shopifyConfig, timezone } = useAppContext();
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shopifyConfig) return;
    const ctrl = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const headers: Record<string, string> = {
          'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
          'X-Shopify-Access-Token': shopifyConfig.accessToken
        };
        if (timezone) headers['X-Tz'] = timezone;
        const q = new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString()
        });
        const res = await fetch(`/api/pl/daily?${q}`, { headers, signal: ctrl.signal });
        if (!res.ok) {
          setRows([]);
          return;
        }
        const j = await res.json();
        const list: DailyRow[] = (j?.snapshots || []).map((s: any) => ({
          date: typeof s.date === 'string' ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10),
          netProfit:    num(s.netProfit),
          fbAdSpend:    num(s.fbAdSpend),
          otherAdSpend: num(s.otherAdSpend),
          netRevenue:   num(s.netRevenue),
          basecost:     num(s.basecost),
          paymentFees:  num(s.paymentFees),
          appFees:      num(s.appFees),
          operatingCost: num(s.operatingCost),
          fbPurchaseValue: num(s.fbPurchaseValue)
        })).sort((a: DailyRow, b: DailyRow) => a.date.localeCompare(b.date));
        setRows(list);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.warn('OverviewCharts: failed to load /daily', e?.message || e);
          setRows([]);
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [shopifyConfig?.storeUrl, shopifyConfig?.accessToken, from, to, timezone]);

  // ROAS = revenue attributed to FB / FB ad spend. Use fbPurchaseValue when
  // present (live recompute days), else fallback to netRevenue / total spend
  // for older snapshot rows that don't carry FB conversion value.
  const roasData = useMemo(() => rows.map(r => {
    const totalSpend = r.fbAdSpend + r.otherAdSpend;
    const rev = r.fbPurchaseValue && r.fbPurchaseValue > 0 ? r.fbPurchaseValue : r.netRevenue;
    return {
      date: r.date,
      roas: totalSpend > 0 ? +(rev / totalSpend).toFixed(2) : 0
    };
  }), [rows]);

  const pieData = useMemo(() => {
    const totals = rows.reduce((acc, r) => {
      acc.basecost      += r.basecost;
      acc.fbAdSpend     += r.fbAdSpend;
      acc.otherAdSpend  += r.otherAdSpend;
      acc.paymentFees   += r.paymentFees;
      acc.appFees       += r.appFees;
      acc.operatingCost += r.operatingCost;
      return acc;
    }, { basecost: 0, fbAdSpend: 0, otherAdSpend: 0, paymentFees: 0, appFees: 0, operatingCost: 0 });
    const items = [
      { name: 'COGS',          value: totals.basecost,      color: COLORS.basecost },
      { name: 'FB ads',        value: totals.fbAdSpend,     color: COLORS.fbAdSpend },
      { name: 'Other ads',     value: totals.otherAdSpend,  color: COLORS.otherAdSpend },
      { name: 'Payment fees',  value: totals.paymentFees,   color: COLORS.paymentFees },
      { name: 'App fees',      value: totals.appFees,       color: COLORS.appFees },
      { name: 'Operating',     value: totals.operatingCost, color: COLORS.operatingCost }
    ].filter(x => x.value > 0);
    return items;
  }, [rows]);

  const totalCost = pieData.reduce((s, x) => s + x.value, 0);

  if (loading && rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading overview…
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-slate-400">
          No P&L data in this range yet. Try syncing from the Daily P&L tab.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Net Profit by day */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Net Profit by day
            </CardTitle>
          </CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={s => s.slice(5)} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                <Tooltip formatter={(v: any) => fmtUSD(num(v))} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="netProfit" name="Net profit">
                  {rows.map((r, i) => (
                    <Cell key={i} fill={r.netProfit < 0 ? '#dc2626' : '#16a34a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ROAS by day */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              ROAS by day
            </CardTitle>
          </CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={roasData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={s => s.slice(5)} />
                <YAxis tickFormatter={v => `${v.toFixed(1)}×`} />
                <Tooltip formatter={(v: any) => `${num(v).toFixed(2)}×`} />
                <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'breakeven 1.0×', position: 'right', fontSize: 10, fill: '#64748b' }} />
                <Line type="monotone" dataKey="roas" stroke="#0d9488" strokeWidth={2} name="ROAS" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Cost breakdown pie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Cost breakdown — {fmtUSD(totalCost)} total
          </CardTitle>
        </CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmtUSD(num(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
