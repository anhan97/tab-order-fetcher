
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, DollarSign, Target, Users, RefreshCw } from 'lucide-react';
import { FacebookAdsApiClient, FacebookCampaign } from '@/utils/facebookAdsApi';
import { Order } from '@/types/order';
import { useToast } from '@/hooks/use-toast';

interface AnalyticsDashboardProps {
  facebookConfig: {
    accessToken: string;
    adAccountId: string;
  };
  orders: Order[];
}

export const AnalyticsDashboard = ({ facebookConfig, orders }: AnalyticsDashboardProps) => {
  const [campaigns, setCampaigns] = useState<FacebookCampaign[]>([]);
  const [ordersWithAds, setOrdersWithAds] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchFacebookData();
  }, [facebookConfig]);

  const fetchFacebookData = async () => {
    setIsLoading(true);
    try {
      const apiClient = new FacebookAdsApiClient(facebookConfig);
      
      // Get campaigns from last 30 days
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const campaignData = await apiClient.getCampaigns(startDate, endDate);
      setCampaigns(campaignData);
      
      // Match orders with campaign data
      const matchedOrders = await apiClient.calculateOrderROAS(orders, campaignData);
      setOrdersWithAds(matchedOrders);
      
      toast({
        title: "Đã tải dữ liệu Facebook Ads!",
        description: `Tìm thấy ${campaignData.length} chiến dịch quảng cáo.`,
      });
      
    } catch (error) {
      console.error('Error fetching Facebook Ads data:', error);
      toast({
        title: "Lỗi khi tải dữ liệu Facebook Ads",
        description: "Không thể kết nối với Facebook Ads API.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalRevenue = ordersWithAds.reduce((sum, o) => sum + o.totalAmount, 0);
  const overallROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCostPerPurchase = campaigns.length > 0 
    ? campaigns.reduce((sum, c) => sum + c.cost_per_purchase, 0) / campaigns.length 
    : 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
            <p className="text-slate-600">Đang tải dữ liệu Facebook Ads...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <DollarSign className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Tổng chi phí quảng cáo</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalSpend)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Doanh thu từ quảng cáo</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Target className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">ROAS tổng thể</p>
                <p className="text-2xl font-bold text-slate-900">{overallROAS.toFixed(2)}x</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Users className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Cost per Purchase</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(avgCostPerPurchase)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>ROAS theo chiến dịch</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={campaigns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}x`, 'ROAS']} />
                <Bar dataKey="roas" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chi phí vs Doanh thu</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={campaigns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => [formatCurrency(Number(value)), '']} />
                <Line type="monotone" dataKey="spend" stroke="#ef4444" name="Chi phí" />
                <Line type="monotone" dataKey="purchase_value" stroke="#22c55e" name="Doanh thu" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Performance Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Hiệu suất chiến dịch</CardTitle>
            <Button onClick={fetchFacebookData} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Làm mới
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên chiến dịch</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Chi phí</TableHead>
                  <TableHead>Doanh thu</TableHead>
                  <TableHead>ROAS</TableHead>
                  <TableHead>Cost/Purchase</TableHead>
                  <TableHead>Purchases</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      <Badge variant={campaign.status === 'ACTIVE' ? 'default' : 'secondary'}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(campaign.spend)}</TableCell>
                    <TableCell>{formatCurrency(campaign.purchase_value)}</TableCell>
                    <TableCell>
                      <span className={campaign.roas >= 3 ? 'text-green-600 font-medium' : 'text-red-600'}>
                        {campaign.roas.toFixed(2)}x
                      </span>
                    </TableCell>
                    <TableCell>{formatCurrency(campaign.cost_per_purchase)}</TableCell>
                    <TableCell>{campaign.purchases}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
