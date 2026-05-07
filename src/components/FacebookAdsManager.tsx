import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Settings, Loader2, AlertCircle, ArrowUpDown, GripVertical, Search, Plus, Copy, Edit, Beaker, X, RefreshCw, Pause, Play, Download, Filter as FilterIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/ui/status-pill';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateRangePicker, DatePreset } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getDateRangeFromPreset, validateDateRange } from '@/utils/dateUtils';
import { formatCurrency, formatNumber, formatPercent } from '@/utils/format';
import { FacebookAdAccount, FacebookCampaign, FacebookAdSet, FacebookAd } from '@/types/facebook';
import { fetchAdAccountData, setFacebookApiAuthHeaders } from '@/utils/facebookAdsApi';
import { useAppContext } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { useDragScroll } from '@/hooks/useDragScroll';
import { FacebookReconnectDialog } from './FacebookReconnectDialog';

interface FacebookAdsManagerProps {
  account: FacebookAdAccount;
  onSpendUpdate: (spend: number) => void;
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
  selectedPreset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
}

interface AccountData {
  campaigns: FacebookCampaign[];
  adsets: FacebookAdSet[];
  ads: FacebookAd[];
  lastUpdated?: Date;
}

const METRICS_CONFIG = [
  { key: 'spend', label: 'Spend', format: 'currency', defaultVisible: true },
  { key: 'impressions', label: 'Impressions', format: 'number', defaultVisible: true },
  { key: 'reach', label: 'Reach', format: 'number', defaultVisible: true },
  { key: 'clicks', label: 'Clicks', format: 'number', defaultVisible: true },
  { key: 'unique_clicks', label: 'Unique Clicks', format: 'number', defaultVisible: false },
  { key: 'cpc', label: 'CPC', format: 'currency', defaultVisible: true },
  { key: 'cost_per_unique_click', label: 'Cost per Unique Click', format: 'currency', defaultVisible: false },
  { key: 'ctr', label: 'CTR', format: 'percent', defaultVisible: true },
  { key: 'unique_ctr', label: 'Unique CTR', format: 'percent', defaultVisible: false },
  { key: 'cpm', label: 'CPM', format: 'currency', defaultVisible: true },
  { key: 'frequency', label: 'Frequency', format: 'decimal', defaultVisible: true },
  { key: 'add_to_cart', label: 'Add to Cart', format: 'number', defaultVisible: true },
  { key: 'initiate_checkout', label: 'Init Checkout', format: 'number', defaultVisible: true },
  { key: 'purchase', label: 'Purchase', format: 'number', defaultVisible: true },
  { key: 'roas', label: 'ROAS', format: 'decimal', defaultVisible: true },
  { key: 'cost_per_result', label: 'Cost per Result', format: 'currency', defaultVisible: true },
  { key: 'hook_rate', label: 'Hook Rate', format: 'percent', defaultVisible: true }
] as const;

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Custom', days: null }
] as const;

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

type TabType = 'campaigns' | 'adsets' | 'ads';

