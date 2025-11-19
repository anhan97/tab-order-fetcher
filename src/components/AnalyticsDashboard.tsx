
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertCircle, TrendingUp, DollarSign, Target, Package, Loader2, ShoppingBag, Truck, Calculator } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';
import { Order, COGSConfig } from '@/types/order';
import { getDatePresetOptions, type DatePreset } from '@/utils/dateUtils';

interface AnalyticsDashboardProps {
  facebookConfig: {
    accessToken: string;
    adAccountId: string;
  };
  orders: Order[];
  cogsConfigs: COGSConfig[];
}

interface AdPerformance {
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
}

interface RoasData {
  date: string;
  roas: number;
  revenue: number;
  adSpend: number;
}

export const AnalyticsDashboard = ({ facebookConfig, orders, cogsConfigs }: AnalyticsDashboardProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState('30days');
  const [adPerformance, setAdPerformance] = useState<AdPerformance[]>([]);
  const [roasData, setRoasData] = useState<RoasData[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetchAnalytics();
  }, [facebookConfig, orders, dateRange]);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    setError('');

    try {
      const apiClient = new FacebookAdsApiClient(facebookConfig);
      
      // Get ad performance data
      const endDate = new Date();
      const startDate = new Date();
      
      // Convert standardized date range to days
      const daysMap: Record<string, number> = {
        '7days': 7,
        '30days': 30,
        '90days': 90
      };
      
      const days = daysMap[dateRange] || 30;
      startDate.setDate(endDate.getDate() - days);
      
      const performanceData = await apiClient.getAdPerformance(startDate, endDate);
      setAdPerformance(performanceData);

      // Calculate ROAS
      const roasMetrics = calculateRoas(performanceData, orders, startDate, endDate);
      setRoasData(roasMetrics);

    } catch (err) {
      console.error('Error fetching analytics:', err);
      setError('Failed to load analytics data. Please try again later.');
      toast({
        title: "Error loading data",
        description: err instanceof Error ? err.message : "Could not connect to Facebook Ads API.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateRoas = (
    adData: AdPerformance[], 
    orders: Order[], 
    startDate: Date, 
    endDate: Date
  ): RoasData[] => {
    // Group orders by date
    const ordersByDate = orders.reduce((acc, order) => {
      const date = new Date(order.orderDate).toISOString().split('T')[0];
      if (!acc[date]) acc[date] = 0;
      acc[date] += order.totalPrice;
      return acc;
    }, {} as Record<string, number>);

    // Calculate ROAS for each day
    return adData.map(day => {
      const revenue = ordersByDate[day.date] || 0;
      return {
        date: day.date,
        revenue,
        adSpend: day.spend,
        roas: day.spend > 0 ? revenue / day.spend : 0
      };
    });
  };

  const calculateMetrics = () => {
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);
    const totalCogs = orders.reduce((sum, order) => {
      const config = cogsConfigs.find(c => c.variantId === order.variantId);
      return sum + ((config?.baseCost || 0) + (config?.handlingFee || 0)) * order.quantity;
    }, 0);
    const totalShippingCost = orders.reduce((sum, order) => sum + (order.shippingCost || 0), 0);
    const totalAdSpend = adPerformance.reduce((sum, day) => sum + day.spend, 0);
    const totalCost = totalCogs + totalShippingCost + totalAdSpend;
    const netProfit = totalRevenue - totalCost;
    
    return {
      orderCount: orders.length,
      revenue: totalRevenue,
      totalCost,
      netProfit,
      netProfitMargin: (netProfit / totalRevenue) * 100,
      adSpendPerOrder: totalAdSpend / orders.length,
      avgOrderValue: totalRevenue / orders.length,
      totalAdSpend,
      cogs: totalCogs,
      shippingCost: totalShippingCost
    };
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-[100px] mb-2" />
                <Skeleton className="h-8 w-[120px]" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const metrics = calculateMetrics();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Performance Analytics</h2>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select timeframe" />
          </SelectTrigger>
          <SelectContent>
            {getDatePresetOptions().filter(option => 
              ['7days', '30days', '90days'].includes(option.value)
            ).map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ShoppingBag className="h-4 w-4 text-blue-500" />
              <p className="text-sm text-slate-600">Order Count</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">{metrics.orderCount}</h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <p className="text-sm text-slate-600">Net Profit</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.netProfit.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-purple-500" />
              <p className="text-sm text-slate-600">Net Profit Margin</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              {metrics.netProfitMargin.toFixed(2)}%
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Calculator className="h-4 w-4 text-red-500" />
              <p className="text-sm text-slate-600">Total Cost</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.totalCost.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-yellow-500" />
              <p className="text-sm text-slate-600">Revenue</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.revenue.toFixed(2)}
            </h3>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-orange-500" />
              <p className="text-sm text-slate-600">Ad Spend Per Order</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.adSpendPerOrder.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Package className="h-4 w-4 text-indigo-500" />
              <p className="text-sm text-slate-600">Avg. Order Value</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.avgOrderValue.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-pink-500" />
              <p className="text-sm text-slate-600">Total Ad Spend</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.totalAdSpend.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Calculator className="h-4 w-4 text-cyan-500" />
              <p className="text-sm text-slate-600">COGS</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.cogs.toFixed(2)}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Truck className="h-4 w-4 text-teal-500" />
              <p className="text-sm text-slate-600">Shipping Cost</p>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${metrics.shippingCost.toFixed(2)}
            </h3>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="roas">
        <TabsList>
          <TabsTrigger value="roas">ROAS</TabsTrigger>
          <TabsTrigger value="performance">Ad Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="roas">
          <Card>
            <CardHeader>
              <CardTitle>ROAS Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={roasData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="roas" stroke="#8884d8" name="ROAS" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle>Ad Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={adPerformance}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="clicks" fill="#82ca9d" name="Clicks" />
                    <Bar yAxisId="right" dataKey="spend" fill="#8884d8" name="Spend" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
