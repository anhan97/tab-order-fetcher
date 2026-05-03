import { useEffect, useMemo, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  RefreshCw, Plus, Trash2, TrendingUp, DollarSign, Wallet, Package,
  CalendarIcon, MoreVertical, Download, AlertTriangle, AlertOctagon, Info,
  Truck, Database, Settings as SettingsIcon
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/context/AppContext';
import { ProfitApiClient, PLSnapshot, OperatingCostItem } from '@/utils/profitApi';
import { formatInTimeZone } from 'date-fns-tz';
import { detectMarginAlerts, computeMargins, MarginAlert } from '@/utils/marginAlerts';
import { todayInTz, addDaysToDateString } from '@/utils/dateUtils';
import { cn } from '@/lib/utils';

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

const CATEGORIES = [
  { value: 'salary', label: 'Salary' },
  { value: 'app_fee', label: 'App / Subscription' },
  { value: 'domain', label: 'Domain / Hosting' },
  { value: 'other_ads', label: 'Other ads (Google/TikTok)' },
  { value: 'misc', label: 'Misc' }
];

const fmtUSD = (n: string | number) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
};

interface PeriodBucket {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  cogs: number;
  shippingCost: number;
  paymentFees: number;
  fbAdSpend: number;
  otherAdSpend: number;
  appFees: number;
  operatingCost: number;
  grossProfit: number;
  netProfit: number;
  orderCount: number;
}

/** UTC instant whose Y/M/D match the picked calendar date (start or end). */
const dateAtUTC = (s: string, eod = false): Date =>
  new Date(`${s}T${eod ? '23:59:59' : '00:00:00'}Z`);

