import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Percent, RefreshCw, Users, CheckCircle2, Globe2, Trophy, Wallet, Boxes } from 'lucide-react';
import { Order } from '@/types/order';
import { computeDashboardInsights } from '@/utils/dashboardInsights';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/lib/utils';

interface DashboardInsightsProps {
  orders: Order[];
  revenue: number;
  netProfit: number;
  totalFees?: number;
}

/**
 * Tier-1 dashboard insights — KPI cards + Top Products / Top Countries tables.
 * Pure derivation off the same orders the dashboard already has, so adding
 * this section does not trigger any extra fetches.
 */
export function DashboardInsights({ orders, revenue, netProfit, totalFees = 0 }: DashboardInsightsProps) {
  const insights = useMemo(
    () => computeDashboardInsights({ orders, revenue, netProfit, totalFees }),
    [orders, revenue, netProfit, totalFees]
  );

  const marginColor = insights.netProfitMargin >= 30
    ? 'text-emerald-600'
    : insights.netProfitMargin >= 15
      ? 'text-amber-600'
      : 'text-rose-600';

  const refundColor = insights.refundRate <= 1
    ? 'text-emerald-600'
    : insights.refundRate <= 3
      ? 'text-amber-600'
      : 'text-rose-600';

  return (
    <div className="space-y-6">
      <TooltipProvider>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <InsightStat
            icon={<Percent className="h-4 w-4 text-emerald-500" />}
            label="Net Margin"
            value={`${insights.netProfitMargin.toFixed(1)}%`}
            valueClassName={marginColor}
            tooltip="Net profit ÷ revenue. Healthy dropshipping is 20-30%+"
          />
          <InsightStat
            icon={<RefreshCw className="h-4 w-4 text-rose-500" />}
            label="Refund Rate"
            value={`${insights.refundRate.toFixed(1)}%`}
            valueClassName={refundColor}
            tooltip="Share of orders flagged refunded or partially refunded"
          />
          <InsightStat
            icon={<Users className="h-4 w-4 text-violet-500" />}
            label="Repeat Customer"
            value={`${insights.repeatCustomerRate.toFixed(1)}%`}
            tooltip={`${insights.returningCustomers} of ${insights.uniqueCustomers} customers placed more than one order in this window`}
          />
          <InsightStat
            icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
            label="Fulfillment"
            value={`${insights.fulfillmentRate.toFixed(1)}%`}
            tooltip="Paid orders that are marked fulfilled"
          />
          <InsightStat
            icon={<Wallet className="h-4 w-4 text-amber-500" />}
            label="Effective Fee"
            value={`${insights.effectiveFeeRate.toFixed(2)}%`}
            tooltip="Shopify Payments fee as a % of revenue"
          />
          <InsightStat
            icon={<Boxes className="h-4 w-4 text-teal-500" />}
            label="Items / Order"
            value={insights.averageItemsPerOrder.toFixed(2)}
            tooltip="Average units shipped per order"
          />
        </div>
      </TooltipProvider>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Top products
            </CardTitle>
            <span className="text-xs text-slate-500">Ranked by revenue</span>
          </CardHeader>
          <CardContent className="pt-0">
            {insights.topProducts.length === 0 ? (
              <EmptyRow>No product activity in this window</EmptyRow>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insights.topProducts.map((p, idx) => (
                    <TableRow key={p.sku}>
                      <TableCell className="font-mono text-slate-500">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{p.sku}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[260px]">{p.name}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatCurrency(p.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-blue-500" />
              Top countries
            </CardTitle>
            <span className="text-xs text-slate-500">Ranked by orders</span>
          </CardHeader>
          <CardContent className="pt-0">
            {insights.topCountries.length === 0 ? (
              <EmptyRow>No shipping addresses captured</EmptyRow>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insights.topCountries.map((c, idx) => (
                    <TableRow key={c.countryCode}>
                      <TableCell className="font-mono text-slate-500">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{c.countryName}</div>
                        <div className="text-xs text-slate-500">{c.countryCode}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatCurrency(c.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface InsightStatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
  valueClassName?: string;
}

function InsightStat({ icon, label, value, tooltip, valueClassName }: InsightStatProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card className="cursor-help hover:bg-slate-50 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              {icon}
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</p>
            </div>
            <h3 className={cn("text-2xl font-bold mt-2 tabular-nums text-slate-900", valueClassName)}>
              {value}
            </h3>
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-[260px]">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-8 text-sm text-slate-500">{children}</div>
  );
}
