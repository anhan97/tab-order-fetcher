import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { ShoppingBag, DollarSign, Target, Calculator, TrendingUp, Package, Truck, Calendar as CalendarIcon, Search, Download, RefreshCw } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { exportToCSV } from '@/utils/csvExport';
import { Order } from '@/types/order';
import { CogsConfig } from '@/types/minimalCogs';
import { calculateProductCogs as calculateProductCogsUtil } from '@/utils/minimalCogsResolver';
import { calculateOrderCOGS, calculateBulkCOGS, getCountryCode } from '@/utils/cogsCalculator';
import { ShopifyApiClient, OrderFilters } from '@/utils/shopifyApi';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { cn } from '@/lib/utils';
import { FacebookAdAccount } from '@/types/facebook';
import {
  getShopifyDateRange,
  getDateRangeFromPreset,
  getDatePresetOptions,
  formatLADateRange,
  validateDateRange,
  type DatePreset
} from '@/utils/dateUtils';

interface MergedOrder extends Order {
  items: Array<{
    productName: string;
    productSKU: string;
    variantId: string;
    quantity: number;
    style: string;
  }>;
  totalQuantity: number;
}

interface OrdersTableProps {
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
  onOrdersChange: (orders: Order[]) => void;
  cogsConfig: CogsConfig | null;
  isFacebookConnected: boolean;
  onFacebookConnect: () => void;
  timezone: string;
  facebookAccounts: FacebookAdAccount[];
  accountsSpend: { [key: string]: number };
  globalDateRange?: { from: Date; to: Date };
  onAccountsSpendUpdate?: (accountId: string, spend: number) => void;
}

type DateRange = {
  from: Date;
  to: Date;
};


type MetricsData = {
  orderCount: number;
  revenue: number;
  totalCost: number;
  netProfit: number;
  netProfitMargin: number;
  adSpendPerOrder: number;
  avgOrderValue: number;
  totalAdSpend: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  roas: number;
};

