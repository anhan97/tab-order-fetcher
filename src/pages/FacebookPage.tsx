import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart3, Loader2, Star, Settings, RefreshCw, Link2, KeyRound, Building2, LogOut, ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useAppContext } from '@/context/AppContext';
import { FacebookAdsConnection } from '@/components/FacebookAdsConnection';
import { FacebookAdsManager } from '@/components/FacebookAdsManager';
import { FacebookOnboarding } from '@/components/FacebookOnboarding';
import { CampaignMappingPanel } from '@/components/CampaignMappingPanel';
import { MyFacebookAppCard } from '@/components/MyFacebookAppCard';
import { AutoLaunchAds } from '@/components/AutoLaunchAds';
import { FacebookDiagnostics } from '@/components/FacebookDiagnostics';
import { Rocket, Stethoscope } from 'lucide-react';
import { AdluxApi, AdluxAdAccount } from '@/utils/adluxApi';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { FacebookAdAccount } from '@/types/facebook';

type Mode = 'loading' | 'shopify-required' | 'adlux-onboarding' | 'adlux-ready' | 'legacy-fb-login';

/**
 * Which connection mode the merchant has explicitly chosen. Persisted in
 * localStorage so they don't have to re-pick on every visit.
 *   - 'unset':       no explicit choice yet → show the picker
 *   - 'user-token':  per-user FB Login (60-day token, auto-refresh cron)
 *   - 'system-bm':   Adlux multi-tenant pool (system-user token, never expires)
 */
type ModePreference = 'unset' | 'user-token' | 'system-bm';
const MODE_PREF_KEY = 'fb_mode_preference';

function readModePref(): ModePreference {
  const v = localStorage.getItem(MODE_PREF_KEY);
  if (v === 'user-token' || v === 'system-bm') return v;
  return 'unset';
}

