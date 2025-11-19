import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Settings, Loader2, AlertCircle, ArrowUpDown, GripVertical, Search, Plus, Copy, Edit, Beaker } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
import { fetchAdAccountData } from '@/utils/facebookAdsApi';
import { cn } from '@/lib/utils';
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
      setError(errorMessage);
      if (errorMessage.includes('access token') && errorMessage.includes('expired')) {
        setShowTokenExpiredDialog(true);
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

  const handleCampaignSelect = (campaignId: string, checked: boolean) => {
    const newSelected = {
      campaigns: new Set(selectedItems.campaigns),
      adsets: new Set(selectedItems.adsets),
      ads: new Set(selectedItems.ads)
    };

    if (checked) {
      newSelected.campaigns.add(campaignId);
    } else {
      newSelected.campaigns.delete(campaignId);
    }

    setSelectedItems(newSelected);
  };

  const handleAdSetSelect = (adsetId: string, checked: boolean) => {
    const newSelected = {
      campaigns: new Set(selectedItems.campaigns),
      adsets: new Set(selectedItems.adsets),
      ads: new Set(selectedItems.ads)
    };

    if (checked) {
      newSelected.adsets.add(adsetId);
    } else {
      newSelected.adsets.delete(adsetId);
    }

    setSelectedItems(newSelected);
  };

  const handleAdSelect = (adId: string, checked: boolean) => {
    const newSelected = {
      campaigns: new Set(selectedItems.campaigns),
      adsets: new Set(selectedItems.adsets),
      ads: new Set(selectedItems.ads)
    };

    if (checked) {
      newSelected.ads.add(adId);
    } else {
      newSelected.ads.delete(adId);
    }

    setSelectedItems(newSelected);
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
        <span className={cn(
          "px-2 py-1 rounded-full text-xs",
          campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
        )}>
          {campaign.status}
        </span>
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
        <span className={cn(
          "px-2 py-1 rounded-full text-xs",
          adset.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
        )}>
          {adset.status}
        </span>
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
        <span className={cn(
          "px-2 py-1 rounded-full text-xs",
          ad.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
        )}>
          {ad.status}
        </span>
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
        data = [...accountData.adsets];
        break;
      case 'ads':
        data = [...accountData.ads];
        break;
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      data = data.filter(item => 
        item.name.toLowerCase().includes(query) || 
        item.id.toLowerCase().includes(query)
      );
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold">
              Facebook Ads Manager
              {accountData.lastUpdated && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  Last updated: {accountData.lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </CardTitle>
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

          <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as TabType)} className="w-full">
            <TabsList className="w-full justify-start border-b">
              <TabsTrigger value="campaigns" className="relative">
                Campaigns
                <span className="ml-2 text-xs text-slate-500">({getCounts().campaigns})</span>
              </TabsTrigger>
              <TabsTrigger 
                value="adsets" 
                className="relative"
                disabled={selectedItems.campaigns.size === 0}
              >
                Ad sets
                <span className="ml-2 text-xs text-slate-500">({getCounts().adsets})</span>
              </TabsTrigger>
              <TabsTrigger 
                value="ads" 
                className="relative"
                disabled={selectedItems.campaigns.size === 0}
              >
                Ads
                <span className="ml-2 text-xs text-slate-500">({getCounts().ads})</span>
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
              <div className="max-h-[600px] overflow-auto">
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

      <AlertDialog open={showTokenExpiredDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Facebook Session Expired</AlertDialogTitle>
            <AlertDialogDescription>
              Your Facebook session has expired. Please go to the Facebook tab and reconnect your account to continue using Facebook Ads features.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowTokenExpiredDialog(false)}>
              Okay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 