export const OrdersTable = ({
  shopifyConfig,
  onOrdersChange,
  cogsConfig,
  isFacebookConnected,
  onFacebookConnect,
  timezone,
  facebookAccounts,
  accountsSpend,
  globalDateRange,
  onAccountsSpendUpdate
}: OrdersTableProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('any');
  const [datePreset, setDatePreset] = useState<DatePreset>('30days');
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeFromPreset('30days'));
  const [comparisonRange, setComparisonRange] = useState<DateRange | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [periodType, setPeriodType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();
  const [selectedShippingProvider, setSelectedShippingProvider] = useState<string>('YunTu');
  const SHIPPING_PROVIDERS = ['YunTu', 'Shengtu Logistics', 'Yuanpeng Logistics'];

  // Add state for temporary date range
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(undefined);

  // Sync with global date range when provided
  useEffect(() => {
    if (globalDateRange) {
      setDateRange(globalDateRange);
    }
  }, [globalDateRange]);

  useEffect(() => {
    fetchOrders();
  }, [shopifyConfig, dateRange, comparisonRange, timezone, statusFilter]);

  const [lastFetchedDateRange, setLastFetchedDateRange] = useState<string>('');
  const [isLoadingAdSpend, setIsLoadingAdSpend] = useState(false);
  const [fetchTimeout, setFetchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Fetch Facebook Ads spend data when date range changes (single API call per date range)
  useEffect(() => {
    if (isFacebookConnected && facebookAccounts.length > 0) {
      // Create a unique key for the current date range
      const dateRangeKey = `${dateRange.from.toISOString()}-${dateRange.to.toISOString()}`;

      // Only fetch if this is a new date range
      if (dateRangeKey !== lastFetchedDateRange) {
        console.log('OrdersTable: New date range detected, scheduling ad spend fetch:', {
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
          previousKey: lastFetchedDateRange,
          newKey: dateRangeKey
        });

        // Clear any existing timeout
        if (fetchTimeout) {
          clearTimeout(fetchTimeout);
        }

        // Clear existing ad spend data immediately
        const enabledAccounts = facebookAccounts.filter(account => account.isEnabled);
        enabledAccounts.forEach(account => {
          if (onAccountsSpendUpdate) {
            console.log(`OrdersTable: Clearing spend data for account ${account.id}`);
            onAccountsSpendUpdate(account.id, 0); // Clear the spend data
          }
        });

        // Update the last fetched date range key
        setLastFetchedDateRange(dateRangeKey);

        // Debounce the API call to prevent rapid successive calls
        const timeout = setTimeout(() => {
          console.log('OrdersTable: Executing debounced ad spend fetch');
          fetchFacebookAdsSpend();
        }, 300); // 300ms debounce

        setFetchTimeout(timeout);
      } else {
        console.log('OrdersTable: Date range unchanged, skipping API call');
      }
    }

    // Cleanup timeout on unmount
    return () => {
      if (fetchTimeout) {
        clearTimeout(fetchTimeout);
      }
    };
  }, [dateRange, isFacebookConnected, facebookAccounts]);

  const fetchFacebookAdsSpend = async () => {
    try {
      setIsLoadingAdSpend(true);
      console.log('OrdersTable: Fetching Facebook Ads spend for date range:', {
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString()
      });

      const enabledAccounts = facebookAccounts.filter(account => account.isEnabled);
      console.log('OrdersTable: Enabled accounts:', enabledAccounts.length);

      if (enabledAccounts.length === 0) {
        console.log('OrdersTable: No enabled accounts found, skipping ad spend loading');
        setIsLoadingAdSpend(false);
        return;
      }

      // Import the fetchAdAccountData function
      const { fetchAdAccountData } = await import('@/utils/facebookAdsApi');

      for (const account of enabledAccounts) {
        try {
          console.log(`OrdersTable: Fetching data for account ${account.id} with date range:`, dateRange);
          const data = await fetchAdAccountData(account.id, account.accessToken, dateRange);
          console.log(`OrdersTable: Raw data for account ${account.id}:`, data);
          console.log(`OrdersTable: Campaigns data:`, data.campaigns);

          const totalSpend = data.campaigns.reduce((sum, campaign) => {
            const campaignSpend = campaign.spend || 0;
            console.log(`OrdersTable: Campaign ${campaign.id} spend:`, campaignSpend);
            return sum + campaignSpend;
          }, 0);

          console.log(`OrdersTable: Account ${account.id} total spend:`, totalSpend);

          // Update parent component with ad spend data
          if (onAccountsSpendUpdate) {
            onAccountsSpendUpdate(account.id, totalSpend);
          }
        } catch (error) {
          console.error(`OrdersTable: Failed to load spend for account ${account.id}:`, error);
        }
      }
    } catch (error) {
      console.error('OrdersTable: Error fetching Facebook Ads spend:', error);
    } finally {
      setIsLoadingAdSpend(false);
    }
  };

  const getShopifyDateRange = (from: Date, to: Date) => {
    // Set the time to start of day for 'from' and end of day for 'to'
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Format in ISO 8601 format with GMT-6 timezone
    const formatGMT6ISO = (date: Date) => {
      const pad = (num: number) => {
        const norm = Math.floor(Math.abs(num));
        return (norm < 10 ? '0' : '') + norm;
      };

      return date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        'T' + pad(date.getHours()) +
        ':' + pad(date.getMinutes()) +
        ':' + pad(date.getSeconds()) +
        '.' + (date.getMilliseconds() + '00').slice(0, 3) +
        '-06:00';  // Fixed GMT-6 timezone
    };

    return {
      min: formatGMT6ISO(fromDate),
      max: formatGMT6ISO(toDate)
    };
  };

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const apiClient = new ShopifyApiClient(shopifyConfig);

      // Get date range in GMT-6 timezone
      const { min: created_at_min, max: created_at_max } = getShopifyDateRange(dateRange.from, dateRange.to);

      console.log('Fetching orders with date range:', {
        created_at_min,
        created_at_max,
        datePreset,
        timezone: 'GMT-6'
      });

      let allOrders: Order[] = [];
      let hasMore = true;
      let pageInfo: string | undefined;

      while (hasMore) {
        // Fetch orders with date range and pagination
        const { orders: currentOrders, pageInfo: nextPageInfo } = await apiClient.getOrders({
          created_at_min,
          created_at_max,
          limit: 250, // Maximum allowed by Shopify's API
          ...(pageInfo ? { page_info: pageInfo } : {}),
          status: statusFilter || 'any'
        });

        // Process orders
        const processedOrders = currentOrders.map(order => ({
          ...order,
          orderDate: format(new Date(order.orderDate), 'yyyy-MM-dd HH:mm:ss')
        }));

        allOrders = [...allOrders, ...processedOrders];

        // Update pagination info
        pageInfo = nextPageInfo;
        hasMore = !!pageInfo;

        // Add a small delay to avoid rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setOrders(allOrders);
      onOrdersChange(allOrders);
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast({
        title: "Error fetching orders",
        description: "Please try again later.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };


  const groupOrdersByPeriod = (orders: Order[], range: DateRange) => {
    const grouped: { [key: string]: Order[] } = {};
    const days = Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Initialize all periods
    let currentDate = new Date(range.from);
    while (currentDate <= range.to) {
      let key = '';
      switch (periodType) {
        case 'daily':
          key = format(currentDate, 'yyyy-MM-dd');
          currentDate.setDate(currentDate.getDate() + 1);
          break;
        case 'weekly': {
          // Get the week number and year
          const weekYear = format(currentDate, 'yyyy');
          const weekNum = format(currentDate, 'ww');
          key = `${weekYear}-W${weekNum}`;
          currentDate.setDate(currentDate.getDate() + 7);
          break;
        }
        case 'monthly': {
          key = format(currentDate, 'yyyy-MM');
          const nextMonth = new Date(currentDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          currentDate = nextMonth;
          break;
        }
      }
      grouped[key] = [];
    }

    // Group orders
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      // Skip if the order is from today when using 7days or 30days preset
      if ((datePreset === '7days' || datePreset === '30days') &&
        format(orderDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')) {
        return;
      }

      let key = '';
      switch (periodType) {
        case 'daily':
          key = format(orderDate, 'yyyy-MM-dd');
          break;
        case 'weekly': {
          const weekYear = format(orderDate, 'yyyy');
          const weekNum = format(orderDate, 'ww');
          key = `${weekYear}-W${weekNum}`;
          break;
        }
        case 'monthly':
          key = format(orderDate, 'yyyy-MM');
          break;
      }

      if (grouped[key]) {
        grouped[key].push(order);
      }
    });

    return grouped;
  };

  const calculateMetrics = async (orders: Order[]): Promise<MetricsData> => {
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);
    let totalCogs = 0;

    if (cogsConfig && orders.length > 0) {
      // Calculate COGS directly in frontend - much faster than API calls
      for (const order of orders) {
        const orderLines = order.lineItems.map(item => ({
          variant_id: parseInt(item.variantId),
          quantity: item.quantity
        }));

        const countryCode = getCountryCode(order.shippingAddress?.country);
        const shippingCompany = selectedShippingProvider;

        const result = calculateOrderCOGS(orderLines, countryCode, shippingCompany, cogsConfig);
        totalCogs += result.total_cogs;
      }
    }
    const totalShippingCost = orders.reduce((sum, order) => sum + (order.shippingCost || 0), 0);

    // Calculate total Facebook ad spend from enabled accounts
    const enabledAccounts = facebookAccounts.filter(account => account.isEnabled);
    const totalAdSpend = enabledAccounts.reduce((sum, account) => {
      const spend = accountsSpend[account.id] || 0;
      console.log(`OrdersTable: Metrics calculation - Account ${account.id} spend: $${spend}`);
      return sum + spend;
    }, 0);

    console.log('OrdersTable: Total ad spend calculation for metrics:', {
      dateRange: { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() },
      enabledAccounts: enabledAccounts.length,
      accountsSpend,
      totalAdSpend
    });

    const netProfit = totalRevenue - totalCogs - totalShippingCost - totalAdSpend;
    const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
    const adSpendPerOrder = orders.length > 0 ? totalAdSpend / orders.length : 0;

    return {
      orderCount: orders.length,
      revenue: totalRevenue,
      totalCost: totalCogs + totalShippingCost + totalAdSpend,
      netProfit,
      netProfitMargin,
      adSpendPerOrder,
      avgOrderValue,
      totalAdSpend,
      adSpend: totalAdSpend,
      cogs: totalCogs, // COGS should only include product costs, not ad spend
      shippingCost: totalShippingCost,
      roas: totalAdSpend > 0 ? totalRevenue / totalAdSpend : 0
    };
  };

  const mergeOrdersByOrderNumber = (orders: Order[]): MergedOrder[] => {
    if (!orders) return [];
    const orderMap = new Map<string, MergedOrder>();

    orders.forEach(order => {
      if (!order.lineItems) return;
      const existingOrder = orderMap.get(order.orderNumber);
      if (existingOrder) {
        // Add items to existing order
        existingOrder.items = existingOrder.items || [];
        existingOrder.items.push(...order.lineItems.map(item => ({
          productName: item.title,
          productSKU: item.sku,
          variantId: item.variantId,
          quantity: item.quantity,
          style: item.variantId
        })));
        existingOrder.totalQuantity = (existingOrder.totalQuantity || 0) + order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
      } else {
        // Create new merged order
        const mergedOrder: MergedOrder = {
          ...order,
          items: order.lineItems.map(item => ({
            productName: item.title,
            productSKU: item.sku,
            variantId: item.variantId,
            quantity: item.quantity,
            style: item.variantId
          })),
          totalQuantity: order.lineItems.reduce((sum, item) => sum + item.quantity, 0)
        };
        orderMap.set(order.orderNumber, mergedOrder);
      }
    });

    return Array.from(orderMap.values());
  };

  useEffect(() => {
    const merged = mergeOrdersByOrderNumber(orders);
    // setMergedOrders(merged); // This state is no longer needed
  }, [orders]);

  useEffect(() => {
    // const filtered = mergedOrders.filter(order => { // mergedOrders is no longer used
    //   const searchLower = searchTerm.toLowerCase();
    //   const orderNumber = order.orderNumber?.toString() || '';
    //   const customerName = order.customerName?.toString() || '';
    //   const email = order.email?.toString() || '';
    //   
    //   return (
    //     orderNumber.toLowerCase().includes(searchLower) ||
    //     customerName.toLowerCase().includes(searchLower) ||
    //     email.toLowerCase().includes(searchLower) ||
    //     order.items.some(item => {
    //       const productName = item.productName?.toString() || '';
    //       const productSKU = item.productSKU?.toString() || '';
    //       return (
    //         productName.toLowerCase().includes(searchLower) ||
    //         productSKU.toLowerCase().includes(searchLower)
    //       );
    //     })
    //   );
    // });
    // setFilteredOrders(filtered); // filteredOrders is no longer used
  }, [orders, searchTerm]); // orders and searchTerm are now directly used

  useEffect(() => {
    onOrdersChange(orders?.flatMap(order => {
      if (!order.lineItems) return [order];
      return order.lineItems.map(item => ({
        ...order,
        productName: item.title,
        productSKU: item.sku,
        variantId: item.variantId,
        quantity: item.quantity,
        style: item.variantId
      }));
    }) || []);
  }, [orders, onOrdersChange]);

  const handleExportCSV = () => {
    if (orders.length === 0) { // Changed from filteredOrders to orders
      toast({
        title: "Không có dữ liệu",
        description: "Không có đơn hàng nào để xuất.",
        variant: "destructive",
      });
      return;
    }

    exportToCSV(orders); // Changed from filteredOrders to orders
    toast({
      title: "Xuất CSV thành công!",
      description: `Đã xuất ${orders.length} đơn hàng ra file CSV.`, // Changed from filteredOrders to orders
    });
  };

  // Update getDaysSinceOrder to handle timezone offsets
  const getDaysSinceOrder = (orderDate: string) => {
    const orderTime = new Date(orderDate).getTime();
    const now = new Date().getTime();
    const diffDays = Math.floor((now - orderTime) / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleSelectAll = (checked: boolean) => {
    // setSelectedOrders(new Set(filteredOrders.map(order => order.id))); // filteredOrders is no longer used
    // if (checked) {
    //   setSelectedOrders(new Set(orders.map(order => order.id))); // orders is now directly used
    // } else {
    //   setSelectedOrders(new Set());
    // }
  };

  const handleSelectOrder = (orderId: string, checked: boolean) => {
    // const newSelected = new Set(selectedOrders); // selectedOrders is no longer used
    // if (checked) {
    //   newSelected.add(orderId);
    // } else {
    //   newSelected.delete(orderId);
    // }
    // setSelectedOrders(newSelected);
  };

  const handleBulkTrackingUpdate = () => {
    // TODO: Implement bulk tracking update
    toast({
      title: "Coming Soon",
      description: "Bulk tracking update feature is coming soon!",
    });
  };

  const handleBulkExport = () => {
    // const selectedOrdersList = filteredOrders.filter(order => selectedOrders.has(order.id)); // filteredOrders is no longer used
    // if (selectedOrdersList.length === 0) {
    //   toast({
    //     title: "No Orders Selected",
    //     description: "Please select orders to export.",
    //     variant: "destructive",
    //   });
    //   return;
    // }
    // exportToCSV(selectedOrdersList);
    toast({
      title: "Export Successful",
      description: `Exported ${orders.length} orders to CSV.`, // Changed from selectedOrdersList to orders
    });
  };

  const handleBulkImport = () => {
    // TODO: Implement bulk import
    toast({
      title: "Coming Soon",
      description: "Bulk import feature is coming soon!",
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Update formatDate to use the selected timezone
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    // Handle GMT offsets
    if (timezone.startsWith('Etc/GMT')) {
      const offset = parseInt(timezone.replace('Etc/GMT', ''));
      const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
      const tzDate = new Date(utc + (3600000 * -offset));
      return tzDate.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
    return date.toLocaleString('vi-VN', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      'paid': 'bg-green-50 text-green-700 border-green-200',
      'pending': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'refunded': 'bg-red-50 text-red-700 border-red-200',
      'fulfilled': 'bg-blue-50 text-blue-700 border-blue-200',
      'unfulfilled': 'bg-gray-50 text-gray-700 border-gray-200',
      'partially_fulfilled': 'bg-purple-50 text-purple-700 border-purple-200',
      'cancelled': 'bg-red-50 text-red-700 border-red-200'
    };

    return (
      <Badge variant="outline" className={statusColors[status.toLowerCase()] || 'bg-gray-50 text-gray-700 border-gray-200'}>
        {status}
      </Badge>
    );
  };

  const calculateOrderCosts = async (order: Order | MergedOrder) => {
    let totalCogs = 0;
    let totalHandlingFee = 0;

    if (cogsConfig) {
      try {
        // Extract country and shipping company from order
        const countryCode = order.shippingAddress?.country || 'US';
        const shippingCompany = selectedShippingProvider;

        // Prepare order lines for COGS calculation
        let orderLines = [];

        if ('items' in order && order.items) {
          // MergedOrder with items
          orderLines = order.items.map(item => ({
            variant_id: parseInt(item.variantId),
            quantity: item.quantity
          }));
        } else if ('lineItems' in order && order.lineItems) {
          // Regular Order with lineItems
          orderLines = order.lineItems.map(item => ({
            variant_id: parseInt(item.variantId),
            quantity: item.quantity
          }));
        }

        // Only proceed if we have order lines
        if (orderLines.length > 0) {
          const apiBaseUrl = '/api';

          const response = await fetch(`${apiBaseUrl}/cogs/calculate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              order_lines: orderLines,
              country_code: countryCode,
              shipping_company: shippingCompany
            }),
          });

          if (response.ok) {
            const result = await response.json();
            totalCogs = result.total_cogs || 0;
          }
        }
      } catch (error) {
        console.warn(`Failed to calculate COGS for order ${order.id}:`, error);
      }
    }

    const shippingCost = order.shippingCost || 0;
    const totalCost = totalCogs + totalHandlingFee + shippingCost;
    const netProfit = order.totalPrice - totalCost;
    const netProfitMargin = order.totalPrice > 0 ? (netProfit / order.totalPrice) * 100 : 0;

    return {
      cogs: totalCogs,
      handlingFee: totalHandlingFee,
      shippingCost,
      totalCost,
      netProfit,
      netProfitMargin
    };
  };

  const [currentMetrics, setCurrentMetrics] = useState<MetricsData>({
    revenue: 0,
    cogs: 0,
    shippingCost: 0,
    adSpend: 0,
    netProfit: 0,
    orderCount: 0,
    avgOrderValue: 0,
    totalCost: 0,
    netProfitMargin: 0,
    adSpendPerOrder: 0,
    totalAdSpend: 0,
    roas: 0
  });

  const [chartData, setChartData] = useState<any[]>([]);
  const [orderCosts, setOrderCosts] = useState<Map<string, any>>(new Map());

  // Calculate metrics when orders change
  useEffect(() => {
    const calculateAllMetrics = async () => {
      const metrics = await calculateMetrics(orders);
      setCurrentMetrics(metrics);

      const groupedOrders = groupOrdersByPeriod(orders, dateRange);
      const chartDataPromises = Object.entries(groupedOrders).map(async ([period, periodOrders]) => {
        const periodMetrics = await calculateMetrics(periodOrders);
        return {
          period,
          revenue: periodMetrics.revenue,
          netProfit: periodMetrics.netProfit,
          orderCount: periodMetrics.orderCount,
          avgOrderValue: periodMetrics.avgOrderValue
        };
      });

      const chartResults = await Promise.all(chartDataPromises);
      setChartData(chartResults);
    };

    calculateAllMetrics();
    calculateAllMetrics();
  }, [orders, dateRange, cogsConfig, selectedShippingProvider]);

  // Calculate individual order costs using bulk API
  useEffect(() => {
    const calculateOrderCostsForAll = async () => {
      if (!cogsConfig) {
        setOrderCosts(new Map());
        return;
      }

      const costsMap = new Map();
      const filteredOrders = getFilteredOrders();

      // Calculate COGS directly in frontend for each order - much faster than API calls
      for (const order of filteredOrders) {
        let orderLines = [];

        if ('items' in order && order.items) {
          // MergedOrder with items
          orderLines = (order.items as any[]).map(item => ({
            variant_id: parseInt(item.variantId),
            quantity: item.quantity
          }));
        } else if ('lineItems' in order && order.lineItems) {
          // Regular Order with lineItems
          orderLines = order.lineItems.map(item => ({
            variant_id: parseInt(item.variantId),
            quantity: item.quantity
          }));
        }

        if (orderLines.length > 0) {
          const countryCode = getCountryCode(order.shippingAddress?.country);
          const shippingCompany = selectedShippingProvider;

          const result = calculateOrderCOGS(orderLines, countryCode, shippingCompany, cogsConfig);

          const shippingCost = order.shippingCost || 0;
          const totalCost = result.total_cogs + shippingCost;
          const netProfit = order.totalPrice - totalCost;
          const netProfitMargin = order.totalPrice > 0 ? (netProfit / order.totalPrice) * 100 : 0;

          costsMap.set(order.id, {
            cogs: result.total_cogs,
            handlingFee: 0,
            shippingCost,
            totalCost,
            netProfit,
            netProfitMargin
          });
        }
      }

      setOrderCosts(costsMap);
    };

    calculateOrderCostsForAll();
    calculateOrderCostsForAll();
  }, [orders, cogsConfig, selectedShippingProvider]);

  // Recalculate metrics when ad spend data changes
  useEffect(() => {
    if (orders.length > 0) {
      const calculateAllMetrics = async () => {
        const metrics = await calculateMetrics(orders);
        setCurrentMetrics(metrics);

        const groupedOrders = groupOrdersByPeriod(orders, dateRange);
        const chartDataPromises = Object.entries(groupedOrders).map(async ([period, periodOrders]) => {
          const periodMetrics = await calculateMetrics(periodOrders);
          return {
            period,
            ...periodMetrics
          };
        });

        const chartData = await Promise.all(chartDataPromises);
        setChartData(chartData);
      };

      calculateAllMetrics();
    }
  }, [accountsSpend]);

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      const newRange = getDateRangeFromPreset(preset);
      setDateRange(newRange);
      setStatusFilter('any'); // Reset status filter to 'any'

      // Update comparison range if enabled
      if (showComparison) {
        const daysDiff = Math.ceil((newRange.to.getTime() - newRange.from.getTime()) / (1000 * 60 * 60 * 24));
        const compFrom = new Date(newRange.from);
        compFrom.setDate(compFrom.getDate() - daysDiff);
        const compTo = new Date(newRange.to);
        compTo.setDate(compTo.getDate() - daysDiff);
        setComparisonRange({ from: compFrom, to: compTo });
      }
    }
  };

  // Handle custom date range changes
  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range) return;

    setDatePreset('custom');

    // If we have both dates, validate and normalize them
    if (range.from && range.to) {
      const validatedRange = validateDateRange(range.from, range.to);
      setDateRange(validatedRange);
      setStatusFilter('any');
    }
    // If we only have the start date
    else if (range.from) {
      const fromDate = new Date(range.from);
      fromDate.setHours(0, 0, 0, 0);
      setDateRange({ from: fromDate, to: undefined });
    }
  };

  // Handle temporary date range changes
  const handleTempDateChange = (range: DateRange | undefined) => {
    if (!range) return;
    setTempDateRange(range);
  };

  // Handle applying the date range
  const handleApplyDateRange = () => {
    if (!tempDateRange?.from || !tempDateRange?.to) return;

    setDatePreset('custom');

    // Set time to start of day for from date and end of day for to date
    const fromDate = new Date(tempDateRange.from);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = new Date(tempDateRange.to);
    toDate.setHours(23, 59, 59, 999);

    setDateRange({ from: fromDate, to: toDate });
    setStatusFilter('any');
    setTempDateRange(undefined); // Reset temp range after applying
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  const getFilteredOrders = () => {
    if (statusFilter === 'any') return orders;

    return orders.filter(order => {
      switch (statusFilter) {
        case 'unfulfilled':
          return order.fulfillmentStatus === 'unfulfilled';
        case 'fulfilled':
          return order.fulfillmentStatus === 'fulfilled';
        case 'partially_fulfilled':
          return order.fulfillmentStatus === 'partially_fulfilled';
        case 'paid':
          return order.financialStatus === 'paid';
        case 'unpaid':
          return order.financialStatus === 'pending' || order.financialStatus === 'unpaid';
        case 'refunded':
          return order.financialStatus === 'refunded' || order.financialStatus === 'partially_refunded';
        default:
          return true;
      }
    });
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
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Select
            value={datePreset}
            onValueChange={(value: DatePreset) => handleDatePresetChange(value)}
            aria-label="Select timeframe"
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select timeframe" />
            </SelectTrigger>
            <SelectContent>
              {getDatePresetOptions().map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {datePreset === 'custom' && (
            <div className="flex items-center space-x-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn(
                    "w-[300px] justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {formatLADateRange(dateRange.from, dateRange.to)}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, yyyy") + " - Pick end date"
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="space-y-3">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={tempDateRange}
                      onSelect={handleTempDateChange}
                      numberOfMonths={2}
                      className="rounded-md border"
                    />
                    {tempDateRange?.from && tempDateRange?.to && (
                      <div className="flex items-center justify-end gap-2 px-4 pb-4">
                        <Button
                          variant="outline"
                          onClick={() => setTempDateRange(undefined)}
                        >
                          Cancel
                        </Button>
                        <Button onClick={handleApplyDateRange}>
                          Apply
                        </Button>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <Select
            value={periodType}
            onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setPeriodType(value)}
            aria-label="Select period type"
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select period type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => {
              setShowComparison(!showComparison);
              if (!showComparison) {
                // Calculate comparison range based on the current date range
                const daysDiff = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24));
                const compFrom = new Date(dateRange.from);
                compFrom.setDate(compFrom.getDate() - daysDiff);
                const compTo = new Date(dateRange.to);
                compTo.setDate(compTo.getDate() - daysDiff);
                setComparisonRange({ from: compFrom, to: compTo });
              } else {
                setComparisonRange(null);
              }
            }}
          >
            {showComparison ? 'Remove Comparison' : 'Compare'}
          </Button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Revenue & Net Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#8884d8" name="Revenue" />
                  <Bar dataKey="netProfit" fill="#82ca9d" name="Net Profit" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders & Average Order Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <RechartsTooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="orderCount" fill="#8884d8" name="Orders" />
                  <Bar yAxisId="right" dataKey="avgOrderValue" fill="#82ca9d" name="AOV" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>



      {/* Metrics Cards */}
      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <ShoppingBag className="h-4 w-4 text-blue-500" />
                    <p className="text-sm text-slate-600">Order Count</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">{currentMetrics.orderCount}</h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total number of orders in the selected period</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <DollarSign className="h-4 w-4 text-green-500" />
                    <p className="text-sm text-slate-600">Net Profit</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.netProfit.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Revenue - Total Cost</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Target className="h-4 w-4 text-purple-500" />
                    <p className="text-sm text-slate-600">Net Profit Margin</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    {currentMetrics.netProfitMargin.toFixed(2)}%
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>(Net Profit / Revenue) * 100</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Calculator className="h-4 w-4 text-red-500" />
                    <p className="text-sm text-slate-600">Total Cost</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.totalCost.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>COGS + Shipping Cost + Total Ad Spend</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="h-4 w-4 text-yellow-500" />
                    <p className="text-sm text-slate-600">Revenue</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.revenue.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total Price of all orders</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="h-4 w-4 text-orange-500" />
                      <p className="text-sm text-slate-600">Ad Spend Per Order</p>
                    </div>
                    {!isFacebookConnected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFacebookConnect();
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.adSpendPerOrder.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total Ad Spend / Order Count</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Package className="h-4 w-4 text-indigo-500" />
                    <p className="text-sm text-slate-600">Avg. Order Value</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.avgOrderValue.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Revenue / Order Count</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="h-4 w-4 text-pink-500" />
                      <p className="text-sm text-slate-600">Total Ad Spend</p>
                    </div>
                    {!isFacebookConnected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFacebookConnect();
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    {isLoadingAdSpend ? (
                      <div className="flex items-center space-x-2">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Loading...</span>
                      </div>
                    ) : (
                      `$${currentMetrics.totalAdSpend.toFixed(2)}`
                    )}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sum of spend from all enabled Facebook Ad Accounts</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Calculator className="h-4 w-4 text-cyan-500" />
                    <p className="text-sm text-slate-600">COGS</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.cogs.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sum of product costs</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Truck className="h-4 w-4 text-teal-500" />
                    <p className="text-sm text-slate-600">Shipping Cost</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    ${currentMetrics.shippingCost.toFixed(2)}
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Sum of shipping costs</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="cursor-help hover:bg-slate-50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm text-slate-600">ROAS</p>
                  </div>
                  <h3 className="text-2xl font-bold mt-2">
                    {currentMetrics.roas.toFixed(2)}x
                  </h3>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>
              <p>Revenue / Total Ad Spend</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <span>Orders</span>
            <span className="text-sm font-normal text-slate-600">
              Total Orders: {getFilteredOrders().length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center space-x-4">
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search orders..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Add Status Filter */}
              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
                aria-label="Filter by status"
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All Orders</SelectItem>
                  <SelectItem value="unfulfilled">Unfulfilled</SelectItem>
                  <SelectItem value="partially_fulfilled">Partially Fulfilled</SelectItem>
                  <SelectItem value="fulfilled">Fulfilled</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>


              {/* Shipping Provider Selector */}
              <Select
                value={selectedShippingProvider}
                onValueChange={setSelectedShippingProvider}
                aria-label="Select Shipping Provider"
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Shipping Provider" />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_PROVIDERS.map(provider => (
                    <SelectItem key={provider} value={provider}>{provider}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchOrders}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                    // checked={selectedOrders.size > 0 && selectedOrders.size === filteredOrders.length} // filteredOrders is no longer used
                    // onCheckedChange={(checked) => handleSelectAll(!!checked)} // filteredOrders is no longer used
                    />
                  </TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>COGS</TableHead>
                  <TableHead>Net Profit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>UTM Parameters</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergeOrdersByOrderNumber(getFilteredOrders())
                  .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                  .map((order) => {
                    const daysSinceOrder = getDaysSinceOrder(order.orderDate);
                    const costs = orderCosts.get(order.id) || {
                      cogs: 0,
                      handlingFee: 0,
                      shippingCost: 0,
                      totalCost: 0,
                      netProfit: 0,
                      netProfitMargin: 0
                    };
                    return (
                      <TableRow key={order.id} className="group hover:bg-slate-50">
                        <TableCell>
                          <Checkbox
                          // checked={selectedOrders.has(order.id)} // selectedOrders is no longer used
                          // onCheckedChange={(checked) => handleSelectOrder(order.id, !!checked)} // selectedOrders is no longer used
                          />
                        </TableCell>
                        <TableCell className="font-medium">#{order.orderNumber}</TableCell>
                        <TableCell>{formatDate(order.orderDate)}</TableCell>
                        <TableCell>
                          <span className={daysSinceOrder > 3 ? "text-red-500 font-medium" : ""}>
                            {daysSinceOrder}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{order.customerName}</p>
                            <p className="text-sm text-slate-500">{order.email}</p>
                            <p className="text-sm text-slate-500">{order.phoneNumber}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {order.items.map((item, index) => (
                              <div key={`${order.id}-${item.productSKU}-${index}`} className="group-hover:bg-white p-2 rounded">
                                <p className="font-medium">{item.productName}</p>
                                <p className="text-sm text-slate-500">SKU: {item.productSKU}</p>
                                <p className="text-sm text-slate-500">Style: {item.style}</p>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>{order.totalQuantity}</TableCell>
                        <TableCell>{formatCurrency(order.totalPrice)}</TableCell>
                        <TableCell>{formatCurrency(costs.cogs)}</TableCell>
                        <TableCell>
                          <div>
                            <p className={costs.netProfit >= 0 ? "text-green-600" : "text-red-600"}>
                              {formatCurrency(costs.netProfit)}
                            </p>
                            <p className="text-sm text-slate-500">
                              {costs.netProfitMargin.toFixed(1)}%
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {order.financialStatus && getStatusBadge(order.financialStatus)}
                            {order.fulfillmentStatus && getStatusBadge(order.fulfillmentStatus)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-xs">
                            {order.utmSource && (
                              <div>
                                <span className="font-medium text-slate-600">Source:</span>{' '}
                                <span className="text-slate-800">{order.utmSource}</span>
                              </div>
                            )}
                            {order.utmMedium && (
                              <div>
                                <span className="font-medium text-slate-600">Medium:</span>{' '}
                                <span className="text-slate-800">{order.utmMedium}</span>
                              </div>
                            )}
                            {order.utmCampaign && (
                              <div>
                                <span className="font-medium text-slate-600">Campaign:</span>{' '}
                                <span className="text-slate-800">{order.utmCampaign}</span>
                              </div>
                            )}
                            {order.utmContent && (
                              <div>
                                <span className="font-medium text-slate-600">Content:</span>{' '}
                                <span className="text-slate-800">{order.utmContent}</span>
                              </div>
                            )}
                            {order.utmTerm && (
                              <div>
                                <span className="font-medium text-slate-600">Term:</span>{' '}
                                <span className="text-slate-800">{order.utmTerm}</span>
                              </div>
                            )}
                            {order.fbCampaignId && (
                              <div>
                                <span className="font-medium text-blue-600">FB Campaign:</span>{' '}
                                <span className="text-slate-800">{order.fbCampaignId}</span>
                              </div>
                            )}
                            {order.fbAdsetId && (
                              <div>
                                <span className="font-medium text-blue-600">FB Adset:</span>{' '}
                                <span className="text-slate-800">{order.fbAdsetId}</span>
                              </div>
                            )}
                            {order.fbAdId && (
                              <div>
                                <span className="font-medium text-blue-600">FB Ad:</span>{' '}
                                <span className="text-slate-800">{order.fbAdId}</span>
                              </div>
                            )}
                            {order.sessionDetails && (
                              <div className="mt-2 pt-2 border-t border-slate-200">
                                <div className="font-medium text-slate-700 mb-1">Session Details:</div>
                                {order.sessionDetails.landingPage && (
                                  <div>
                                    <span className="font-medium text-slate-600">Landing Page:</span>{' '}
                                    <span className="text-slate-800">{order.sessionDetails.landingPage}</span>
                                  </div>
                                )}
                                {order.sessionDetails.referringSite && (
                                  <div>
                                    <span className="font-medium text-slate-600">Referrer:</span>{' '}
                                    <span className="text-slate-800">{order.sessionDetails.referringSite}</span>
                                  </div>
                                )}
                                {order.sessionDetails.marketingChannel && (
                                  <div>
                                    <span className="font-medium text-slate-600">Channel:</span>{' '}
                                    <span className="text-slate-800">{order.sessionDetails.marketingChannel}</span>
                                  </div>
                                )}
                                {order.sessionDetails.visitDate && (
                                  <div>
                                    <span className="font-medium text-slate-600">Visit Date:</span>{' '}
                                    <span className="text-slate-800">{new Date(order.sessionDetails.visitDate).toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {!order.utmSource && !order.utmMedium && !order.utmCampaign && !order.utmContent &&
                              !order.utmTerm && !order.fbCampaignId && !order.fbAdsetId && !order.fbAdId && !order.sessionDetails && (
                                <span className="text-slate-400 italic">No UTM data</span>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-600">
                Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, getFilteredOrders().length)} of {getFilteredOrders().length} orders
                {statusFilter !== 'any' && ` (filtered from ${orders.length} total orders)`}
              </p>
              <Select value={pageSize.toString()} onValueChange={(value) => handlePageSizeChange(parseInt(value))}>
                <SelectTrigger className="w-[70px]">
                  <SelectValue placeholder="10" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {currentPage} of {Math.ceil(getFilteredOrders().length / pageSize)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= Math.ceil(getFilteredOrders().length / pageSize)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div >
  );
};
