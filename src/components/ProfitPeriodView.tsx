import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { ArrowDown, ArrowUp, Minus, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ProfitApiClient } from '@/utils/profitApi';

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

const PRESETS: Array<{ key: string; label: string; period: Period; rangeDays: number }> = [
  { key: 'last30', label: 'Last 30 days (daily)', period: 'day', rangeDays: 30 },
  { key: 'last90', label: 'Last 90 days (weekly)', period: 'week', rangeDays: 90 },
  { key: 'last6m', label: 'Last 6 months (monthly)', period: 'month', rangeDays: 183 },
  { key: 'last12m', label: 'Last 12 months (monthly)', period: 'month', rangeDays: 365 },
  { key: 'last4q', label: 'Last 4 quarters (quarterly)', period: 'quarter', rangeDays: 365 },
  { key: 'last3y', label: 'Last 3 years (yearly)', period: 'year', rangeDays: 365 * 3 }
];

const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const fmtPct = (n: number | null) => {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
};

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

interface Bucket {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  basecost: number;
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  grossProfit: number;
  netProfit: number;
  orderCount: number;
}

interface Props {
  client: ProfitApiClient | null;
}

export const ProfitPeriodView = ({ client }: Props) => {
  const { toast } = useToast();
  const [presetKey, setPresetKey] = useState('last30');
  const preset = PRESETS.find(p => p.key === presetKey)!;

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - preset.rangeDays * 86400000);
  const [from, setFrom] = useState(dateOnly(defaultFrom));
  const [to, setTo] = useState(dateOnly(today));
  const [period, setPeriod] = useState<Period>(preset.period);

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [comparison, setComparison] = useState<{
    current: any;
    previous: any;
    deltaPct: Record<string, number | null>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const dateAtUTC = (s: string, eod = false) =>
    new Date(`${s}T${eod ? '23:59:59' : '00:00:00'}Z`);

  const load = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const fromD = dateAtUTC(from);
      const toD = dateAtUTC(to, true);
      const [byPeriod, cmp] = await Promise.all([
        client.byPeriod(fromD, toD, period),
        client.compare(fromD, toD, period)
      ]);
      setBuckets(byPeriod.buckets);
      setComparison(cmp.totals);
    } catch (e: any) {
      toast({ title: 'Lỗi tải period view', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [client, from, to, period]);

  // When user switches preset, update from/period, keep to=today
  const onPresetChange = (k: string) => {
    setPresetKey(k);
    const p = PRESETS.find(x => x.key === k)!;
    const f = new Date(today.getTime() - p.rangeDays * 86400000);
    setFrom(dateOnly(f));
    setTo(dateOnly(today));
    setPeriod(p.period);
  };

  // Profit chart: revenue, gross profit, net profit
  const profitChartData = useMemo(() => buckets.map(b => ({
    label: b.periodKey,
    'Net revenue': b.netRevenue,
    'Gross profit': b.grossProfit,
    'Net profit': b.netProfit
  })), [buckets]);

  // Expense chart: each cost line plotted as its own series so the user can
  // compare them at a glance.
  const expenseChartData = useMemo(() => buckets.map(b => ({
    label: b.periodKey,
    Basecost: b.basecost,
    'Payment fees': b.paymentFees,
    'FB ads': b.fbAdSpend,
    'Other ads': b.otherAdSpend,
    'App fees': b.appFees,
    OpEx: b.operatingCost
  })), [buckets]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5" />
            <span>Period view</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Preset</Label>
              <Select value={presetKey} onValueChange={onPresetChange}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Group by</Label>
              <Select value={period} onValueChange={v => setPeriod(v as Period)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week (ISO)</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={load} disabled={loading} variant="outline">Refresh</Button>
          </div>
        </CardContent>
      </Card>

      {/* Comparison KPI grid */}
      {comparison && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ComparisonKPI title="Net revenue" current={comparison.current.netRevenue} previous={comparison.previous.netRevenue} delta={comparison.deltaPct.netRevenue} />
          <ComparisonKPI title="Net profit" current={comparison.current.netProfit} previous={comparison.previous.netProfit} delta={comparison.deltaPct.netProfit} positiveIsGood />
          <ComparisonKPI title="Orders" current={comparison.current.orderCount} previous={comparison.previous.orderCount} delta={comparison.deltaPct.orderCount} numberFormat />
          <ComparisonKPI
            title="Total expenses"
            current={comparison.current.basecost + comparison.current.paymentFees + comparison.current.fbAdSpend + comparison.current.otherAdSpend + (comparison.current.appFees || 0) + comparison.current.operatingCost}
            previous={comparison.previous.basecost + comparison.previous.paymentFees + comparison.previous.fbAdSpend + comparison.previous.otherAdSpend + (comparison.previous.appFees || 0) + comparison.previous.operatingCost}
            delta={null}
            expenseStyle
          />
        </div>
      )}

      {/* Period table — moved up so the user sees numbers first, charts below for trend reading */}
      <Card>
        <CardHeader><CardTitle>{buckets.length} periods</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Net rev</TableHead>
                  <TableHead className="text-right">Refunds</TableHead>
                  <TableHead className="text-right">Basecost</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Ads</TableHead>
                  <TableHead className="text-right">App fees</TableHead>
                  <TableHead className="text-right">OpEx</TableHead>
                  <TableHead className="text-right">Gross profit</TableHead>
                  <TableHead className="text-right">Net profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (<TableRow><TableCell colSpan={11} className="text-center text-slate-400">Loading…</TableCell></TableRow>)}
                {!loading && buckets.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-slate-400">No data in window</TableCell></TableRow>
                )}
                {buckets.map(b => (
                  <TableRow key={b.periodKey}>
                    <TableCell className="font-medium">{b.periodKey}</TableCell>
                    <TableCell className="text-right">{b.orderCount}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.netRevenue)}</TableCell>
                    <TableCell className="text-right text-red-600">{fmtUSD(b.refunds)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.basecost)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.paymentFees)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.fbAdSpend + b.otherAdSpend)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.appFees)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.operatingCost)}</TableCell>
                    <TableCell className="text-right">{fmtUSD(b.grossProfit)}</TableCell>
                    <TableCell className={`text-right font-medium ${b.netProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmtUSD(b.netProfit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Profit line chart */}
      <Card>
        <CardHeader><CardTitle>Revenue & profit per {period}</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={profitChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => fmtUSD(typeof v === 'number' ? v : parseFloat(v))} />
              <Legend />
              <Line type="monotone" dataKey="Net revenue" stroke="#0d9488" strokeWidth={2} dot />
              <Line type="monotone" dataKey="Gross profit" stroke="#0284c7" strokeWidth={2} dot />
              <Line type="monotone" dataKey="Net profit" stroke="#16a34a" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Expense breakdown — now a multi-series line chart so each cost type
          can be tracked independently over time. */}
      <Card>
        <CardHeader><CardTitle>Expense breakdown per {period}</CardTitle></CardHeader>
        <CardContent style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={expenseChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => fmtUSD(typeof v === 'number' ? v : parseFloat(v))} />
              <Legend />
              <Line type="monotone" dataKey="COGS" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Shipping" stroke="#06b6d4" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Payment fees" stroke="#a855f7" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="FB ads" stroke="#dc2626" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Other ads" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="App fees" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="OpEx" stroke="#737373" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

interface KPIProps {
  title: string;
  current: number;
  previous: number;
  delta: number | null;
  positiveIsGood?: boolean;
  expenseStyle?: boolean;
  numberFormat?: boolean;
}

const ComparisonKPI = ({ title, current, previous, delta, positiveIsGood, expenseStyle, numberFormat }: KPIProps) => {
  const fmt = numberFormat ? (n: number) => n.toLocaleString() : fmtUSD;
  const goodWhen = positiveIsGood ? (n: number | null) => n !== null && n > 0 : (n: number | null) => n !== null && n > 0;
  const bad = expenseStyle ? (n: number | null) => n !== null && n > 0 : (n: number | null) => n !== null && n < 0;
  const tone = delta === null ? 'text-slate-400' : goodWhen(delta) ? 'text-green-600' : bad(delta) ? 'text-red-600' : 'text-slate-500';
  const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-slate-500">{title}</div>
        <div className="text-2xl font-semibold mt-1">{fmt(current)}</div>
        <div className="flex items-center text-xs mt-1 space-x-1">
          <span className={tone + ' flex items-center'}>
            <Icon className="h-3 w-3 mr-0.5" />
            {fmtPct(delta)}
          </span>
          <span className="text-slate-400">vs prev: {fmt(previous)}</span>
        </div>
      </CardContent>
    </Card>
  );
};
