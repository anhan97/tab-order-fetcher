import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart3, Loader2, Star, Settings, RefreshCw, Link2 } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { FacebookAdsConnection } from '@/components/FacebookAdsConnection';
import { FacebookAdsManager } from '@/components/FacebookAdsManager';
import { FacebookOnboarding } from '@/components/FacebookOnboarding';
import { CampaignMappingPanel } from '@/components/CampaignMappingPanel';
import { MyFacebookAppCard } from '@/components/MyFacebookAppCard';
import { AutoLaunchAds } from '@/components/AutoLaunchAds';
import { Rocket } from 'lucide-react';
import { AdluxApi, AdluxAdAccount } from '@/utils/adluxApi';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FacebookAdAccount } from '@/types/facebook';

type Mode = 'loading' | 'shopify-required' | 'adlux-onboarding' | 'adlux-ready' | 'legacy-fb-login';

export const FacebookPage = () => {
  const {
    isShopifyConnected,
    shopifyConfig,
    isFacebookConnected,
    handleFacebookConnectionSuccess,
    selectedAccount,
    setSelectedAccount,
    handleSpendUpdate,
    dateRange,
    setDateRange,
    selectedDatePreset,
    setSelectedDatePreset
  } = useAppContext();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('loading');
  const [adluxAccounts, setAdluxAccounts] = useState<AdluxAdAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [poolEnabled, setPoolEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // On mount: figure out which mode we're in.
  // 1. No Shopify connection → can't identify the user → ask them to connect Shopify first.
  // 2. Backend has Adlux pool → multi-tenant Adlux mode (preferred).
  // 3. Otherwise → legacy per-user FB SDK login flow.
  useEffect(() => {
    if (!isShopifyConnected || !shopifyConfig) {
      setMode('shopify-required');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await AdluxApi.syncStatus();
        if (cancelled) return;
        const adluxOn = status.pool.configured && !!status.scheduler.bmId;
        setPoolEnabled(adluxOn);

        if (!adluxOn) {
          setMode(isFacebookConnected ? 'legacy-fb-login' : 'legacy-fb-login');
          return;
        }

        // Adlux mode → check if user has any claimed accounts.
        const r = await AdluxApi.myAccounts({ storeUrl: shopifyConfig.storeUrl, accessToken: shopifyConfig.accessToken });
        if (cancelled) return;
        if (r.accounts.length === 0) {
          setMode('adlux-onboarding');
        } else {
          setAdluxAccounts(r.accounts);
          setActiveAccountId(r.accounts[0].accountId);
          setMode('adlux-ready');
        }
      } catch (err) {
        console.warn('Adlux mode check failed:', err);
        // Fall back to legacy flow if backend is unreachable.
        setMode('legacy-fb-login');
      }
    })();
    return () => { cancelled = true; };
  }, [isShopifyConnected, shopifyConfig, isFacebookConnected]);

  const refreshAccounts = async () => {
    if (!shopifyConfig) return;
    setRefreshing(true);
    try {
      const r = await AdluxApi.myAccounts({ storeUrl: shopifyConfig.storeUrl, accessToken: shopifyConfig.accessToken });
      setAdluxAccounts(r.accounts);
      if (!activeAccountId && r.accounts.length > 0) setActiveAccountId(r.accounts[0].accountId);
      toast({ title: 'Refreshed', description: `${r.accounts.length} account(s)` });
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  const toggleFavorite = async (accountId: string, current: boolean) => {
    if (!shopifyConfig) return;
    try {
      await AdluxApi.setFavorite({ storeUrl: shopifyConfig.storeUrl, accessToken: shopifyConfig.accessToken }, accountId, !current);
      setAdluxAccounts(prev =>
        prev.map(a => a.accountId === accountId ? { ...a, isFavorite: !current } : a)
            .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.accountName.localeCompare(b.accountName))
      );
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  // ---- Render ----

  if (mode === 'loading') {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mr-3" />
        Loading...
      </div>
    );
  }

  if (mode === 'shopify-required') {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card className="p-10 text-center">
          <div className="p-5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-2xl w-20 h-20 mx-auto flex items-center justify-center shadow-lg shadow-blue-500/30 mb-6">
            <BarChart3 className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect Shopify first</h2>
          <p className="text-slate-600">Adlux needs your Shopify connection to identify you. Go to the Connect tab to start.</p>
        </Card>
      </div>
    );
  }

  if (mode === 'adlux-onboarding' && shopifyConfig) {
    return (
      <FacebookOnboarding
        storeUrl={shopifyConfig.storeUrl}
        accessToken={shopifyConfig.accessToken}
        onAccountsReady={(accounts) => {
          setAdluxAccounts(accounts);
          setActiveAccountId(accounts[0]?.accountId || null);
          setMode('adlux-ready');
        }}
      />
    );
  }

  if (mode === 'legacy-fb-login') {
    if (!isFacebookConnected) {
      return (
        <div className="max-w-2xl mx-auto mt-8 space-y-4">
          {/* Per-user FB App credentials — must be set up before the SDK
              connect button can do anything useful. Lives at the top so
              first-time users see it before clicking Connect and getting
              a confusing FB error. */}
          <MyFacebookAppCard />
          <Card className="p-10 text-center bg-gradient-to-br from-white to-blue-50/30 border-blue-100">
            <div className="p-5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-2xl w-20 h-20 mx-auto flex items-center justify-center shadow-lg shadow-blue-500/30 mb-6">
              <BarChart3 className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect Facebook Ads</h2>
            <p className="text-slate-600 mb-8">Once your FB App is configured above, sign in with your Facebook account to manage ads.</p>
            <FacebookAdsConnection onConnectionSuccess={handleFacebookConnectionSuccess} />
          </Card>
        </div>
      );
    }
    // Old flow — selectedAccount holds the current FB account.
    if (!selectedAccount) {
      return (
        <div className="text-center py-16 text-slate-500">No ad account selected. Reconnect Facebook.</div>
      );
    }
    // Tabs in legacy mode too — Mapping panel shows helpful empty state if
    // Adlux isn't configured yet, so the tab is always discoverable.
    return (
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="launch" className="gap-2">
            <Rocket className="h-4 w-4" />
            Auto-launch
          </TabsTrigger>
          <TabsTrigger value="mapping" className="gap-2">
            <Link2 className="h-4 w-4" />
            Campaign → Store mapping
          </TabsTrigger>
          <TabsTrigger value="app" className="gap-2">
            <Settings className="h-4 w-4" />
            FB App
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="m-0">
          <FacebookAdsManager
            account={selectedAccount}
            onSpendUpdate={(spend) => handleSpendUpdate(selectedAccount.id, spend)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            selectedPreset={selectedDatePreset}
            onPresetChange={setSelectedDatePreset}
          />
        </TabsContent>
        <TabsContent value="launch" className="m-0">
          <AutoLaunchAds
            adAccounts={[{ id: selectedAccount.id, name: selectedAccount.name }]}
          />
        </TabsContent>
        <TabsContent value="mapping" className="m-0">
          <CampaignMappingPanel />
        </TabsContent>
        <TabsContent value="app" className="m-0">
          <MyFacebookAppCard />
        </TabsContent>
      </Tabs>
    );
  }

  // adlux-ready
  if (!activeAccountId) {
    return <div className="text-center py-16 text-slate-500">No active account selected.</div>;
  }
  const activeAccount = adluxAccounts.find(a => a.accountId === activeAccountId);
  if (!activeAccount) {
    return <div className="text-center py-16 text-slate-500">Active account not found.</div>;
  }

  // Bridge AdluxAdAccount → FacebookAdAccount shape for the existing manager component.
  // accessToken is intentionally empty: backend will use the system-user pool.
  const bridgedAccount: FacebookAdAccount = {
    id: activeAccount.accountId,
    name: activeAccount.accountName,
    accessToken: '',
    isEnabled: true
  };

  return (
    <Tabs defaultValue="dashboard" className="space-y-4">
      <TabsList>
        <TabsTrigger value="dashboard" className="gap-2">
          <BarChart3 className="h-4 w-4" />
          Dashboard
        </TabsTrigger>
        <TabsTrigger value="launch" className="gap-2">
          <Rocket className="h-4 w-4" />
          Auto-launch
        </TabsTrigger>
        <TabsTrigger value="mapping" className="gap-2">
          <Link2 className="h-4 w-4" />
          Campaign → Store mapping
        </TabsTrigger>
        <TabsTrigger value="app" className="gap-2">
          <Settings className="h-4 w-4" />
          FB App
        </TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="space-y-4 m-0">
        {/* Account selector strip — clean Meta-style toolbar. */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Account</span>
              <Select value={activeAccountId} onValueChange={setActiveAccountId}>
                <SelectTrigger className="w-[360px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adluxAccounts.map(a => (
                    <SelectItem key={a.accountId} value={a.accountId}>
                      <div className="flex items-center gap-2">
                        {a.isFavorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
                        <span className="font-medium">{a.accountName}</span>
                        <span className="text-xs text-slate-400 font-mono">act_{a.accountId}</span>
                        {a.accountStatus !== 1 && (
                          <span className="text-xs text-amber-600">(inactive)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => toggleFavorite(activeAccount.accountId, activeAccount.isFavorite)}
                title={activeAccount.isFavorite ? 'Unfavorite' : 'Favorite'}
              >
                <Star className={cn('h-4 w-4', activeAccount.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-400')} />
              </Button>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-500">{adluxAccounts.length} account{adluxAccounts.length !== 1 ? 's' : ''}</span>
              <Button size="sm" variant="outline" onClick={refreshAccounts} disabled={refreshing}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1', refreshing && 'animate-spin')} />
                Refresh list
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMode('adlux-onboarding')}>
                <Settings className="h-3.5 w-3.5 mr-1" />
                Add accounts
              </Button>
            </div>
          </CardContent>
        </Card>

        <FacebookAdsManager
          account={bridgedAccount}
          onSpendUpdate={(spend) => handleSpendUpdate(activeAccount.accountId, spend)}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          selectedPreset={selectedDatePreset}
          onPresetChange={setSelectedDatePreset}
        />
      </TabsContent>

      <TabsContent value="launch" className="m-0">
        <AutoLaunchAds
          adAccounts={adluxAccounts.map(a => ({ id: a.accountId, name: a.accountName }))}
        />
      </TabsContent>

      <TabsContent value="mapping" className="m-0">
        <CampaignMappingPanel />
      </TabsContent>

      <TabsContent value="app" className="m-0">
        <MyFacebookAppCard />
      </TabsContent>
    </Tabs>
  );
};
