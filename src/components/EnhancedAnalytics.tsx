import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, PieChart, Line, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfWeek, startOfMonth } from 'date-fns';
import { Order, COGSConfig } from '@/types/order';
import { useAppContext } from '@/context/AppContext';

interface EnhancedAnalyticsProps {
  orders: Order[];
  cogsConfigs: COGSConfig[];
  facebookConfigs: {
    id: string;
    accessToken: string;
    adAccountId: string;
    name: string;
    spend: number;
  }[];
  globalDateRange?: { from: Date; to: Date };
}

interface MetricCard {
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  color: string;
}

interface TimeframeData {
  date: string;
  revenue: number;
  orders: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  netProfit: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28'];

export const EnhancedAnalytics = ({ orders, cogsConfigs, facebookConfigs, globalDateRange }: EnhancedAnalyticsProps) => {
  const { shopifyConfig, mappingVersion } = useAppContext();
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  // Default range "today" — matches the rest of the app and avoids the
  // confusing "first-load shows 30-day total" Total Ad Spend bug.
  const [dateRange, setDateRange] = useState<'today' | '7' | '30' | '90'>('today');
  const [timeframeData, setTimeframeData] = useState<TimeframeData[]>([]);
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<{ name: string; value: number }[]>([]);

  // Mapped ad spend — comes from /api/pl/* which sums spend across the
  // CampaignStoreMapping entries for the active store. ALWAYS used in place
  // of facebookConfigs.spend (which is account-total and unmapped). Falls
  // back to 0 while loading.
  const [mappedAdSpend, setMappedAdSpend] = useState<number>(0);

  // Pull mapped ad spend whenever the date range changes. /today is special-
  // cased because it's served from the 5min live cache, no DB write; other
  // ranges aggregate from DailyPLSnapshot (historical) + today live.
  useEffect(() => {
    if (!shopifyConfig) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
    let cancelled = false;

    const fetchSpend = async () => {
      try {
        if (dateRange === 'today') {
          const r = await fetch('/api/pl/today', { headers });
          if (!r.ok) throw new Error(`${r.status}`);
          const j = await r.json();
          if (!cancelled) setMappedAdSpend(j?.breakdown?.fbAdSpend || 0);
        } else {
          const days = dateRange === '7' ? 7 : dateRange === '30' ? 30 : 90;
          const to = new Date();
          const from = new Date(to.getTime() - days * 86400000);
          const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
          const r = await fetch(`/api/pl/daily?${q}`, { headers });
          if (!r.ok) throw new Error(`${r.status}`);
          const j = await r.json();
          const total = (j?.snapshots || []).reduce((s: number, row: any) => {
            const v = typeof row.fbAdSpend === 'number' ? row.fbAdSpend : parseFloat(row.fbAdSpend || '0');
            return s + (Number.isFinite(v) ? v : 0);
          }, 0);
          if (!cancelled) setMappedAdSpend(total);
        }
      } catch (e: any) {
        console.warn('[EnhancedAnalytics] mapped ad spend fetch failed:', e?.message || e);
        if (!cancelled) setMappedAdSpend(0);
      }
    };
    void fetchSpend();
    // Every range here includes today (today / last 7 / 30 / 90), so always
    // poll. Matches /api/pl/today's 5min memo TTL.
    const interval = setInterval(() => { void fetchSpend(); }, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dateRange, shopifyConfig?.storeUrl, shopifyConfig?.accessToken, mappingVersion]);

  const calculateMetrics = (data: TimeframeData[]) => {
    const totals = data.reduce((acc, day) => ({
      revenue: acc.revenue + day.revenue,
      orders: acc.orders + day.orders,
      adSpend: acc.adSpend + day.adSpend,
      cogs: acc.cogs + day.cogs,
      shippingCost: acc.shippingCost + day.shippingCost,
      netProfit: acc.netProfit + day.netProfit
    }), {
      revenue: 0,
      orders: 0,
      // Seed totals.adSpend with the MAPPED ad spend (per store, via
      // CampaignStoreMapping) — NOT the raw facebookConfigs sum which is
      // account-total and includes campaigns belonging to other stores.
      adSpend: mappedAdSpend,
      cogs: 0,
      shippingCost: 0,
      netProfit: 0
    });

    const netProfitMargin = (totals.netProfit / totals.revenue) * 100;
    const aov = totals.revenue / totals.orders;
    const adSpendPerOrder = totals.adSpend / totals.orders;

    return [
      { title: 'Order Count', value: totals.orders, color: 'text-blue-600' },
      { title: 'Net Profit', value: totals.netProfit, prefix: '$', color: 'text-green-600' },
      { title: 'Net Profit Margin', value: netProfitMargin, suffix: '%', color: 'text-purple-600' },
      { title: 'Total Cost', value: totals.cogs + totals.shippingCost + totals.adSpend, prefix: '$', color: 'text-red-600' },
      { title: 'Revenue', value: totals.revenue, prefix: '$', color: 'text-yellow-600' },
      { title: 'Ad Spend Per Order', value: adSpendPerOrder, prefix: '$', color: 'text-orange-600' },
      { title: 'AOV', value: aov, prefix: '$', color: 'text-indigo-600' },
      { title: 'Total Ad Spend', value: totals.adSpend, prefix: '$', color: 'text-pink-600' },
      { title: 'COGS', value: totals.cogs, prefix: '$', color: 'text-cyan-600' },
      { title: 'Shipping Cost', value: totals.shippingCost, prefix: '$', color: 'text-teal-600' }
    ];
  };

  const aggregateData = (startDate: Date) => {
    const groupedData = new Map<string, TimeframeData>();

    // Use the MAPPED ad spend (per CampaignStoreMapping) so the chart
    // matches Total Ad Spend KPI and the P&L table. facebookConfigs.spend
    // is account-total and would inflate the number.
    const totalAdSpend = mappedAdSpend;
    
    orders.forEach(order => {
      // Parse local time string to Date object
      const orderDate = new Date(order.orderDate);
      if (orderDate < startDate) return;

      let dateKey: string;
      if (timeframe === 'daily') {
        dateKey = format(orderDate, 'yyyy-MM-dd');
      } else if (timeframe === 'weekly') {
        dateKey = format(startOfWeek(orderDate), 'yyyy-MM-dd');
      } else {
        dateKey = format(startOfMonth(orderDate), 'yyyy-MM');
      }

      const config = cogsConfigs.find(c => c.variantId === order.variantId);
      const cogs = ((config?.baseCost || 0) + (config?.handlingFee || 0)) * order.quantity;
      const shippingCost = order.shippingCost || 0;

      if (!groupedData.has(dateKey)) {
        groupedData.set(dateKey, {
          date: dateKey,
          revenue: 0,
          orders: 0,
          adSpend: 0,
          cogs: 0,
          shippingCost: 0,
          netProfit: 0
        });
      }

      const data = groupedData.get(dateKey)!;
      data.revenue += order.totalPrice;
      data.orders += 1;
      data.cogs += cogs;
      data.shippingCost += shippingCost;
    });

    // Distribute ad spend proportionally based on revenue
    const totalRevenue = Array.from(groupedData.values()).reduce((sum, data) => sum + data.revenue, 0);
    
    if (totalRevenue > 0) {
      Array.from(groupedData.values()).forEach(data => {
        const revenueRatio = data.revenue / totalRevenue;
        data.adSpend = totalAdSpend * revenueRatio;
        data.netProfit = data.revenue - (data.cogs + data.shippingCost + data.adSpend);
      });
    }

    return Array.from(groupedData.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  // Sync with global date range when provided. Map sub-day windows to
  // 'today' so KPIs match what the dashboard / mapping panel show.
  useEffect(() => {
    if (globalDateRange) {
      const daysDiff = Math.ceil((globalDateRange.to.getTime() - globalDateRange.from.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 1) {
        setDateRange('today');
      } else if (daysDiff <= 7) {
        setDateRange('7');
      } else if (daysDiff <= 30) {
        setDateRange('30');
      } else {
        setDateRange('90');
      }
    }
  }, [globalDateRange]);

  useEffect(() => {
    let startDate: Date;

    if (globalDateRange) {
      startDate = globalDateRange.from;
    } else if (dateRange === 'today') {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      startDate = t;
    } else if (dateRange === '7') {
      startDate = subDays(new Date(), 7); startDate.setHours(0, 0, 0, 0);
    } else if (dateRange === '30') {
      startDate = subDays(new Date(), 30); startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = subDays(new Date(), 90); startDate.setHours(0, 0, 0, 0);
    }

    const data = aggregateData(startDate);
    setTimeframeData(data);

    const metrics = calculateMetrics(data);
    setMetrics(metrics);

    // Calculate cost breakdown
    const totalCosts = metrics.find(m => m.title === 'Total Cost')?.value || 0;
    const breakdown = [
      { name: 'COGS', value: metrics.find(m => m.title === 'COGS')?.value || 0 },
      { name: 'Shipping', value: metrics.find(m => m.title === 'Shipping Cost')?.value || 0 },
      { name: 'Ad Spend', value: metrics.find(m => m.title === 'Total Ad Spend')?.value || 0 }
    ];
    setCostBreakdown(breakdown);
  }, [orders, cogsConfigs, timeframe, dateRange, globalDateRange, mappedAdSpend]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Performance Analytics</h2>
        <div className="flex space-x-4">
          <Select value={timeframe} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setTimeframe(value)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={(value: 'today' | '7' | '30' | '90') => setDateRange(value)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {metrics.map((metric, index) => (
          <Card key={index}>
            <CardContent className="p-6">
              <div className="space-y-1">
                <p className="text-sm text-slate-600">{metric.title}</p>
                <h3 className={`text-2xl font-bold ${metric.color}`}>
                  {metric.prefix}
                  {metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {metric.suffix}
                </h3>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeframeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#8884d8" name="Revenue" />
                  <Line type="monotone" dataKey="netProfit" stroke="#82ca9d" name="Net Profit" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={costBreakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {costBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}; 