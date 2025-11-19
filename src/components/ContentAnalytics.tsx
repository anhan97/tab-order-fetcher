import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { formatCurrency, formatNumber, formatPercent } from "@/utils/format";
import { Order } from "@/types/order";
import { FacebookAd, FacebookCampaign, FacebookAdSet } from "@/types/facebook";
import { DatePreset } from "@/components/ui/date-range-picker";

interface ContentPerformance {
  content: string;
  campaign: string;
  adId: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
  conversionRate: number;
  matchedOrders: Array<{ 
    orderNumber: string; 
    orderId: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    fbclid?: string;
  }>;
}

interface ContentAnalyticsProps {
  orders: Order[];
  campaigns: FacebookCampaign[];
  adSets: FacebookAdSet[];
  ads: FacebookAd[];
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
  selectedPreset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
}

export function ContentAnalytics({
  orders,
  campaigns,
  adSets,
  ads,
  dateRange,
  onDateRangeChange,
  selectedPreset,
  onPresetChange,
}: ContentAnalyticsProps) {
  const [sortField, setSortField] = React.useState<keyof ContentPerformance>("roas");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = React.useState<"content" | "campaign">("content");

  // Process and aggregate data
  const contentPerformance = React.useMemo(() => {
    const performanceMap = new Map<string, ContentPerformance>();

    // Create a map of ad content performance
    ads.forEach(ad => {
      const campaign = campaigns.find(c => c.id === ad.campaign_id);
      const key = groupBy === "content" ? ad.creative?.body || "No Content" : campaign?.name || "Unknown Campaign";
      
      const existing = performanceMap.get(key) || {
        content: ad.creative?.body || "No Content",
        campaign: campaign?.name || "Unknown Campaign",
        adId: ad.id,
        impressions: 0,
        clicks: 0,
        spend: 0,
        orders: 0,
        revenue: 0,
        ctr: 0,
        cpc: 0,
        roas: 0,
        conversionRate: 0,
        matchedOrders: [],
      };

      // Aggregate metrics
      existing.impressions += ad.impressions || 0;
      existing.clicks += ad.clicks || 0;
      existing.spend += ad.spend || 0;

      performanceMap.set(key, existing);
    });

    // Add order data by UTM matching
    orders.forEach(order => {
      // Gather all UTM values and fbclid
      const utmValues = [
        order.utmContent,
        order.utmCampaign,
        order.utmSource,
        order.utmMedium,
        order.utmTerm,
        order.fbclid,
      ].filter(Boolean).map(v => v?.toString().toLowerCase());

      // Try to match to an ad by ID or creative body
      let matchedAd: FacebookAd | undefined;
      let matchedKey: string | undefined;
      for (const ad of ads) {
        const adId = ad.id.toLowerCase();
        const adBody = ad.creative?.body?.toLowerCase();
        if (utmValues.some(utm => utm && (utm.includes(adId) || (adBody && utm.includes(adBody))))) {
          matchedAd = ad;
          const campaign = campaigns.find(c => c.id === ad.campaign_id);
          matchedKey = groupBy === "content" ? ad.creative?.body || "No Content" : campaign?.name || "Unknown Campaign";
          break;
        }
      }
      if (matchedAd && matchedKey) {
        const perf = performanceMap.get(matchedKey);
        if (perf) {
          perf.orders += 1;
          perf.revenue += order.totalPrice;
                     perf.matchedOrders.push({
             orderNumber: order.orderNumber,
             orderId: order.id,
             utmSource: order.utmSource,
             utmMedium: order.utmMedium,
             utmCampaign: order.utmCampaign,
             utmContent: order.utmContent,
             utmTerm: order.utmTerm,
             fbclid: order.fbclid,
           });
        }
      }
    });

    // Calculate derived metrics
    return Array.from(performanceMap.values()).map(perf => ({
      ...perf,
      ctr: perf.impressions > 0 ? (perf.clicks / perf.impressions) * 100 : 0,
      cpc: perf.clicks > 0 ? perf.spend / perf.clicks : 0,
      roas: perf.spend > 0 ? perf.revenue / perf.spend : 0,
      conversionRate: perf.clicks > 0 ? (perf.orders / perf.clicks) * 100 : 0,
    }));
  }, [orders, campaigns, ads, groupBy]);

  // Sort data
  const sortedData = React.useMemo(() => {
    return [...contentPerformance].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      return sortDirection === "asc" 
        ? (aValue > bValue ? 1 : -1)
        : (bValue > aValue ? 1 : -1);
    });
  }, [contentPerformance, sortField, sortDirection]);

  // Calculate totals
  const totals = React.useMemo(() => {
    return contentPerformance.reduce((acc, curr) => ({
      content: "Total",
      campaign: "",
      adId: "",
      impressions: acc.impressions + curr.impressions,
      clicks: acc.clicks + curr.clicks,
      spend: acc.spend + curr.spend,
      orders: acc.orders + curr.orders,
      revenue: acc.revenue + curr.revenue,
      ctr: 0,
      cpc: 0,
      roas: 0,
      conversionRate: 0,
    }), {
      content: "Total",
      campaign: "",
      adId: "",
      impressions: 0,
      clicks: 0,
      spend: 0,
      orders: 0,
      revenue: 0,
      ctr: 0,
      cpc: 0,
      roas: 0,
      conversionRate: 0,
    });
  }, [contentPerformance]);

  // Calculate averages for rate metrics
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  totals.conversionRate = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;

  const handleSort = (field: keyof ContentPerformance) => {
    if (field === sortField) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content Performance Analytics</CardTitle>
        <CardDescription>
          Analyze which content and campaigns are performing best
        </CardDescription>
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <DateRangePicker
              from={dateRange.from}
              to={dateRange.to}
              onSelect={onDateRangeChange}
              selectedPreset={selectedPreset}
              onPresetChange={onPresetChange}
            />
          </div>
          <div>
            <Select value={groupBy} onValueChange={(value: "content" | "campaign") => setGroupBy(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="content">Group by Content</SelectItem>
                <SelectItem value="campaign">Group by Campaign</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">
                  {groupBy === "content" ? "Content" : "Campaign"}
                </TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">Orders (Matched by UTM)</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Conv. Rate</TableHead>
                                 <TableHead className="text-right">UTM Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">
                    <div className="max-w-[300px] truncate">
                      {groupBy === "content" ? row.content : row.campaign}
                    </div>
                    <div className="text-xs text-slate-400">ID: {row.adId}</div>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(row.impressions)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.clicks)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.ctr)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.spend)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.cpc)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.orders)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.revenue)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.roas)}x</TableCell>
                  <TableCell className="text-right">{formatPercent(row.conversionRate)}</TableCell>
                                     <TableCell className="text-right">
                     {row.matchedOrders.length > 0 ? (
                       <div className="text-xs text-slate-600 max-w-[200px]">
                         {row.matchedOrders.map(o => (
                           <div key={o.orderId} className="mb-2 p-2 border rounded">
                             <div className="font-medium">#{o.orderNumber}</div>
                             <div className="text-slate-500">
                               {o.utmSource && <div>Source: {o.utmSource}</div>}
                               {o.utmMedium && <div>Medium: {o.utmMedium}</div>}
                               {o.utmCampaign && <div>Campaign: {o.utmCampaign}</div>}
                               {o.utmContent && <div>Content: {o.utmContent}</div>}
                               {o.utmTerm && <div>Term: {o.utmTerm}</div>}
                               {o.fbclid && <div>FB Click ID: {o.fbclid}</div>}
                             </div>
                           </div>
                         ))}
                       </div>
                     ) : (
                       <span className="text-slate-400">-</span>
                     )}
                   </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold">
                <TableCell>Totals</TableCell>
                <TableCell className="text-right">{formatNumber(totals.impressions)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.clicks)}</TableCell>
                <TableCell className="text-right">{formatPercent(totals.ctr)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.spend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.cpc)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.orders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.revenue)}</TableCell>
                <TableCell className="text-right">{formatNumber(totals.roas)}x</TableCell>
                <TableCell className="text-right">{formatPercent(totals.conversionRate)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
} 