export const FacebookPage = () => {
  const {
    isShopifyConnected,
    shopifyConfig,
    isFacebookConnected,
    handleFacebookConnectionSuccess,
    handleDisconnectFacebook,
    selectedAccount,
    setSelectedAccount,
    handleSpendUpdate,
    dateRange,
    setDateRange,
    selectedDatePreset,
    setSelectedDatePreset
  } = useAppContext();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode | 'mode-picker'>('loading');
  const [adluxAccounts, setAdluxAccounts] = useState<AdluxAdAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [poolEnabled, setPoolEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modePref, setModePref] = useState<ModePreference>(readModePref);
  const [disconnecting, setDisconnecting] = useState(false);

  /**
   * Resolve which screen to show. Honors the merchant's explicit choice from
   * the mode picker — when unset, falls through to a chooser screen rather
   * than auto-detecting (so they can switch between modes deliberately).
   */
  useEffect(() => {
    if (!isShopifyConnected || !shopifyConfig) {
      setMode('shopify-required');
      return;
    }

    // No explicit mode chosen yet → ask.
    if (modePref === 'unset') {
      setMode('mode-picker');
      return;
    }

    let cancelled = false;
    (async () => {
      // user-token mode: skip Adlux entirely, use FB SDK login flow.
      if (modePref === 'user-token') {
        setMode('legacy-fb-login');
        return;
      }

      // system-bm mode: enforce Adlux pool. If pool isn't configured, the
      // user explicitly asked for it — surface an actionable message rather
      // than silently downgrading to user-token.
      try {
        const status = await AdluxApi.syncStatus();
        if (cancelled) return;
        const adluxOn = status.pool.configured && !!status.scheduler.bmId;
        setPoolEnabled(adluxOn);
        if (!adluxOn) {
          setMode('mode-picker'); // show error + let them switch
          toast({
            title: 'Adlux pool not configured',
            description: 'Set FB_ADLUX_BM_ID + system-user tokens in Adlux Settings, or switch to user-token mode.',
            variant: 'destructive'
          });
          return;
        }
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
        if (!cancelled) setMode('mode-picker');
      }
    })();
    return () => { cancelled = true; };
  }, [isShopifyConnected, shopifyConfig, isFacebookConnected, modePref, toast]);

  const choose = (m: ModePreference) => {
    if (m === 'unset') localStorage.removeItem(MODE_PREF_KEY);
    else localStorage.setItem(MODE_PREF_KEY, m);
    setModePref(m);
  };

  /**
   * Sign out from BOTH FB connection types and reset the mode picker so the
   * merchant can deliberately pick a different mode.
   */
  const handleDisconnectAll = async () => {
    if (!confirm('Sign out of Facebook everywhere? This wipes both the user-token connection and any Adlux account claims.')) return;
    setDisconnecting(true);
    try {
      await apiFetch('/api/facebook/disconnect-all', { method: 'DELETE' });
      // Reset all client-side caches so the next picker render starts fresh.
      try {
        localStorage.removeItem('facebook_accounts');
        localStorage.removeItem('facebook_access_token');
      } catch { /* ignore */ }
      choose('unset');
      setAdluxAccounts([]);
      setActiveAccountId(null);
      // Flip AppContext's isFacebookConnected so the sidebar/Layout reflects
      // the change immediately, and clear any cached FB state.
      try { handleDisconnectFacebook(); } catch { /* tolerate — already disconnected */ }
      toast({ title: 'Signed out of Facebook', description: 'Pick a connection mode to start over.' });
      setMode('mode-picker');
    } catch (e: any) {
      toast({ title: 'Sign-out failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

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

  if (mode === 'mode-picker') {
    return (
      <div className="max-w-3xl mx-auto mt-8 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold text-slate-900">Choose Facebook connection mode</h2>
          <p className="text-sm text-slate-500 mt-1">
            Pick the mode that fits your setup. You can switch later by clicking "Disconnect Facebook" on the connected page.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* User token mode */}
          <button
            onClick={() => choose('user-token')}
            className={cn(
              "text-left rounded-xl border-2 p-6 transition-all bg-white",
              "hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100",
              "border-slate-200"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl shadow-sm shadow-blue-500/30 shrink-0">
                <KeyRound className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">User Token</h3>
                  <span className="text-[10px] uppercase tracking-wider font-medium text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                    Personal account
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  Sign in with your personal Facebook account. The app gets a 60-day token that auto-refreshes daily — no Business Manager needed.
                </p>
                <ul className="text-xs text-slate-500 mt-2.5 space-y-0.5">
                  <li>✓ Quick to set up — just FB login</li>
                  <li>✓ Token auto-extends every ~50 days</li>
                  <li>✗ Limited to ad accounts you personally own / have access to</li>
                </ul>
              </div>
            </div>
          </button>

          {/* System User / BM mode */}
          <button
            onClick={() => choose('system-bm')}
            className={cn(
              "text-left rounded-xl border-2 p-6 transition-all bg-white",
              "hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100",
              "border-slate-200"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-sm shadow-emerald-500/30 shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">System User + BM</h3>
                  <span className="text-[10px] uppercase tracking-wider font-medium text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
                    Adlux multi-tenant
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  Share your ad accounts to the Adlux Business Manager. We use a system-user token that <strong>never expires</strong> — the right choice for production.
                </p>
                <ul className="text-xs text-slate-500 mt-2.5 space-y-0.5">
                  <li>✓ Token never expires</li>
                  <li>✓ Manage multiple ad accounts at once</li>
                  <li>✗ Requires BM share + admin role</li>
                </ul>
              </div>
            </div>
          </button>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          Tip: most production stores use System User mode. User Token is great for trying the app quickly.
        </p>
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
      <div className="space-y-4">
        <ModeStatusBar mode="system-bm" onDisconnect={handleDisconnectAll} disconnecting={disconnecting} onSwitch={() => choose('unset')} unconnected />
        <FacebookOnboarding
          storeUrl={shopifyConfig.storeUrl}
          accessToken={shopifyConfig.accessToken}
          onAccountsReady={(accounts) => {
            setAdluxAccounts(accounts);
            setActiveAccountId(accounts[0]?.accountId || null);
            setMode('adlux-ready');
          }}
        />
      </div>
    );
  }

  if (mode === 'legacy-fb-login') {
    if (!isFacebookConnected) {
      return (
        <div className="max-w-2xl mx-auto mt-8 space-y-4">
          <ModeStatusBar mode="user-token" onDisconnect={handleDisconnectAll} disconnecting={disconnecting} onSwitch={() => choose('unset')} unconnected />
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
      <div className="space-y-4">
        <ModeStatusBar mode="user-token" onDisconnect={handleDisconnectAll} disconnecting={disconnecting} onSwitch={() => choose('unset')} />
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
          <TabsTrigger value="diagnostics" className="gap-2">
            <Stethoscope className="h-4 w-4" />
            Diagnostics
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
        <TabsContent value="diagnostics" className="m-0">
          <FacebookDiagnostics />
        </TabsContent>
        <TabsContent value="mapping" className="m-0">
          <CampaignMappingPanel />
        </TabsContent>
        <TabsContent value="app" className="m-0">
          <MyFacebookAppCard />
        </TabsContent>
      </Tabs>
      </div>
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
    <div className="space-y-4">
      <ModeStatusBar mode="system-bm" onDisconnect={handleDisconnectAll} disconnecting={disconnecting} onSwitch={() => choose('unset')} />
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
        <TabsTrigger value="diagnostics" className="gap-2">
          <Stethoscope className="h-4 w-4" />
          Diagnostics
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

      <TabsContent value="diagnostics" className="m-0">
        <FacebookDiagnostics />
      </TabsContent>

      <TabsContent value="mapping" className="m-0">
        <CampaignMappingPanel />
      </TabsContent>

      <TabsContent value="app" className="m-0">
        <MyFacebookAppCard />
      </TabsContent>
    </Tabs>
    </div>
  );
};

interface ModeStatusBarProps {
  mode: 'user-token' | 'system-bm';
  onDisconnect: () => void;
  disconnecting: boolean;
  onSwitch: () => void;
  unconnected?: boolean;
}

/**
 * Thin strip shown above every connected (or about-to-connect) FB view that
 * explains which mode the merchant picked + lets them switch out cleanly.
 * Both buttons go through the same disconnect-all path so we never end up
 * in a weird half-connected state.
 */
function ModeStatusBar({ mode, onDisconnect, disconnecting, onSwitch, unconnected }: ModeStatusBarProps) {
  const isUserToken = mode === 'user-token';
  return (
    <Card className={cn(
      "border",
      isUserToken ? "border-blue-200 bg-blue-50/40" : "border-emerald-200 bg-emerald-50/40"
    )}>
      <CardContent className="p-3 flex flex-wrap items-center gap-3">
        <div className={cn(
          "p-1.5 rounded-lg shrink-0",
          isUserToken ? "bg-gradient-to-br from-blue-500 to-violet-600" : "bg-gradient-to-br from-emerald-500 to-teal-600"
        )}>
          {isUserToken ? <KeyRound className="h-3.5 w-3.5 text-white" /> : <Building2 className="h-3.5 w-3.5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-900">
            {isUserToken ? 'User Token mode' : 'System User + BM mode'}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {isUserToken
              ? 'Personal FB account · 60-day token (auto-refresh)'
              : 'Adlux multi-tenant · system-user token (never expires)'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="ghost" size="sm" onClick={onSwitch} disabled={disconnecting} title="Go back to mode picker (without disconnecting)">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Switch mode
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnecting}
            className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 hover:bg-rose-50"
          >
            <LogOut className="h-3.5 w-3.5 mr-1" />
            {disconnecting ? 'Signing out...' : (unconnected ? 'Disconnect everything' : 'Disconnect Facebook')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
