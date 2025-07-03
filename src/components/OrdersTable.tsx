import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Search, RefreshCw, Package, User, MapPin, Calendar, Filter } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { exportToCSV } from '@/utils/csvExport';
import { Order } from '@/types/order';
import { ShopifyApiClient, OrderFilters } from '@/utils/shopifyApi';

interface OrdersTableProps {
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
  onOrdersChange?: (orders: Order[]) => void;
}

export const OrdersTable = ({ shopifyConfig, onOrdersChange }: OrdersTableProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<OrderFilters>({
    status: 'any',
    financial_status: undefined,
    fulfillment_status: undefined,
    limit: 250
  });
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchOrders();
  }, [shopifyConfig, filters, dateRange]);

  useEffect(() => {
    const filtered = orders.filter(order => 
      order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.productName.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredOrders(filtered);
  }, [orders, searchTerm]);

  useEffect(() => {
    if (onOrdersChange) {
      onOrdersChange(orders);
    }
  }, [orders, onOrdersChange]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      console.log('Fetching orders from Shopify API...');
      const apiClient = new ShopifyApiClient(shopifyConfig);
      
      // Test connection first
      const isConnected = await apiClient.testConnection();
      if (!isConnected) {
        throw new Error('Unable to connect to Shopify API');
      }

      // Prepare filters
      const orderFilters: OrderFilters = { ...filters };
      if (dateRange.start) orderFilters.created_at_min = dateRange.start + 'T00:00:00Z';
      if (dateRange.end) orderFilters.created_at_max = dateRange.end + 'T23:59:59Z';

      // Fetch orders from Shopify
      const shopifyOrders = await apiClient.getOrders(orderFilters);
      console.log('Fetched orders:', shopifyOrders);
      
      // Convert Shopify orders to our format
      const convertedOrders: Order[] = [];
      shopifyOrders.forEach(shopifyOrder => {
        const orders = apiClient.convertShopifyOrderToOrder(shopifyOrder);
        convertedOrders.push(...orders);
      });

      setOrders(convertedOrders);
      setFilteredOrders(convertedOrders);
      
      toast({
        title: "Đã tải dữ liệu!",
        description: `Tìm thấy ${convertedOrders.length} đơn hàng từ Shopify.`,
      });
      
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast({
        title: "Lỗi khi tải dữ liệu",
        description: error instanceof Error ? error.message : "Không thể kết nối với Shopify API.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      toast({
        title: "Không có dữ liệu",
        description: "Không có đơn hàng nào để xuất.",
        variant: "destructive",
      });
      return;
    }

    exportToCSV(filteredOrders);
    toast({
      title: "Xuất CSV thành công!",
      description: `Đã xuất ${filteredOrders.length} đơn hàng ra file CSV.`,
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('vi-VN');
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      'paid': 'bg-green-50 text-green-700 border-green-200',
      'pending': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'refunded': 'bg-red-50 text-red-700 border-red-200',
      'fulfilled': 'bg-blue-50 text-blue-700 border-blue-200',
      'unfulfilled': 'bg-gray-50 text-gray-700 border-gray-200'
    };
    
    return (
      <Badge variant="outline" className={statusColors[status] || 'bg-gray-50 text-gray-700 border-gray-200'}>
        {status}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <RefreshCw className="h-8 w-8 animate-spin text-teal-500 mx-auto" />
            <p className="text-slate-600">Đang tải dữ liệu đơn hàng từ Shopify...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Filter className="h-5 w-5" />
            <span>Bộ lọc</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Trạng thái đơn hàng</label>
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters(prev => ({ ...prev, status: value as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Tất cả</SelectItem>
                  <SelectItem value="open">Mở</SelectItem>
                  <SelectItem value="closed">Đóng</SelectItem>
                  <SelectItem value="cancelled">Hủy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Trạng thái thanh toán</label>
              <Select
                value={filters.financial_status || 'all'}
                onValueChange={(value) => setFilters(prev => ({ 
                  ...prev, 
                  financial_status: value === 'all' ? undefined : value as any 
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="paid">Đã thanh toán</SelectItem>
                  <SelectItem value="pending">Chờ thanh toán</SelectItem>
                  <SelectItem value="refunded">Đã hoàn tiền</SelectItem>
                  <SelectItem value="voided">Đã hủy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Từ ngày</label>
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Đến ngày</label>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Package className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Tổng đơn hàng</p>
                <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <User className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Khách hàng</p>
                <p className="text-2xl font-bold text-slate-900">
                  {new Set(orders.map(o => o.email)).size}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-teal-50 rounded-lg">
                <MapPin className="h-5 w-5 text-teal-500" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Doanh thu</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatCurrency(orders.reduce((sum, order) => sum + order.totalAmount, 0))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Package className="h-5 w-5" />
                <span>Danh sách đơn hàng ({filteredOrders.length})</span>
              </CardTitle>
            </div>
            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Tìm kiếm đơn hàng..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-full sm:w-64"
                />
              </div>
              <Button
                onClick={fetchOrders}
                variant="outline"
                className="mr-2"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Làm mới
              </Button>
              <Button
                onClick={handleExportCSV}
                className="bg-teal-500 hover:bg-teal-600"
              >
                <Download className="mr-2 h-4 w-4" />
                Xuất CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Ngày đặt</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Địa chỉ</TableHead>
                  <TableHead>Tổng tiền</TableHead>
                  <TableHead>Thanh toán</TableHead>
                  <TableHead>Vận chuyển</TableHead>
                  <TableHead>Nguồn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">#{order.orderNumber}</TableCell>
                    <TableCell>{formatDate(order.orderDate)}</TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell className="text-slate-600">{order.email}</TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        <p className="font-medium">{order.productName}</p>
                        <p className="text-sm text-slate-500">SKU: {order.productSKU}</p>
                        <p className="text-sm text-slate-500">Màu: {order.style}</p>
                        <p className="text-sm text-slate-500">SL: {order.quantity}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs text-sm">
                        <p>{order.address}</p>
                        <p>{order.city}, {order.state} {order.postalCode}</p>
                        <p>{order.countryCode}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{formatCurrency(order.totalAmount)}</TableCell>
                    <TableCell>
                      {getStatusBadge(order.financialStatus || 'unknown')}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(order.fulfillmentStatus || 'unfulfilled')}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs text-sm">
                        {order.sourceName && <p>Nguồn: {order.sourceName}</p>}
                        {order.referringSite && <p>Từ: {order.referringSite}</p>}
                        {order.landingSite && <p className="text-xs text-slate-400">Landing: {order.landingSite}</p>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {filteredOrders.length === 0 && !isLoading && (
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500">
                {searchTerm ? 'Không tìm thấy đơn hàng phù hợp' : 'Chưa có đơn hàng nào'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
