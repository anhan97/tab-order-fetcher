/**
 * Unified merchant page on /orders.
 *
 * Used to be just <OrdersTable />. Now hosts three tabs in one page so
 * Dashboard / Daily P&L / Analytics all share the same URL, store
 * resolution, and (where each tab supports it) the global date range:
 *
 *   • Overview  — at-a-glance charts (Net Profit, ROAS, Cost pie)
 *   • Daily P&L — full ProfitView (breakdown table + ops costs + sync)
 *   • Orders    — full OrdersTable (KPIs + filterable order list)
 *
 * Why one page: per-tab data sources end up calling the same backend
 * (/api/pl/today, /api/pl/daily, /api/orders), so divergence between
 * three separate pages was a real bug-source. Mounting them under one
 * route makes that impossible. Each tab keeps its own filter UI for now
 * but subscribes to the shared AppContext.dateRange so changing the
 * range in one tab carries to the others on next render.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrdersTable } from '@/components/OrdersTable';
import { ProfitView } from '@/components/ProfitView';
import { OverviewCharts } from '@/components/OverviewCharts';
import { useAppContext } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { LayoutDashboard, BarChart3, ListOrdered } from 'lucide-react';

export const OrdersPage = () => {
  const {
    shopifyConfig,
    setOrders,
    minimalCogsConfig,
    isFacebookConnected,
    timezone,
    facebookAccounts,
    accountsSpend,
    dateRange,
    handleSpendUpdate
  } = useAppContext();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = (user?.role || 'user') as 'admin' | 'user' | 'cs' | 'finance';

  // Which tabs this role gets to see. CS is fulfillment-only so they jump
  // straight to the order list; Finance is read-only on money so they get
  // Overview + Daily P&L. Admin/user see everything.
  const visibleTabs = useMemo(() => {
    if (role === 'cs')      return ['orders'] as const;
    if (role === 'finance') return ['overview', 'pl'] as const;
    return ['overview', 'pl', 'orders'] as const;
  }, [role]);

  // Default tab — pick the first one this role can see, but prefer the
  // role's natural landing page (cs→orders, finance→pl, others→orders).
  const defaultTab: 'overview' | 'pl' | 'orders' =
    role === 'cs' ? 'orders' : role === 'finance' ? 'pl' : 'orders';
  const [tab, setTab] = useState<'overview' | 'pl' | 'orders'>(defaultTab);

  if (!shopifyConfig) return null;

  return (
    <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)} className="space-y-4">
      <TabsList
        className="grid w-full max-w-md"
        style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
      >
        {visibleTabs.includes('overview') && (
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </TabsTrigger>
        )}
        {visibleTabs.includes('pl') && (
          <TabsTrigger value="pl" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Daily P&amp;L
          </TabsTrigger>
        )}
        {visibleTabs.includes('orders') && (
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" /> Orders
          </TabsTrigger>
        )}
      </TabsList>

      {visibleTabs.includes('overview') && (
        <TabsContent value="overview" className="mt-0">
          <OverviewCharts from={dateRange.from} to={dateRange.to} />
        </TabsContent>
      )}

      {visibleTabs.includes('pl') && (
        <TabsContent value="pl" className="mt-0">
          <ProfitView externalRange={dateRange} />
        </TabsContent>
      )}

      {visibleTabs.includes('orders') && (
        <TabsContent value="orders" className="mt-0">
          <OrdersTable
          shopifyConfig={shopifyConfig}
          onOrdersChange={setOrders}
          cogsConfig={minimalCogsConfig}
          isFacebookConnected={isFacebookConnected}
          timezone={timezone}
          onFacebookConnect={() => navigate('/facebook')}
          facebookAccounts={facebookAccounts}
          accountsSpend={accountsSpend}
          globalDateRange={dateRange}
          onAccountsSpendUpdate={handleSpendUpdate}
        />
        </TabsContent>
      )}
    </Tabs>
  );
};
