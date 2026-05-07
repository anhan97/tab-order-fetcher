import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
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
import { detectShippingCompany } from '@/utils/trackingUtils';
import { ShopifyApiClient, OrderFilters } from '@/utils/shopifyApi';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { cn } from '@/lib/utils';
import { FacebookAdAccount } from '@/types/facebook';
import { DashboardInsights } from '@/components/DashboardInsights';
import { useAppContext } from '@/context/AppContext';
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
  // Mapping version — bumps when CampaignStoreMapping changes; we re-fetch
  // mapped fbAdSpend so the KPI strip reflects the new mapping without F5.
  const { mappingVersion } = useAppContext();

  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  // Map of shopifyOrderId → payment fee (from Shopify Payments balance API).
  // Keyed by string because Shopify order IDs are very large numbers.
  const [orderFees, setOrderFees] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>('any');
  // Default to today — matches dashboards/P&L. Old "30 days" default surfaced
  // a 30-day total ad spend that confused users on first load.
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeFromPreset('today', timezone));
  // Store-mapped ad spend for the active range. Single source-of-truth =
  // /api/pl which sums spend across CampaignStoreMapping rows for the
  // resolved store. Replaces the per-account `accountsSpend` sum which
  // included unmapped campaigns and didn't match the P&L numbers.
  const [mappedAdSpend, setMappedAdSpend] = useState<number>(0);
  const [comparisonRange, setComparisonRange] = useState<DateRange | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [periodType, setPeriodType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();
  const [selectedShippingProvider, setSelectedShippingProvider] = useState<string>('YunTu');
  const [shippingCompanies, setShippingCompanies] = useState<any[]>([]);
  const SHIPPING_PROVIDERS = ['YunTu', 'Shengtu Logistics', 'Yuanpeng Logistics'];

  // Load shipping companies
  useEffect(() => {
    const loadShippingCompanies = async () => {
      try {
        const response = await fetch('/api/cogs/shipping-companies');
        if (response.ok) {
          const data = await response.json();
          setShippingCompanies(data);
        }
      } catch (error) {
        console.error('Failed to load shipping companies:', error);
      }
    };
    loadShippingCompanies();
  }, []);

  // Add state for temporary date range
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(undefined);

  // Sync with global date range when provided
  useEffect(() => {
    if (globalDateRange) {
      setDateRange(globalDateRange);
    }
  }, [globalDateRange]);

  // Re-anchor preset windows when timezone changes — without this, "Last 30
  // days" computed in GMT-6 keeps its boundaries even after switching to LA.
  useEffect(() => {
    if (datePreset !== 'custom') {
      setDateRange(getDateRangeFromPreset(datePreset, timezone));
    }
  }, [timezone]);

  useEffect(() => {
    fetchOrders();
  }, [shopifyConfig, dateRange, comparisonRange, timezone, statusFilter]);

  // Pull payment fees from our DB whenever the date range changes. Failure is
  // non-fatal — Fees column simply renders $0 for orders we don't have data on.
  useEffect(() => {
    if (!shopifyConfig?.storeUrl || !shopifyConfig?.accessToken) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({
          from: new Date(dateRange.from.getFullYear(), dateRange.from.getMonth(), dateRange.from.getDate()).toISOString(),
          to: new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate() + 1).toISOString()
        });
        const res = await fetch(`/api/pl/order-fees?${params}`, {
          headers: {
            'X-Shopify-Store-Domain': shopifyConfig.storeUrl,
            'X-Shopify-Access-Token': shopifyConfig.accessToken
          },
          signal: ctrl.signal
        });
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, number> = {};
        for (const [orderId, info] of Object.entries(data.fees || {})) {
          map[orderId] = (info as any).fee || 0;
        }
        setOrderFees(map);
      } catch (e) {
        if ((e as any)?.name !== 'AbortError') console.warn('Failed to load order fees:', e);
      }
    })();
    return () => ctrl.abort();
  }, [shopifyConfig, dateRange]);

  const [isLoadingAdSpend, setIsLoadingAdSpend] = useState(false);

  // Fetch the STORE-MAPPED ad spend for the active date range from /api/pl.
  //
  // Why /api/pl instead of FB SDK directly:
  //   - /api/pl filters by CampaignStoreMapping for THIS store — orders here
  //     belong to one store, so spend should too. Per-account sum from the
  //     FB SDK includes campaigns running for OTHER stores → inflates KPIs.
  //   - Same backend cache (5min today / tiered older) as ProfitView and
  //     Analytics page → identical numbers across views.
  //   - Removes the legacy /api/pl/sync-fb call which 404'd after the
  //     basecost-redesign dropped FacebookAdSpend.
  useEffect(() => {
    if (!shopifyConfig?.storeUrl || !shopifyConfig?.accessToken) return;
    const ctrl = new AbortController();
    setIsLoadingAdSpend(true);
    (async () => {
      try {
        const headers = {
          'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
          'X-Shopify-Access-Token': shopifyConfig.accessToken,
          ...(timezone ? { 'X-Tz': timezone } : {})
        };
        // Decide: today endpoint (live, memo 5min) for single-day TODAY;
        // /daily otherwise (sums historical snapshots + merges live today
        // when today is in range).
        const dayMs = 24 * 3600_000;
        const isSingleToday = (() => {
          const now = Date.now();
          const fromDay = Math.floor(dateRange.from.getTime() / dayMs);
          const toDay = Math.floor(dateRange.to.getTime() / dayMs);
          const todayDay = Math.floor(now / dayMs);
          return fromDay === todayDay && toDay === todayDay;
        })();

        let total = 0;
        if (isSingleToday) {
          const res = await fetch('/api/pl/today', { headers, signal: ctrl.signal });
          if (res.ok) {
            const j = await res.json();
            total = j?.breakdown?.fbAdSpend || 0;
          }
        } else {
          const q = new URLSearchParams({
            from: dateRange.from.toISOString(),
            to: dateRange.to.toISOString()
          });
          const res = await fetch(`/api/pl/daily?${q}`, { headers, signal: ctrl.signal });
          if (res.ok) {
            const j = await res.json();
            total = (j?.snapshots || []).reduce((s: number, row: any) => {
              const v = typeof row.fbAdSpend === 'number' ? row.fbAdSpend : parseFloat(row.fbAdSpend || '0');
              return s + (Number.isFinite(v) ? v : 0);
            }, 0);
          }
        }
        setMappedAdSpend(total);
      } catch (e) {
        if ((e as any)?.name !== 'AbortError') {
          console.warn('OrdersTable: mapped ad spend fetch failed:', (e as Error).message);
          setMappedAdSpend(0);
        }
      } finally {
        setIsLoadingAdSpend(false);
      }
    })();
    return () => ctrl.abort();
  }, [shopifyConfig?.storeUrl, shopifyConfig?.accessToken, dateRange, timezone, mappingVersion]);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const apiClient = new ShopifyApiClient(shopifyConfig);

      // dateRange is already a UTC instant pair anchored to the user's tz day
      // boundaries (set up in getDateRangeFromPreset / validateDateRange);
      // Shopify accepts ISO timestamps with offset, so just serialize.
      const { min: created_at_min, max: created_at_max } = getShopifyDateRange(dateRange.from, dateRange.to);

      console.log('Fetching orders with date range:', {
        created_at_min,
        created_at_max,
        datePreset,
        timezone
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

        // Keep the original ISO timestamp from Shopify — the UI re-formats
        // it in the user's tz at render time. Pre-formatting here would
        // discard the timezone info and the displayed day could drift.
        const processedOrders = currentOrders;

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

    // Initialize all periods using the user's tz so day boundaries match
    // the rest of the app and the underlying Shopify store calendar.
    let currentDate = new Date(range.from);
    while (currentDate <= range.to) {
      let key = '';
      switch (periodType) {
        case 'daily':
          key = formatInTimeZone(currentDate, timezone, 'yyyy-MM-dd');
          currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'weekly': {
          const weekYear = formatInTimeZone(currentDate, timezone, 'yyyy');
          const weekNum = formatInTimeZone(currentDate, timezone, 'ww');
          key = `${weekYear}-W${weekNum}`;
          currentDate = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        }
        case 'monthly': {
          key = formatInTimeZone(currentDate, timezone, 'yyyy-MM');
          const nextMonth = new Date(currentDate);
          nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
          currentDate = nextMonth;
          break;
        }
      }
      grouped[key] = [];
    }

    // Group orders by their calendar day in the user's tz, NOT the browser's
    // local tz — otherwise an order placed at 23:30 LA on May 2 shows up
    // under May 3 for a Vietnam-based browser.
    const todayKey = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      // Skip if the order is from today when using 7days or 30days preset
      if ((datePreset === '7days' || datePreset === '30days') &&
        formatInTimeZone(orderDate, timezone, 'yyyy-MM-dd') === todayKey) {
        return;
      }

      let key = '';
      switch (periodType) {
        case 'daily':
          key = formatInTimeZone(orderDate, timezone, 'yyyy-MM-dd');
          break;
        case 'weekly': {
          const weekYear = formatInTimeZone(orderDate, timezone, 'yyyy');
          const weekNum = formatInTimeZone(orderDate, timezone, 'ww');
          key = `${weekYear}-W${weekNum}`;
          break;
        }
        case 'monthly':
          key = formatInTimeZone(orderDate, timezone, 'yyyy-MM');
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

        // Try to auto-detect shipping company from tracking number
        let shippingCompany = selectedShippingProvider;
        const trackingNumber = order.fulfillmentStatus === 'fulfilled' && order.trackingNumber ? order.trackingNumber : null;

        if (trackingNumber) {
          const detected = detectShippingCompany(trackingNumber, shippingCompanies);
          if (detected) {
            shippingCompany = detected;
          }
        }

        const result = calculateOrderCOGS(orderLines, countryCode, shippingCompany, cogsConfig);
        totalCogs += result.total_cogs;
      }
    }
    const totalShippingCost = orders.reduce((sum, order) => sum + (order.shippingCost || 0), 0);

    // Total Ad Spend = mapped campaign spend for this store, sourced from
    // /api/pl (same as ProfitView + Analytics). NOT the per-account sum of
    // accountsSpend, which is account-wide and would include campaigns
    // running for OTHER stores sharing the same FB ad account.
    const totalAdSpend = mappedAdSpend;

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

  // Single tz-aware formatter for both IANA names (America/Los_Angeles) and
  // fixed offsets (Etc/GMT+6). formatInTimeZone handles both correctly.
  const formatDate = (dateString: string) => {
    return formatInTimeZone(new Date(dateString), timezone, 'dd/MM/yyyy HH:mm');
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

        // Try to auto-detect shipping company from tracking number
        let shippingCompany = selectedShippingProvider;
        // Handle both Order and MergedOrder types for tracking number
        const trackingNumber = 'trackingNumber' in order ? order.trackingNumber : null;

        if (trackingNumber) {
          const detected = detectShippingCompany(trackingNumber, shippingCompanies);
          if (detected) {
            shippingCompany = detected;
          }
        }

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
  }, [orders, dateRange, cogsConfig, selectedShippingProvider, shippingCompanies]);

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

          // Try to auto-detect shipping company from tracking number
          let shippingCompany = selectedShippingProvider;
          const trackingNumber = 'trackingNumber' in order ? order.trackingNumber : null;

          if (trackingNumber) {
            const detected = detectShippingCompany(trackingNumber, shippingCompanies);
            if (detected) {
              shippingCompany = detected;
              console.log(`[COGS Debug] Order ${order.orderNumber}: Detected shipping company '${detected}' from tracking '${trackingNumber}'`);
            } else {
              console.log(`[COGS Debug] Order ${order.orderNumber}: Failed to detect shipping company from tracking '${trackingNumber}'. Available companies:`, shippingCompanies);
            }
          } else {
            // console.log(`[COGS Debug] Order ${order.orderNumber}: No tracking number found.`);
          }

          const result = calculateOrderCOGS(orderLines, countryCode, shippingCompany, cogsConfig);

          if (result.total_cogs === 0 && orderLines.length > 0) {
            console.log(`[COGS Debug] Order ${order.orderNumber}: COGS is 0. Inputs:`, {
              countryCode,
              shippingCompany,
              orderLines,
              // cogsConfig: '...' // Don't log full config
            });
          }

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
  }, [orders, cogsConfig, selectedShippingProvider, shippingCompanies]);

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
    // Recompute KPIs whenever the store-mapped ad spend changes. accountsSpend
    // is no longer the source of truth for Total Ad Spend, but legacy
    // per-account state may still drive other inner widgets — keep it as an
    // additional trigger so those refresh in lockstep.
  }, [accountsSpend, mappedAdSpend]);

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      const newRange = getDateRangeFromPreset(preset, timezone);
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
      const validatedRange = validateDateRange(range.from, range.to, timezone);
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

    // Anchor day bounds in the user's tz, not the browser's local tz
    const validated = validateDateRange(tempDateRange.from, tempDateRange.to, timezone);
    setDateRange(validated);
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
                          {formatLADateRange(dateRange.from, dateRange.to, timezone)}
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

      {/* Metrics Cards — moved to top of dashboard so the most-watched
          numbers are above the fold. Trend charts live below the table. */}
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

      {/* Insight Pack — margin %, refund rate, repeat customer, top products & countries */}
      <DashboardInsights
        orders={getFilteredOrders()}
        revenue={currentMetrics.revenue}
        netProfit={currentMetrics.netProfit}
        totalFees={Object.values(orderFees).reduce((s, v) => s + (v || 0), 0)}
      />

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
                  <TableHead>Fees</TableHead>
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
                        <TableCell className="text-purple-700">
                          {formatCurrency(orderFees[String(order.id)] || 0)}
                        </TableCell>
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

      {/* Trend charts — pushed below the orders table because they're for
          spotting trends after you've scanned the headline KPIs. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Revenue & Net Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <RechartsTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} name="Revenue" />
                  <Line type="monotone" dataKey="netProfit" stroke="#82ca9d" strokeWidth={2} name="Net Profit" />
                </LineChart>
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
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <RechartsTooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="orderCount" stroke="#8884d8" strokeWidth={2} name="Orders" />
                  <Line yAxisId="right" type="monotone" dataKey="avgOrderValue" stroke="#82ca9d" strokeWidth={2} name="AOV" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div >
  );
};