// Column presets matching Meta Ads Manager's built-in dropdown.
// Each preset is the set of metric keys (from METRICS_CONFIG) to show.
const COLUMN_PRESETS: Record<string, { label: string; columns: string[] }> = {
  performance:  { label: 'Performance',         columns: ['spend', 'impressions', 'reach', 'frequency', 'cost_per_result'] },
  perfClicks:   { label: 'Performance & Clicks', columns: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'] },
  engagement:   { label: 'Engagement',          columns: ['spend', 'impressions', 'clicks', 'ctr', 'hook_rate'] },
  conversions:  { label: 'Conversions',         columns: ['spend', 'add_to_cart', 'initiate_checkout', 'purchase', 'cost_per_result', 'roas'] },
  video:        { label: 'Video Engagement',    columns: ['spend', 'impressions', 'hook_rate', 'cpm', 'frequency'] },
  custom:       { label: 'Custom',              columns: [] }  // sentinel — uses current visibleColumns
};

const STATUS_FILTER_OPTIONS = [
  { value: 'all',     label: 'All statuses' },
  { value: 'active',  label: 'Active only' },
  { value: 'paused',  label: 'Paused only' },
  { value: 'review',  label: 'In review' },
  { value: 'issue',   label: 'With issues' }
] as const;

export function FacebookAdsManager({
  account,
  onSpendUpdate,
  dateRange: initialDateRange,
  onDateRangeChange,
  selectedPreset,
  onPresetChange,
}: FacebookAdsManagerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountData, setAccountData] = useState<AccountData>({
    campaigns: [],
    adsets: [],
    ads: []
  });
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set<string>());
  const [expandedAdSets, setExpandedAdSets] = useState(new Set<string>());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(METRICS_CONFIG.filter(m => m.defaultVisible).map(m => m.key))
  );
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(
    METRICS_CONFIG.map(metric => metric.key)
  );
  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState(false);
  const [tempColumnOrder, setTempColumnOrder] = useState<string[]>(columnOrder);
  const [tempVisibleColumns, setTempVisibleColumns] = useState<Set<string>>(visibleColumns);
  const [selectedItems, setSelectedItems] = useState<{
    campaigns: Set<string>;
    adsets: Set<string>;
    ads: Set<string>;
  }>({
    campaigns: new Set(),
    adsets: new Set(),
    ads: new Set()
  });
  const [activeTab, setActiveTab] = useState<TabType>('campaigns');
  const [searchQuery, setSearchQuery] = useState('');
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [showTokenExpiredDialog, setShowTokenExpiredDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Mirrors Meta's auto-applied "Had delivery" filter — hides items with 0
  // impressions in the date range so the table doesn't drown in junk.
  const [hadDeliveryOnly, setHadDeliveryOnly] = useState(true);
  const [activePreset, setActivePreset] = useState<string>('custom');

  // Drag-to-scroll horizontally on the wide table — saves a trip to the
  // scrollbar at the bottom of a 17-column table.
  const tableScrollRef = useDragScroll<HTMLDivElement>();

  // Wire Shopify auth headers into the FB API client so the backend can
  // resolve the user (and look up their encrypted FB token from DB).
  // Token is NOT carried in URLs anymore.
  const { shopifyConfig } = useAppContext();
  useEffect(() => {
    if (!shopifyConfig) return;
    setFacebookApiAuthHeaders({
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    });
  }, [shopifyConfig]);

  const loadAccountData = async (range = initialDateRange) => {
    setIsLoading(true);
    setError(null);
    try {
      const validRange = validateDateRange(range.from, range.to);
      const data = await fetchAdAccountData(account.id, account.accessToken, validRange);
      
      // Sort campaigns to show active ones first
      const sortedCampaigns = [...data.campaigns].sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
        return 0;
      });

      setAccountData({
        ...data,
        campaigns: sortedCampaigns
      });

      // Calculate and update total spend
      const totalSpend = data.campaigns.reduce((sum, campaign) => sum + (campaign.spend || 0), 0);
      onSpendUpdate(totalSpend);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to load account data';
      // Backend tags errors with structured `reason` since the latest sync —
      // prefer that over string matching on the human message.
      const reason: string | undefined = err.reason;
      const isExpired = reason === 'expired_token'
        || (errorMessage.includes('access token') && errorMessage.includes('expired'));
      // Show the FB error message verbatim so the user sees the real reason
      // (rate-limit countdown, missing scope, etc.) rather than a generic error.
      setError(reason && reason !== 'unknown'
        ? `[${reason}] ${errorMessage}`
        : errorMessage);
      if (isExpired) {
        // Open the reconnect dialog directly so the user can re-auth in one
        // step instead of being told to navigate elsewhere.
        setShowReconnectDialog(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReconnect = (config: { accessToken: string; adAccountId: string }) => {
    // Update the account's access token
    account.accessToken = config.accessToken;
    // Reload the data with the new token
    loadAccountData();
  };

  useEffect(() => {
    loadAccountData();
  }, [account.id]);

  // Backend caches insights for 5min on today's ranges, so polling at the
  // same interval gives us near-real-time data without burning extra quota.
  useEffect(() => {
    const id = setInterval(() => loadAccountData(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [account.id, initialDateRange.from, initialDateRange.to]);

  // ----- "This store's mapped spend" KPI -----
  //
  // The campaign table below shows ALL campaigns for the account (intentional —
  // it's the management view). But the headline number for the user has to be
  // the spend ATTRIBUTED TO THIS STORE: only campaigns mapped via
  // CampaignStoreMapping. We pull it from /api/pl, the same backend path
  // ProfitView uses, so the dashboard KPI and P&L row always match.
  const [mappedSpend, setMappedSpend] = useState<number>(0);
  const [mappedSpendComputedAt, setMappedSpendComputedAt] = useState<string | null>(null);

  const fetchMappedSpend = async () => {
    if (!shopifyConfig) return;
    const headers = {
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
    try {
      const dayMs = 86400000;
      const fromDay = Math.floor(initialDateRange.from.getTime() / dayMs);
      const toDay = Math.floor(initialDateRange.to.getTime() / dayMs);
      const todayDay = Math.floor(Date.now() / dayMs);
      const isSingleToday = fromDay === todayDay && toDay === todayDay;

      let total = 0;
      let computedAt: string | null = null;
      if (isSingleToday) {
        const r = await fetch('/api/pl/today', { headers });
        if (r.ok) {
          const j = await r.json();
          total = j?.breakdown?.fbAdSpend || 0;
          computedAt = j?.computedAt || null;
        }
      } else {
        const q = new URLSearchParams({
          from: initialDateRange.from.toISOString(),
          to: initialDateRange.to.toISOString()
        });
        const r = await fetch(`/api/pl/daily?${q}`, { headers });
        if (r.ok) {
          const j = await r.json();
          total = (j?.snapshots || []).reduce((s: number, row: any) => {
            const v = typeof row.fbAdSpend === 'number' ? row.fbAdSpend : parseFloat(row.fbAdSpend || '0');
            return s + (Number.isFinite(v) ? v : 0);
          }, 0);
          computedAt = new Date().toISOString();
        }
      }
      setMappedSpend(total);
      setMappedSpendComputedAt(computedAt);
    } catch (e) {
      console.warn('FacebookAdsManager: mappedSpend fetch failed:', (e as Error).message);
    }
  };

  // Initial fetch + 5min auto-refresh, in lockstep with the campaign table.
  useEffect(() => {
    fetchMappedSpend();
    const id = setInterval(fetchMappedSpend, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopifyConfig?.storeUrl, shopifyConfig?.accessToken, initialDateRange.from, initialDateRange.to]);

  const handleRefresh = () => {
    loadAccountData();
  };

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (current.direction === 'asc') {
          return { key, direction: 'desc' };
        }
        return null;
      }
      return { key, direction: 'asc' };
    });
  };

  const sortData = <T extends Record<string, any>>(data: T[]): T[] => {
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      const comparison = 
        typeof aValue === 'string'
          ? aValue.localeCompare(bValue)
          : aValue - bValue;

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  };

  const renderSortButton = (key: string, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 hover:bg-slate-100"
      onClick={() => handleSort(key)}
    >
      {label}
      {sortConfig?.key === key && (
        <ArrowUpDown className={cn(
          "ml-2 h-4 w-4",
          sortConfig.direction === 'desc' && "transform rotate-180"
        )} />
      )}
    </Button>
  );

  const renderAdThumbnail = (ad: FacebookAd) => {
    if (!ad.creative?.thumbnail_url && !ad.creative?.image_url) return null;

    return (
      <div className="relative flex-shrink-0">
        <img
          src={ad.creative.thumbnail_url || ad.creative.image_url}
          alt={ad.name}
          className="w-[46px] h-[46px] object-cover rounded"
          onError={(e) => {
            // Fallback to image_url if thumbnail fails
            const target = e.target as HTMLImageElement;
            if (target.src === ad.creative?.thumbnail_url && ad.creative?.image_url) {
              target.src = ad.creative.image_url;
            }
          }}
        />
      </div>
    );
  };

  const formatMetricValue = (key: string, value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    
    // Ensure value is a number
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return '-';

    switch (METRICS_CONFIG.find(m => m.key === key)?.format) {
      case 'currency':
        return formatCurrency(numValue);
      case 'number':
        return formatNumber(numValue);
      case 'percent':
        return formatPercent(numValue);
      case 'decimal':
        return numValue.toFixed(2);
      default:
        return numValue.toString();
    }
  };

  // All three handlers use functional setState so they work correctly when
  // called in a loop (e.g. select-all). Without `prev =>`, each iteration
  // closes over a stale `selectedItems` and only the LAST call's mutation
  // survives — that's the bug behind broken select-all.
  const handleCampaignSelect = (campaignId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const next = { campaigns: new Set(prev.campaigns), adsets: new Set(prev.adsets), ads: new Set(prev.ads) };
      if (checked) next.campaigns.add(campaignId);
      else next.campaigns.delete(campaignId);
      return next;
    });
  };

  const handleAdSetSelect = (adsetId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const next = { campaigns: new Set(prev.campaigns), adsets: new Set(prev.adsets), ads: new Set(prev.ads) };
      if (checked) next.adsets.add(adsetId);
      else next.adsets.delete(adsetId);
      return next;
    });
  };

  const handleAdSelect = (adId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const next = { campaigns: new Set(prev.campaigns), adsets: new Set(prev.adsets), ads: new Set(prev.ads) };
      if (checked) next.ads.add(adId);
      else next.ads.delete(adId);
      return next;
    });
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(tempColumnOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setTempColumnOrder(items);
  };

  const handleApplyColumnSettings = () => {
    setColumnOrder(tempColumnOrder);
    setVisibleColumns(tempVisibleColumns);
    setIsColumnSettingsOpen(false);
  };

  const handleCancelColumnSettings = () => {
    setTempColumnOrder(columnOrder);
    setTempVisibleColumns(visibleColumns);
    setIsColumnSettingsOpen(false);
  };

  const renderMetricsColumns = () => (
    <>
      {columnOrder
        .filter(key => visibleColumns.has(key))
        .map(key => {
          const metric = METRICS_CONFIG.find(m => m.key === key);
          if (!metric) return null;
          return (
            <TableCell key={key} className="text-right whitespace-nowrap">
              {renderSortButton(key, metric.label)}
            </TableCell>
          );
        })}
    </>
  );

  const renderMetricsData = (item: FacebookCampaign | FacebookAdSet | FacebookAd) => (
    <>
      {columnOrder
        .filter(key => visibleColumns.has(key))
        .map(key => (
          <TableCell key={key} className="text-right">
            {formatMetricValue(key, (item as any)[key])}
          </TableCell>
        ))}
    </>
  );

  const renderCampaignRow = (campaign: FacebookCampaign) => (
    <TableRow key={campaign.id} className="hover:bg-slate-50">
      <TableCell className="w-[30px] p-2">
        <Checkbox 
          checked={selectedItems.campaigns.has(campaign.id)}
          onCheckedChange={(checked) => handleCampaignSelect(campaign.id, checked === true)}
        />
      </TableCell>
      <TableCell className="w-[300px]">
        <div className="flex items-center space-x-2">
          <span className="truncate">{campaign.name}</span>
        </div>
      </TableCell>
      <TableCell className="w-[100px]">
        <StatusPill status={campaign.status} effectiveStatus={(campaign as any).effective_status} />
      </TableCell>
      <TableCell className="w-[150px]">{campaign.objective}</TableCell>
      {METRICS_CONFIG
        .filter(metric => visibleColumns.has(metric.key))
        .map(metric => (
          <TableCell key={metric.key} className="w-[120px] text-right">
            {formatMetricValue(metric.key, (campaign as any)[metric.key])}
          </TableCell>
        ))}
    </TableRow>
  );

  const renderAdSetRow = (adset: FacebookAdSet) => (
    <TableRow key={adset.id} className="hover:bg-slate-50">
      <TableCell className="w-[30px] p-2">
        <Checkbox 
          checked={selectedItems.adsets.has(adset.id)}
          onCheckedChange={(checked) => handleAdSetSelect(adset.id, checked === true)}
        />
      </TableCell>
      <TableCell className="w-[300px]">
        <div className="flex items-center space-x-2">
          <span className="truncate">{adset.name}</span>
        </div>
      </TableCell>
      <TableCell className="w-[100px]">
        <StatusPill status={adset.status} effectiveStatus={(adset as any).effective_status} />
      </TableCell>
      <TableCell className="w-[150px]">{formatCurrency(adset.budget)}</TableCell>
      {METRICS_CONFIG
        .filter(metric => visibleColumns.has(metric.key))
        .map(metric => (
          <TableCell key={metric.key} className="w-[120px] text-right">
            {formatMetricValue(metric.key, (adset as any)[metric.key])}
          </TableCell>
        ))}
    </TableRow>
  );

  const renderAdRow = (ad: FacebookAd) => (
    <TableRow key={ad.id} className="hover:bg-slate-50">
      <TableCell className="w-[30px] p-2">
        <Checkbox 
          checked={selectedItems.ads.has(ad.id)}
          onCheckedChange={(checked) => handleAdSelect(ad.id, checked === true)}
        />
      </TableCell>
      <TableCell className="w-[300px]">
        <div className="flex items-center space-x-4">
          {renderAdThumbnail(ad)}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{ad.name}</div>
            {ad.creative?.title && (
              <div className="text-sm text-slate-500 truncate">{ad.creative.title}</div>
            )}
            {ad.creative?.body && (
              <div className="text-sm text-slate-500 line-clamp-2">{ad.creative.body}</div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="w-[100px]">
        <StatusPill status={ad.status} effectiveStatus={(ad as any).effective_status} />
      </TableCell>
      {METRICS_CONFIG
        .filter(metric => visibleColumns.has(metric.key))
        .map(metric => (
          <TableCell key={metric.key} className="w-[120px] text-right">
            {formatMetricValue(metric.key, (ad as any)[metric.key])}
          </TableCell>
        ))}
    </TableRow>
  );

  // Filter function for search
  const filterBySearch = <T extends { name: string; id: string }>(items: T[]) => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item => 
      item.name.toLowerCase().includes(query) || 
      item.id.toLowerCase().includes(query)
    );
  };

  // Get filtered data based on active tab and selections
  const getFilteredData = () => {
    let data: (FacebookCampaign | FacebookAdSet | FacebookAd)[] = [];

    switch (activeTab) {
      case 'campaigns':
        data = [...accountData.campaigns];
        break;
      case 'adsets':
        // Only show ad sets whose campaign is in the selected set. If no
        // campaigns are selected, render nothing — the empty-state UI below
        // tells the user to pick a campaign first.
        data = selectedItems.campaigns.size === 0
          ? []
          : accountData.adsets.filter(a =>
              selectedItems.campaigns.has((a as any).campaign_id)
            );
        break;
      case 'ads': {
        // Two-level filter: prefer the more specific selection.
        //   - If user has selected ad sets → show only ads in those.
        //   - Else fall back to ads whose ad-set is in a selected campaign.
        if (selectedItems.adsets.size > 0) {
          data = accountData.ads.filter(ad => selectedItems.adsets.has((ad as any).adset_id));
        } else if (selectedItems.campaigns.size > 0) {
          const adsetIdsInSelectedCampaigns = new Set(
            accountData.adsets
              .filter(a => selectedItems.campaigns.has((a as any).campaign_id))
              .map(a => a.id)
          );
          data = accountData.ads.filter(ad => adsetIdsInSelectedCampaigns.has((ad as any).adset_id));
        } else {
          data = [];
        }
        break;
      }
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      data = data.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
      );
    }

    // Status filter — match against status OR effective_status when present.
    if (statusFilter !== 'all') {
      data = data.filter(item => {
        const eff = ((item as any).effective_status || item.status || '').toUpperCase();
        switch (statusFilter) {
          case 'active':  return eff === 'ACTIVE';
          case 'paused':  return eff === 'PAUSED' || eff === 'CAMPAIGN_PAUSED' || eff === 'ADSET_PAUSED';
          case 'review':  return eff === 'PENDING_REVIEW' || eff === 'IN_REVIEW';
          case 'issue':   return eff === 'WITH_ISSUES' || eff === 'DISAPPROVED' || eff === 'REJECTED' || eff === 'PENDING_BILLING_INFO';
          default: return true;
        }
      });
    }

    // "Had delivery" — Meta's default. Hide rows with 0 impressions in the
    // current date window. Big quality-of-life win: cuts dead rows.
    if (hadDeliveryOnly) {
      data = data.filter(item => ((item as any).impressions || 0) > 0);
    }

    // Sort active items to the top
    data.sort((a, b) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
      return 0;
    });

    // Apply sorting if configured
    if (sortConfig) {
      data.sort((a, b) => {
        const aValue = (a as any)[sortConfig.key] || 0;
        const bValue = (b as any)[sortConfig.key] || 0;
        return sortConfig.direction === 'asc' 
          ? (aValue > bValue ? 1 : -1)
          : (bValue > aValue ? 1 : -1);
      });
    }

    return data;
  };

  const getAdSetsByParentId = (parentId: string) => {
    return accountData.adsets.filter(adset => adset.campaign_id === parentId);
  };

  const getAdsByParentId = (parentId: string) => {
    return accountData.ads.filter(ad => ad.adset_id === parentId);
  };

  // Get counts for tabs
  const getCounts = () => {
    const filteredData = getFilteredData();
    return {
      campaigns: accountData.campaigns.length,
      adsets: activeTab === 'adsets' ? filteredData.length : accountData.adsets.filter(adset => 
        selectedItems.campaigns.has(adset.campaign_id)
      ).length,
      ads: activeTab === 'ads' ? filteredData.length : accountData.ads.filter(ad => {
        const adset = accountData.adsets.find(as => as.id === ad.adset_id);
        return adset && selectedItems.campaigns.has(adset.campaign_id);
      }).length
    };
  };

  // Handle tab change
  const handleTabChange = (value: TabType) => {
    setActiveTab(value);
    // Clear search when switching tabs
    setSearchQuery('');
  };

  // Apply a named column preset — flips visibleColumns to the preset's set.
  // "custom" is a sentinel meaning "leave whatever the user picked manually".
  const applyColumnPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    const preset = COLUMN_PRESETS[presetKey];
    if (!preset || presetKey === 'custom') return;
    setVisibleColumns(new Set(preset.columns));
  };

  // Total count of currently selected items across all tabs — drives whether
  // the bulk-action toolbar is rendered.
  const totalSelected = selectedItems.campaigns.size + selectedItems.adsets.size + selectedItems.ads.size;

  const clearAllSelections = () => {
    setSelectedItems({ campaigns: new Set(), adsets: new Set(), ads: new Set() });
  };

  // CSV export for whatever's currently visible in the active tab.
  const exportCsv = () => {
    const rows = getFilteredData();
    if (!rows.length) return;
    const headers = ['name', 'status', ...columnOrder.filter(k => visibleColumns.has(k))];
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = (r as any)[h];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fb-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Active filter chip summary — shown in the filter bar, removable individually.
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (statusFilter !== 'all') {
      const opt = STATUS_FILTER_OPTIONS.find(o => o.value === statusFilter);
      chips.push({ key: 'status', label: opt?.label || statusFilter, clear: () => setStatusFilter('all') });
    }
    if (hadDeliveryOnly) {
      chips.push({ key: 'delivery', label: 'Had delivery', clear: () => setHadDeliveryOnly(false) });
    }
    if (searchQuery) {
      chips.push({ key: 'search', label: `"${searchQuery}"`, clear: () => setSearchQuery('') });
    }
    return chips;
  }, [statusFilter, hadDeliveryOnly, searchQuery]);

  // Render table content based on active tab
  const renderTableContent = () => {
    const filteredData = getFilteredData();
    
    switch (activeTab) {
      case 'campaigns':
        return (filteredData as FacebookCampaign[]).map(campaign => renderCampaignRow(campaign));
      case 'adsets':
        return (filteredData as FacebookAdSet[]).map(adset => renderAdSetRow(adset));
      case 'ads':
        return (filteredData as FacebookAd[]).map(ad => renderAdRow(ad));
    }
  };

  // Update the table header to show relevant columns
  const renderTableHeader = () => {
    const counts = getCounts();
    return (
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          {activeTab === 'campaigns' && <TableHead>Objective</TableHead>}
          {activeTab === 'adsets' && <TableHead>Budget</TableHead>}
          {renderMetricsColumns()}
        </TableRow>
      </TableHeader>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-4 flex-wrap">
              <CardTitle className="text-xl font-bold">
                Facebook Ads Manager
                {accountData.lastUpdated && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    Last updated: {accountData.lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </CardTitle>
              {/* This store's mapped spend KPI — sourced from /api/pl, same as
                  ProfitView. Auto-refreshes every 5min in lockstep with the
                  table below. The total in the campaign table is account-wide
                  (mapped + unmapped); this number is the subset attributed to
                  the current store via CampaignStoreMapping. */}
              <div className="flex items-baseline gap-2 px-3 py-1 rounded-lg bg-blue-50 border border-blue-100">
                <span className="text-xs font-medium text-blue-700 uppercase tracking-wide">This store</span>
                <span className="text-lg font-bold text-blue-900 tabular-nums">
                  ${mappedSpend.toFixed(2)}
                </span>
                {mappedSpendComputedAt && (
                  <span className="text-[10px] text-blue-500 font-mono">
                    @ {new Date(mappedSpendComputedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
            <DateRangePicker
              from={initialDateRange.from}
              to={initialDateRange.to}
              onSelect={(range) => {
                onDateRangeChange(range);
                loadAccountData(range);
              }}
              selectedPreset={selectedPreset}
              onPresetChange={(preset) => {
                onPresetChange(preset);
                if (preset !== 'custom') {
                  const range = getDateRangeFromPreset(preset);
                  onDateRangeChange(range);
                  loadAccountData(range);
                }
              }}
            />
          </div>

          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Search by name, ID or metrics"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4"
              />
            </div>

            {/* Status filter dropdown — mirrors Meta's "Filters" panel for the
                most common case (status). Full multi-criteria panel can come later. */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <FilterIcon className="h-4 w-4 mr-2 text-slate-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Column preset dropdown — Meta ships ~14 presets; we ship the
                3 most useful (Performance / Engagement / Conversions) plus
                a sentinel for whatever the user customised manually. */}
            <Select value={activePreset} onValueChange={applyColumnPreset}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Columns: Custom" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COLUMN_PRESETS).map(([key, p]) => (
                  <SelectItem key={key} value={key}>Columns: {p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu open={isColumnSettingsOpen} onOpenChange={setIsColumnSettingsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Settings className="h-4 w-4" />
                  <span className="ml-2">Columns</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px]">
                <DropdownMenuLabel>Column Settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="p-2">
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="columns">
                      {(provided) => (
                        <div
                          {...provided.droppableProps}
                          ref={provided.innerRef}
                          className="space-y-2"
                        >
                          {tempColumnOrder.map((key, index) => {
                            const metric = METRICS_CONFIG.find(m => m.key === key);
                            if (!metric) return null;
                            return (
                              <Draggable key={key} draggableId={key} index={index}>
                                {(provided) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className="flex items-center space-x-2 rounded-md border p-2 bg-white"
                                  >
                                    <div {...provided.dragHandleProps}>
                                      <GripVertical className="h-4 w-4 text-slate-500" />
                                    </div>
                                    <input
                                      type="checkbox"
                                      checked={tempVisibleColumns.has(key)}
                                      onChange={(e) => {
                                        const newColumns = new Set(tempVisibleColumns);
                                        if (e.target.checked) {
                                          newColumns.add(key);
                                        } else {
                                          newColumns.delete(key);
                                        }
                                        setTempVisibleColumns(newColumns);
                                      }}
                                      className="h-4 w-4"
                                    />
                                    <span className="flex-1">{metric.label}</span>
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>
                </div>
                <DropdownMenuSeparator />
                <div className="flex justify-end gap-2 p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelColumnSettings}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyColumnSettings}
                  >
                    Apply
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Filter chips bar — Meta-style removable pills with "Had delivery"
              + custom switch + "+ Add filter" placeholder. */}
          <div className="flex items-center flex-wrap gap-2 pt-1">
            {activeFilterChips.map(chip => (
              <Badge key={chip.key} variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer pl-2 pr-1 py-1 gap-1 border border-blue-200">
                {chip.label}
                <button onClick={chip.clear} className="ml-1 hover:bg-blue-200 rounded p-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer ml-auto">
              <Switch checked={hadDeliveryOnly} onCheckedChange={setHadDeliveryOnly} />
              Had delivery only
            </label>
          </div>

          <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as TabType)} className="w-full">
            <TabsList className="w-full justify-start border-b">
              <TabsTrigger value="campaigns" className="relative gap-2">
                Campaigns
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">{getCounts().campaigns}</Badge>
              </TabsTrigger>
              <TabsTrigger
                value="adsets"
                className="relative gap-2"
                disabled={selectedItems.campaigns.size === 0}
              >
                Ad sets
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">{getCounts().adsets}</Badge>
              </TabsTrigger>
              <TabsTrigger
                value="ads"
                className="relative gap-2"
                disabled={selectedItems.campaigns.size === 0}
              >
                Ads
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">{getCounts().ads}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <span className="ml-3 text-slate-600">Loading account data...</span>
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : selectedItems.campaigns.size === 0 && activeTab !== 'campaigns' ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <span>Please select at least one campaign to view {activeTab}</span>
            </div>
          ) : (
            <div className="relative">
              {/* Always-on bulk toolbar — same height & position regardless of
                  selection state, so toggling rows never reflows the table.
                  Buttons gray out when nothing is selected. */}
              <div className="flex items-center gap-1 mb-3 px-1 h-9 text-sm" data-no-drag>
                <span className={cn(
                  'text-xs mr-2 tabular-nums',
                  totalSelected > 0 ? 'font-semibold text-slate-700' : 'text-slate-400'
                )}>
                  {totalSelected > 0 ? `${totalSelected} selected` : 'No selection'}
                </span>
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={totalSelected === 0} title="Pause selected">
                  <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={totalSelected === 0} title="Turn on selected">
                  <Play className="h-3.5 w-3.5 mr-1" /> Turn on
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={totalSelected === 0} title="Duplicate selected">
                  <Copy className="h-3.5 w-3.5 mr-1" /> Duplicate
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={totalSelected === 0} onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export
                </Button>
                {totalSelected > 0 && (
                  <Button size="sm" variant="ghost" className="h-8 ml-auto text-xs text-slate-500" onClick={clearAllSelections}>
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                )}
              </div>

              <div ref={tableScrollRef} className="max-h-[600px] overflow-auto">
                <Table className="w-full">
                  <colgroup>
                    <col className="w-[30px]" /> {/* Checkbox column */}
                    <col className="w-[300px]" /> {/* Name column */}
                    <col className="w-[100px]" /> {/* Status column */}
                    {activeTab === 'campaigns' && <col className="w-[150px]" />} {/* Objective column */}
                    {activeTab === 'adsets' && <col className="w-[150px]" />} {/* Budget column */}
                    {/* Metrics columns */}
                    {METRICS_CONFIG
                      .filter(metric => visibleColumns.has(metric.key))
                      .map(metric => (
                        <col key={metric.key} className="w-[120px]" />
                      ))}
                  </colgroup>

                  <TableHeader className="sticky top-0 z-10 bg-white">
                    <TableRow>
                      <TableHead className="w-[30px] p-2 bg-white border-b">
                        <Checkbox 
                          checked={
                            getFilteredData().length > 0 && 
                            getFilteredData().every(item => 
                              activeTab === 'campaigns' ? selectedItems.campaigns.has(item.id) :
                              activeTab === 'adsets' ? selectedItems.adsets.has(item.id) :
                              selectedItems.ads.has(item.id)
                            )
                          }
                          onCheckedChange={(checked) => {
                            const filteredData = getFilteredData();
                            if (checked) {
                              filteredData.forEach(item => {
                                if (activeTab === 'campaigns') {
                                  handleCampaignSelect(item.id, true);
                                } else if (activeTab === 'adsets') {
                                  handleAdSetSelect(item.id, true);
                                } else {
                                  handleAdSelect(item.id, true);
                                }
                              });
                            } else {
                              filteredData.forEach(item => {
                                if (activeTab === 'campaigns') {
                                  handleCampaignSelect(item.id, false);
                                } else if (activeTab === 'adsets') {
                                  handleAdSetSelect(item.id, false);
                                } else {
                                  handleAdSelect(item.id, false);
                                }
                              });
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead className="w-[300px] bg-white border-b">Name</TableHead>
                      <TableHead className="w-[100px] bg-white border-b">Status</TableHead>
                      {activeTab === 'campaigns' && <TableHead className="w-[150px] bg-white border-b">Objective</TableHead>}
                      {activeTab === 'adsets' && <TableHead className="w-[150px] bg-white border-b">Budget</TableHead>}
                      {METRICS_CONFIG
                        .filter(metric => visibleColumns.has(metric.key))
                        .map(metric => (
                          <TableHead 
                            key={metric.key} 
                            className="w-[120px] text-right whitespace-nowrap bg-white border-b"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 hover:bg-slate-100"
                              onClick={() => handleSort(metric.key)}
                            >
                              {metric.label}
                              {sortConfig?.key === metric.key && (
                                <ArrowUpDown className={cn(
                                  "ml-2 h-4 w-4",
                                  sortConfig.direction === 'desc' && "transform rotate-180"
                                )} />
                              )}
                            </Button>
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {renderTableContent()}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <FacebookReconnectDialog
        isOpen={showReconnectDialog}
        onOpenChange={setShowReconnectDialog}
        onReconnect={handleReconnect}
      />

      {/* Legacy "Okay"-only token-expired dialog removed — we now open the
          inline reconnect dialog directly so the user re-auths in one click. */}
    </div>
  );
} 