export const ProfitView = () => {
  const { shopifyConfig, isShopifyConnected, timezone } = useAppContext();
  const { toast } = useToast();

  const client = useMemo(() => {
    if (!isShopifyConnected || !shopifyConfig) return null;
    return new ProfitApiClient({ storeUrl: shopifyConfig.storeUrl, accessToken: shopifyConfig.accessToken, timezone });
  }, [shopifyConfig, isShopifyConnected, timezone]);

  // --- Date range — defaults to today in user's tz, single popover picker.
  const [from, setFrom] = useState<string>(() => todayInTz(timezone));
  const [to, setTo] = useState<string>(() => todayInTz(timezone));
  const [period, setPeriod] = useState<Period>('day');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempRange, setTempRange] = useState<{ from?: Date; to?: Date }>({});

  // --- Loaded data
  const [buckets, setBuckets] = useState<PeriodBucket[]>([]);
  const [costs, setCosts] = useState<OperatingCostItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- Settings
  const [defaultSupplier, setDefaultSupplier] = useState<string>('');
  const [shippingCompanies, setShippingCompanies] = useState<Array<{ id: string; name: string; display_name: string | null; tracking_prefixes: string | null }>>([]);
  const [showSettings, setShowSettings] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // --- Operating cost form
  const [costForm, setCostForm] = useState({ date: todayInTz(timezone), category: 'misc', amount: '', description: '' });

  const load = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const fromD = dateAtUTC(from, false);
      const toD = dateAtUTC(to, true);
      if (period === 'day') {
        // Day-level: just fetch the daily snapshots — same shape as buckets after mapping.
        const r = await client.listSnapshots(fromD, toD);
        const mapped: PeriodBucket[] = r.snapshots.map(s => ({
          periodKey: s.date.slice(0, 10),
          periodStart: s.date,
          periodEnd: s.date,
          grossRevenue: parseFloat(s.grossRevenue),
          refunds: parseFloat(s.refunds),
          netRevenue: parseFloat(s.netRevenue),
          cogs: parseFloat(s.cogs),
          shippingCost: parseFloat(s.shippingCost),
          paymentFees: parseFloat(s.paymentFees),
          fbAdSpend: parseFloat(s.fbAdSpend),
          otherAdSpend: parseFloat(s.otherAdSpend),
          appFees: parseFloat(s.appFees),
          operatingCost: parseFloat(s.operatingCost),
          grossProfit: parseFloat(s.grossProfit),
          netProfit: parseFloat(s.netProfit),
          orderCount: s.orderCount
        }));
        setBuckets(mapped);
      } else {
        const r = await client.byPeriod(fromD, toD, period);
        setBuckets(r.buckets);
      }
      const ops = await client.listOperatingCosts(fromD, toD);
      setCosts(ops.items);
    } catch (e: any) {
      toast({ title: 'Lỗi tải dữ liệu', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [client, from, to, period]);

  // Load settings + carriers once
  useEffect(() => {
    if (!client) return;
    (async () => {
      try {
        const [settings, carriers] = await Promise.all([
          client.getStoreSettings(),
          client.listShippingCompanies()
        ]);
        setDefaultSupplier(settings.defaultShippingCompany || '');
        setShippingCompanies(carriers.items);
      } catch (e: any) {
        console.warn('Could not load settings:', e);
      }
    })();
  }, [client]);

  // --- Derived data ---

  /** Newest first — user wants the most recent period at the top. */
  const sortedBuckets = useMemo(
    () => [...buckets].sort((a, b) => b.periodKey.localeCompare(a.periodKey)),
    [buckets]
  );

  const totals = useMemo(() => {
    const sum = (k: keyof PeriodBucket) =>
      buckets.reduce((s, x) => s + (typeof x[k] === 'number' ? (x[k] as number) : 0), 0);
    return {
      grossRevenue: sum('grossRevenue'),
      netRevenue: sum('netRevenue'),
      cogs: sum('cogs'),
      shippingCost: sum('shippingCost'),
      paymentFees: sum('paymentFees'),
      fbAdSpend: sum('fbAdSpend'),
      otherAdSpend: sum('otherAdSpend'),
      appFees: sum('appFees'),
      operatingCost: sum('operatingCost'),
      grossProfit: sum('grossProfit'),
      netProfit: sum('netProfit'),
      refunds: sum('refunds'),
      orderCount: buckets.reduce((s, x) => s + (x.orderCount || 0), 0)
    };
  }, [buckets]);

  const margins = useMemo(() => computeMargins(totals), [totals]);
  const alerts = useMemo(() => detectMarginAlerts(totals, margins), [totals, margins]);

  // Trend chart wants oldest → newest left to right, regardless of table sort.
  const chartData = useMemo(
    () => [...buckets]
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map(b => ({
        label: b.periodKey,
        revenue: b.netRevenue,
        adSpend: b.fbAdSpend + b.otherAdSpend,
        netProfit: b.netProfit
      })),
    [buckets]
  );

  const rangeLabel = () => {
    if (from === to) return formatInTimeZone(dateAtUTC(from, false), timezone, 'MMM dd, yyyy');
    return `${formatInTimeZone(dateAtUTC(from, false), timezone, 'MMM dd, yyyy')} → ${formatInTimeZone(dateAtUTC(to, false), timezone, 'MMM dd, yyyy')}`;
  };

  // --- Date picker handlers ---

  const applyTempRange = () => {
    if (!tempRange.from) return;
    const f = formatInTimeZone(tempRange.from, timezone, 'yyyy-MM-dd');
    const t = tempRange.to
      ? formatInTimeZone(tempRange.to, timezone, 'yyyy-MM-dd')
      : f;
    setFrom(f);
    setTo(t);
    setPickerOpen(false);
    setTempRange({});
  };

  const setQuickRange = (preset: 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'mtd' | 'ytd') => {
    const today = todayInTz(timezone);
    switch (preset) {
      case 'today': setFrom(today); setTo(today); break;
      case 'yesterday': {
        const y = addDaysToDateString(today, -1);
        setFrom(y); setTo(y); break;
      }
      case '7d': setFrom(addDaysToDateString(today, -6)); setTo(today); break;
      case '30d': setFrom(addDaysToDateString(today, -29)); setTo(today); break;
      case '90d': setFrom(addDaysToDateString(today, -89)); setTo(today); break;
      case 'mtd': setFrom(today.slice(0, 7) + '-01'); setTo(today); break;
      case 'ytd': setFrom(today.slice(0, 4) + '-01-01'); setTo(today); break;
    }
    setPickerOpen(false);
  };

  // --- Action handlers (3-dot menu) ---

  const syncAndRecompute = async (opts: { deep?: boolean } = {}) => {
    if (!client) return;
    setBusy(true);
    try {
      const fromD = dateAtUTC(from, false);
      const toD = dateAtUTC(to, true);
      const syncSince = opts.deep ? new Date(toD.getTime() - 90 * 86400000) : fromD;
      const sync = await client.syncOrders({ since: syncSince, until: toD, pullTransactions: true, syncBalances: true });
      toast({ title: 'Đã sync orders', description: `Mới ${sync.ordersCreated}, cập nhật ${sync.ordersUpdated}, fees ${sync.transactionsSynced}` });
      const r = await client.recompute(fromD, toD);
      toast({ title: 'Đã recompute P&L', description: `${r.days} ngày` });
      await load();
    } catch (e: any) {
      toast({ title: 'Lỗi sync', description: e?.message || String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const recomputeOnly = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.recompute(dateAtUTC(from, false), dateAtUTC(to, true));
      toast({ title: 'Recompute xong', description: `${r.days} ngày` });
      await load();
    } catch (e: any) { toast({ title: 'Lỗi recompute', description: e?.message || String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const recomputeCogsAction = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.recomputeCogs(dateAtUTC(from, false), dateAtUTC(to, true));
      toast({ title: 'Recompute COGS', description: `${r.ordersProcessed} đơn` });
      await client.recompute(dateAtUTC(from, false), dateAtUTC(to, true));
      await load();
    } catch (e: any) { toast({ title: 'Lỗi recompute COGS', description: e?.message || String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const backfillCarriersAction = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.backfillCarriers(30);
      toast({ title: 'Đã backfill carriers', description: `Quét ${r.scanned} đơn, cập nhật ${r.updated}` });
      const carriers = await client.listShippingCompanies();
      setShippingCompanies(carriers.items);
      await client.recompute(dateAtUTC(from, false), dateAtUTC(to, true));
      await load();
    } catch (e: any) { toast({ title: 'Lỗi backfill', description: e?.message || String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const seedPricebooksAction = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.seedPricebooks();
      toast({ title: 'Seed pricebooks', description: `Created ${r.pricebooksCreated}, tiers ${r.tiersWritten}` });
      await client.recomputeCogs(dateAtUTC(from, false), dateAtUTC(to, true));
      await client.recompute(dateAtUTC(from, false), dateAtUTC(to, true));
      await load();
    } catch (e: any) { toast({ title: 'Lỗi seed pricebook', description: e?.message || String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const handleCsvFile = async (file: File) => {
    if (!client) return;
    setBusy(true);
    try {
      const text = await file.text();
      const r = await client.importCostCsv(text);
      toast({ title: 'CSV imported', description: `${r.singleItemOrders} đơn 1-item, ${r.variantOverridesWritten} overrides${r.unmappedSkus.length ? `, ${r.unmappedSkus.length} SKU unmapped` : ''}` });
      await client.recomputeCogs(dateAtUTC(from, false), dateAtUTC(to, true));
      await client.recompute(dateAtUTC(from, false), dateAtUTC(to, true));
      await load();
    } catch (e: any) { toast({ title: 'Lỗi import CSV', description: e?.message || String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const saveDefaultSupplier = async (value: string) => {
    if (!client) return;
    try {
      await client.updateStoreSettings({ defaultShippingCompany: value || null });
      setDefaultSupplier(value);
      toast({ title: 'Đã lưu default supplier', description: value || '(none)' });
    } catch (e: any) { toast({ title: 'Lỗi', description: e?.message || String(e), variant: 'destructive' }); }
  };

  // --- CSV export ---

  const exportCsv = () => {
    const header = ['Period', 'Orders', 'Net revenue', 'Refunds', 'COGS', 'Ship cost', 'Fees', 'FB ads', 'Other ads', 'App fees', 'OpEx', 'Gross profit', 'Net profit'];
    const rows = sortedBuckets.map(b => [
      b.periodKey,
      b.orderCount,
      b.netRevenue.toFixed(2),
      b.refunds.toFixed(2),
      b.cogs.toFixed(2),
      b.shippingCost.toFixed(2),
      b.paymentFees.toFixed(2),
      b.fbAdSpend.toFixed(2),
      b.otherAdSpend.toFixed(2),
      b.appFees.toFixed(2),
      b.operatingCost.toFixed(2),
      b.grossProfit.toFixed(2),
      b.netProfit.toFixed(2)
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pl-${period}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Operating cost handlers ---

  const addCost = async () => {
    if (!client) return;
    if (!costForm.amount || parseFloat(costForm.amount) <= 0) {
      toast({ title: 'Nhập amount', variant: 'destructive' });
      return;
    }
    try {
      const day = dateAtUTC(costForm.date, false);
      await client.createOperatingCost({
        date: day,
        category: costForm.category,
        amount: parseFloat(costForm.amount),
        description: costForm.description || undefined
      });
      setCostForm({ ...costForm, amount: '', description: '' });
      await client.recomputeDay(day);
      await load();
      toast({ title: 'Đã thêm chi phí' });
    } catch (e: any) { toast({ title: 'Lỗi', description: e?.message || String(e), variant: 'destructive' }); }
  };

  const deleteCost = async (id: string, dateStr: string) => {
    if (!client) return;
    try {
      await client.deleteOperatingCost(id);
      await client.recomputeDay(dateAtUTC(dateStr.slice(0, 10), false));
      await load();
    } catch (e: any) { toast({ title: 'Lỗi xoá', description: e?.message || String(e), variant: 'destructive' }); }
  };

  if (!isShopifyConnected) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center space-x-3 text-slate-600">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span>Connect Shopify trước để xem P&L.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Toolbar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date range picker */}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="min-w-[260px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {rangeLabel()}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="p-3 space-y-3">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('today')}>Today</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('yesterday')}>Yesterday</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('7d')}>7d</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('30d')}>30d</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('90d')}>90d</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('mtd')}>MTD</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuickRange('ytd')}>YTD</Button>
                    </div>
                    <Calendar
                      mode="range"
                      selected={tempRange.from ? { from: tempRange.from, to: tempRange.to } : undefined}
                      onSelect={r => setTempRange({ from: r?.from, to: r?.to })}
                      numberOfMonths={2}
                      defaultMonth={dateAtUTC(from, false)}
                      className="rounded-md border"
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        {tempRange.from ? (
                          <>From <span className="font-medium">{formatInTimeZone(tempRange.from, timezone, 'MMM dd')}</span>
                          {tempRange.to ? <> to <span className="font-medium">{formatInTimeZone(tempRange.to, timezone, 'MMM dd')}</span></> : ' (single day)'}
                          </>
                        ) : 'Pick a day or drag a range, then Apply.'}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setTempRange({}); setPickerOpen(false); }}>Cancel</Button>
                        <Button size="sm" onClick={applyTempRange} disabled={!tempRange.from}>Apply</Button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Period grouping */}
              <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Daily</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="quarter">Quarterly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                </SelectContent>
              </Select>

              {/* Sync (primary action) */}
              <Button onClick={() => syncAndRecompute()} disabled={busy} className="bg-teal-500 hover:bg-teal-600">
                <RefreshCw className={cn("h-4 w-4 mr-2", busy && "animate-spin")} />
                Sync + recompute
              </Button>

              {/* Export */}
              <Button variant="outline" onClick={exportCsv} disabled={buckets.length === 0}>
                <Download className="h-4 w-4 mr-1" />
                Export CSV
              </Button>

              {/* 3-dot menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Sync</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => syncAndRecompute({ deep: true })} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />Deep re-sync (90d)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={recomputeOnly} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />Recompute only
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={recomputeCogsAction} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />Recompute COGS
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Cost data</DropdownMenuLabel>
                  <DropdownMenuItem onClick={backfillCarriersAction} disabled={busy}>
                    <Truck className="h-4 w-4 mr-2" />Backfill carriers (30d)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={seedPricebooksAction} disabled={busy}>
                    <Package className="h-4 w-4 mr-2" />Seed pricebooks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => csvInputRef.current?.click()} disabled={busy}>
                    <Database className="h-4 w-4 mr-2" />Import cost CSV
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowSettings(s => !s)}>
                    <SettingsIcon className="h-4 w-4 mr-2" />Settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await handleCsvFile(f);
                  e.target.value = '';
                }}
              />

              <div className="text-xs text-slate-500 ml-auto">
                Timezone: <span className="font-mono">{timezone}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings panel — collapsible from 3-dot menu */}
        {showSettings && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <SettingsIcon className="h-5 w-5" />
                <span>Settings</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[260px]">
                  <Label className="text-xs flex items-center space-x-1">
                    <Truck className="h-3 w-3" />
                    <span>Default supplier (khi đơn chưa có tracking)</span>
                  </Label>
                  <Select value={defaultSupplier || '__none__'} onValueChange={v => saveDefaultSupplier(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="(không set)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(không set)</SelectItem>
                      {shippingCompanies.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.display_name || c.name}
                          {c.tracking_prefixes ? ` (${c.tracking_prefixes})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-slate-500 max-w-md">
                  Đơn chưa có tracking sẽ dùng supplier này để chọn pricebook.
                  Đơn đã fulfill sẽ tự nhận diện qua prefix tracking (vd LP1000... → LP).
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Margin alerts — at the top so user sees them first */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI title="Net revenue" value={fmtUSD(totals.netRevenue)} icon={<DollarSign className="h-4 w-4 text-blue-500" />} />
          <KPI
            title="Gross profit"
            value={fmtUSD(totals.grossProfit)}
            hint={margins.gpm !== null ? `${(margins.gpm * 100).toFixed(1)}% GPM` : undefined}
            valueClass={(margins.gpm ?? 1) < 0.30 ? 'text-rose-600' : ((margins.gpm ?? 1) < 0.45 ? 'text-amber-600' : 'text-slate-900')}
          />
          <KPI
            title="Net profit"
            value={fmtUSD(totals.netProfit)}
            hint={margins.npm !== null ? `${(margins.npm * 100).toFixed(1)}% margin` : undefined}
            valueClass={totals.netProfit < 0 ? 'text-rose-600' : 'text-emerald-600'}
          />
          <KPI title="Orders" value={totals.orderCount.toString()} icon={<Wallet className="h-4 w-4 text-violet-500" />} />
        </div>

        {/* Trend chart */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-4 w-4" />Trend</CardTitle></CardHeader>
            <CardContent style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => fmtUSD(typeof v === 'number' ? v : parseFloat(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#0d9488" strokeWidth={2} name="Net revenue" />
                  <Line type="monotone" dataKey="adSpend" stroke="#dc2626" strokeWidth={2} name="Ad spend" />
                  <Line type="monotone" dataKey="netProfit" stroke="#16a34a" strokeWidth={2} name="Net profit" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Period table — newest first */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="text-lg">{period === 'day' ? 'Daily breakdown' : `${period.charAt(0).toUpperCase() + period.slice(1)}ly breakdown`}</span>
              <span className="text-xs font-normal text-slate-500">{sortedBuckets.length} {sortedBuckets.length === 1 ? 'period' : 'periods'} · sorted newest first</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Net rev</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Ship</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead className="text-right">FB ads</TableHead>
                    <TableHead className="text-right">Other ads</TableHead>
                    <TableHead className="text-right">App fees</TableHead>
                    <TableHead className="text-right">OpEx</TableHead>
                    <TableHead className="text-right">Gross profit</TableHead>
                    <TableHead className="text-right">Net profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={13} className="text-center text-slate-400">Loading…</TableCell></TableRow>
                  )}
                  {!loading && sortedBuckets.length === 0 && (
                    <TableRow><TableCell colSpan={13} className="text-center text-slate-400">No data — bấm <em>Sync + recompute</em> để bắt đầu.</TableCell></TableRow>
                  )}
                  {sortedBuckets.map(b => (
                    <TableRow key={b.periodKey}>
                      <TableCell className="font-medium">{b.periodKey}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.orderCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.netRevenue)}</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-600">{fmtUSD(b.refunds)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.cogs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.shippingCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.paymentFees)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.fbAdSpend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.otherAdSpend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.appFees)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.operatingCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(b.grossProfit)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-medium", b.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                        {fmtUSD(b.netProfit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Operating costs */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Operating costs</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={costForm.date} onChange={e => setCostForm({ ...costForm, date: e.target.value })} className="w-40" />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={costForm.category} onValueChange={v => setCostForm({ ...costForm, category: v })}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Amount (USD)</Label>
                <Input type="number" step="0.01" value={costForm.amount} onChange={e => setCostForm({ ...costForm, amount: e.target.value })} className="w-32" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">Description</Label>
                <Input value={costForm.description} onChange={e => setCostForm({ ...costForm, description: e.target.value })} placeholder="Optional" />
              </div>
              <Button onClick={addCost}><Plus className="h-4 w-4 mr-1" />Add</Button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costs.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-slate-400">No operating costs in range</TableCell></TableRow>
                  )}
                  {[...costs].sort((a, b) => b.date.localeCompare(a.date)).map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.date.slice(0, 10)}</TableCell>
                      <TableCell>{CATEGORIES.find(x => x.value === c.category)?.label || c.category}</TableCell>
                      <TableCell className="text-slate-600">{c.description || ''}</TableCell>
                      <TableCell className="text-right">{fmtUSD(c.amount)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => deleteCost(c.id, c.date)}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
};

const KPI = ({ title, value, hint, icon, valueClass }: { title: string; value: string; hint?: string; icon?: React.ReactNode; valueClass?: string }) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs text-slate-500 flex items-center space-x-1">{icon}<span>{title}</span></div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", valueClass || 'text-slate-900')}>{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </CardContent>
  </Card>
);

const AlertCard = ({ alert }: { alert: MarginAlert }) => {
  const tone = alert.severity === 'critical'
    ? { bar: 'border-rose-500', bg: 'bg-rose-50/60', text: 'text-rose-900', sub: 'text-rose-700', Icon: AlertOctagon, iconColor: 'text-rose-600' }
    : alert.severity === 'warning'
      ? { bar: 'border-amber-500', bg: 'bg-amber-50/60', text: 'text-amber-900', sub: 'text-amber-800', Icon: AlertTriangle, iconColor: 'text-amber-600' }
      : { bar: 'border-blue-500', bg: 'bg-blue-50/60', text: 'text-blue-900', sub: 'text-blue-800', Icon: Info, iconColor: 'text-blue-600' };
  const { Icon } = tone;
  return (
    <Card className={cn("border-l-4", tone.bar, tone.bg)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", tone.iconColor)} />
          <div className="flex-1 min-w-0">
            <div className={cn("font-semibold", tone.text)}>{alert.title}</div>
            <div className={cn("text-sm mt-1", tone.sub)}>{alert.detail}</div>
            {alert.actions.length > 0 && (
              <ul className={cn("mt-2 text-sm list-disc list-inside space-y-0.5", tone.sub)}>
                {alert.actions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
