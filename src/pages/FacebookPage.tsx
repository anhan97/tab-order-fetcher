import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart3, Loader2, Settings, Link2, LogOut, Rocket, Stethoscope, Library } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { FacebookAdsConnection } from '@/components/FacebookAdsConnection';
import { AvailableAppsPicker } from '@/components/AvailableAppsPicker';
import { FacebookAdsManager } from '@/components/FacebookAdsManager';
import { CampaignMappingPanel } from '@/components/CampaignMappingPanel';
import { MyFacebookAppCard } from '@/components/MyFacebookAppCard';
import { FacebookAppsManager } from '@/components/FacebookAppsManager';
import { AutoLaunchAds } from '@/components/AutoLaunchAds';
import { FacebookDiagnostics } from '@/components/FacebookDiagnostics';
import { FacebookAssetManager } from '@/components/FacebookAssetManager';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

/**
 * Facebook page — single mode, just FB Login.
 *
 * Was previously a dual-mode (User Token vs Adlux System User) flow with a
 * picker. Switched back to the simpler design: user authenticates to their
 * own FB App once, the long-lived token lives in the DB and the daily
 * refresh cron keeps it alive. From that token we surface their BMs, ad
 * accounts, and pages — no BM-share onboarding required.
 */
export const FacebookPage = () => {
  const {
    isShopifyConnected,
    isFacebookConnected,
    handleFacebookConnectionSuccess,
    handleDisconnectFacebook,
    selectedAccount,
    handleSpendUpdate,
    dateRange,
    setDateRange,
    selectedDatePreset,
    setSelectedDatePreset,
    facebookAccounts
  } = useAppContext();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [disconnecting, setDisconnecting] = useState(false);

  if (!isShopifyConnected) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card className="p-10 text-center">
          <div className="p-5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-2xl w-20 h-20 mx-auto flex items-center justify-center shadow-lg shadow-blue-500/30 mb-6">
            <BarChart3 className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect Shopify first</h2>
          <p className="text-slate-600">
            Need a Shopify connection to identify your account. Open <strong>Connect</strong> in the sidebar to start.
          </p>
        </Card>
      </div>
    );
  }

  // Not connected to FB → setup flow.
  if (!isFacebookConnected || !selectedAccount) {
    return (
      <div className="max-w-2xl mx-auto mt-8 space-y-4">
        {/* Admin's setup flow keeps the original MyFacebookAppCard so they
            can register a fresh app inline. Non-admin users get the
            AvailableAppsPicker which lists every app they can connect
            through — own apps + apps the admin has assigned via the
            FacebookAppUserAccess pivot. */}
        {isAdmin && <MyFacebookAppCard />}
        <AvailableAppsPicker onConnectionSuccess={handleFacebookConnectionSuccess} />
        {/* Legacy single-button connect kept as fallback in case the
            picker can't render (e.g. /available-apps fails). Hidden by
            default — the picker handles the happy path. */}
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer hover:text-slate-600">Show legacy single-app connect</summary>
          <div className="mt-3">
            <FacebookAdsConnection onConnectionSuccess={handleFacebookConnectionSuccess} />
          </div>
        </details>
      </div>
    );
  }

  const handleDisconnect = async () => {
    if (!confirm('Sign out of Facebook? Your stored long-lived token will be deleted.')) return;
    setDisconnecting(true);
    try {
      await apiFetch('/api/facebook/disconnect-all', { method: 'DELETE' });
      try { handleDisconnectFacebook(); } catch { /* tolerate */ }
      try {
        localStorage.removeItem('facebook_accounts');
        localStorage.removeItem('facebook_access_token');
      } catch { /* ignore */ }
      toast({ title: 'Signed out of Facebook' });
    } catch (e: any) {
      toast({ title: 'Sign-out failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status strip — shows connection state + disconnect button. Replaces
          the old dual-mode ModeStatusBar. */}
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shrink-0">
            <BarChart3 className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-900">Connected to Facebook</div>
            <div className="text-[11px] text-slate-500 truncate">
              {facebookAccounts.length} ad account{facebookAccounts.length === 1 ? '' : 's'} accessible · 60-day token (auto-refresh)
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 hover:bg-rose-50 ml-auto"
          >
            <LogOut className="h-3.5 w-3.5 mr-1" />
            {disconnecting ? 'Signing out...' : 'Disconnect Facebook'}
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="assets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="assets" className="gap-2">
            <Library className="h-4 w-4" />
            Assets
          </TabsTrigger>
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
            Mapping
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="app" className="gap-2">
              <Settings className="h-4 w-4" />
              FB App
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="assets" className="m-0">
          <FacebookAssetManager />
        </TabsContent>

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
            adAccounts={facebookAccounts.map(a => ({ id: a.id, name: a.name }))}
          />
        </TabsContent>

        <TabsContent value="diagnostics" className="m-0">
          <FacebookDiagnostics />
        </TabsContent>

        <TabsContent value="mapping" className="m-0">
          <CampaignMappingPanel />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="app" className="m-0">
            <FacebookAppsManager />
          </TabsContent>
        )}
      </Tabs>

      {!isFacebookConnected && (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          Loading...
        </div>
      )}
    </div>
  );
};
