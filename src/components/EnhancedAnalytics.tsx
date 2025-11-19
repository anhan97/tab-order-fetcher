import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, PieChart, Line, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, subWeeks, subMonths, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { Order, COGSConfig } from '@/types/order';

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
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [dateRange, setDateRange] = useState<'7' | '30' | '90'>('30');
  const [timeframeData, setTimeframeData] = useState<TimeframeData[]>([]);
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<{ name: string; value: number }[]>([]);

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
      adSpend: facebookConfigs.reduce((sum, config) => sum + config.spend, 0),
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
    
    // Calculate total Facebook ad spend
    const totalAdSpend = facebookConfigs.reduce((sum, config) => sum + config.spend, 0);
    
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

  // Sync with global date range when provided
  useEffect(() => {
    if (globalDateRange) {
      // Calculate days difference to determine appropriate preset
      const daysDiff = Math.ceil((globalDateRange.to.getTime() - globalDateRange.from.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 7) {
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
    
    // Use global date range if provided, otherwise use local date range
    if (globalDateRange) {
      startDate = globalDateRange.from;
    } else {
      if (dateRange === '7') {
        startDate = subDays(startOfDay(new Date()), 7);
      } else if (dateRange === '30') {
        startDate = subDays(startOfDay(new Date()), 30);
      } else {
        startDate = subDays(startOfDay(new Date()), 90);
      }
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
  }, [orders, cogsConfigs, timeframe, dateRange, globalDateRange]);

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
          <Select value={dateRange} onValueChange={(value: '7' | '30' | '90') => setDateRange(value)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select date range" />
            </SelectTrigger>
            <SelectContent>
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