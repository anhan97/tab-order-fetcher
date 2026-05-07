import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2, Copy, ExternalLink, CheckCircle2, RefreshCw, AlertCircle,
  ArrowRight, Plus, ChevronDown, Building2, ShareIcon
} from 'lucide-react';
import { AdluxApi, AdluxAdAccount } from '@/utils/adluxApi';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface AdluxAvailable {
  accountId: string;
  accountName: string;
  status: string;
  accountStatus: number | null;
  currency: string | null;
  hasAccess: boolean;
}

interface Props {
  storeUrl: string;
  accessToken: string;
  onAccountsReady: (accounts: AdluxAdAccount[]) => void;
}

/**
 * Onboarding wizard, redesigned to lead with the accounts already in Adlux
 * BM (owned + previously shared). The "share more from your own BM"
 * instructions are still here but secondary, collapsed by default — most
 * users just click "Add all" on accounts already discovered and skip the
 * sharing step entirely.
 */
export function FacebookOnboarding({ storeUrl, accessToken, onAccountsReady }: Props) {
  const { toast } = useToast();
  const auth = { storeUrl, accessToken };

  const [adluxBmId, setAdluxBmId] = useState<string | null>(null);
  const [available, setAvailable] = useState<AdluxAvailable[]>([]);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyAdd, setBusyAdd] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [autoClaimBusinessId, setAutoClaimBusinessId] = useState('');
  const [autoClaimBusy, setAutoClaimBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  // Pull the Adlux BM id from backend status — lives in DB/env on server.
  useEffect(() => {
    AdluxApi.syncStatus()
      .then(s => setAdluxBmId(s.scheduler.bmId))
      .catch(() => setAdluxBmId(null));
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await AdluxApi.adluxAccounts(auth);
      setAvailable(r.accounts);
      // Default selection: every account NOT yet accessible to this user —
      // makes "Add all" the obvious next click.
      setSelectedSet(new Set(r.accounts.filter(a => !a.hasAccess).map(a => a.accountId)));
    } catch (e: any) {
      toast({ title: 'Failed to load Adlux accounts', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [storeUrl, accessToken]);

  // Light poll while wizard is open — picks up newly-shared accounts within
  // ~10s of them being shared (BM sync runs every 60s on backend).
  useEffect(() => {
    const id = setInterval(() => {
      reload();
      setPollCount(n => n + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [storeUrl, accessToken]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: text });
  };

  const toggleOne = (id: string, on: boolean) => {
    setSelectedSet(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const selectableCount = available.filter(a => !a.hasAccess).length;

  const addSelected = async () => {
    const ids = Array.from(selectedSet).filter(id =>
      available.find(a => a.accountId === id && !a.hasAccess)
    );
    if (ids.length === 0) {
      toast({ title: 'Nothing to add', description: 'All available accounts are already connected.' });
      return;
    }
    setBusyAdd(true);
    try {
      const r = await AdluxApi.claimBulk(auth, ids);
      toast({ title: `Connected ${r.claimed} account${r.claimed !== 1 ? 's' : ''}` });
      // After claim, fetch the user's now-accessible accounts and signal ready.
      const my = await AdluxApi.myAccounts(auth);
      if (my.accounts.length > 0) {
        onAccountsReady(my.accounts);
      } else {
        await reload();
      }
    } catch (e: any) {
      toast({ title: 'Add failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusyAdd(false);
    }
  };

  const triggerSync = async () => {
    setSyncBusy(true);
    try {
      const r = await AdluxApi.syncBm();
      toast({ title: 'BM sync done', description: `${r.discovered} discovered (${r.assigned} new)` });
      await reload();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally { setSyncBusy(false); }
  };

  const autoClaim = async () => {
    if (!autoClaimBusinessId.trim()) {
      toast({ title: 'Enter your FB Business ID first', variant: 'destructive' });
      return;
    }
    setAutoClaimBusy(true);
    try {
      const r = await AdluxApi.autoClaim(auth, autoClaimBusinessId.trim());
      toast({
        title: r.claimed.length ? `Claimed ${r.claimed.length} accounts` : 'No accounts found',
        description: r.claimed.length
          ? r.claimed.map(c => c.accountName).join(', ').slice(0, 200)
          : `Scanned ${r.totalScanned} accounts in Adlux BM but none matched business ${autoClaimBusinessId}`
      });
      await reload();
    } catch (e: any) {
      toast({ title: 'Auto-claim failed', description: e.message, variant: 'destructive' });
    } finally {
      setAutoClaimBusy(false);
    }
  };

  // Group accounts: connected (already accessible) vs available to add.
  const groups = useMemo(() => {
    const connected = available.filter(a => a.hasAccess);
    const toAdd = available.filter(a => !a.hasAccess);
    return { connected, toAdd };
  }, [available]);

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Connect your Facebook Ads</h1>
        <p className="text-slate-600">
          Pick from accounts already in <span className="font-semibold text-blue-600">Adlux BM</span>,
          or share more from your own Business Manager.
        </p>
      </div>

      {!adluxBmId && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Backend Adlux BM not configured. Admin must set BM ID + at least one system token in{' '}
            <a href="/adlux-settings" className="text-blue-600 underline">Adlux Settings</a>.
          </AlertDescription>
        </Alert>
      )}

      {/* PRIMARY: Accounts available right now */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-blue-600" />
            Accounts in Adlux BM
            <Badge variant="secondary" className="ml-2 bg-blue-50 text-blue-700">
              {available.length} total · {groups.toAdd.length} new
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 py-6 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading accounts...
            </div>
          ) : available.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-slate-500 text-sm">
                No ad accounts in Adlux BM yet. Add accounts to Adlux BM directly or share from your own BM (see below).
              </p>
              <Button variant="outline" size="sm" onClick={triggerSync} disabled={syncBusy}>
                <RefreshCw className={cn('h-4 w-4 mr-2', syncBusy && 'animate-spin')} />
                Sync Adlux BM now
              </Button>
            </div>
          ) : (
            <>
              {/* Already-connected accounts (read-only summary) */}
              {groups.connected.length > 0 && (
                <div className="rounded-md bg-emerald-50/50 border border-emerald-200 p-3 space-y-1">
                  <div className="text-xs font-medium text-emerald-700 uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Already connected ({groups.connected.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groups.connected.map(a => (
                      <span key={a.accountId} className="text-xs bg-white border border-emerald-200 text-emerald-800 rounded px-2 py-1">
                        {a.accountName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Selectable list */}
              {groups.toAdd.length > 0 && (
                <>
                  <div className="flex items-center justify-between pb-2 border-b">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedSet.size === groups.toAdd.length}
                        onCheckedChange={(v) => {
                          if (v === true) setSelectedSet(new Set(groups.toAdd.map(a => a.accountId)));
                          else setSelectedSet(new Set());
                        }}
                      />
                      <span className="font-medium">Select all {groups.toAdd.length} available</span>
                    </label>
                    <span className="text-xs text-slate-500">{selectedSet.size} selected</span>
                  </div>
                  <div className="space-y-1 max-h-[360px] overflow-y-auto">
                    {groups.toAdd.map(a => {
                      const checked = selectedSet.has(a.accountId);
                      return (
                        <label
                          key={a.accountId}
                          className={cn(
                            'flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-slate-50',
                            checked && 'bg-blue-50/50'
                          )}
                        >
                          <Checkbox checked={checked} onCheckedChange={(v) => toggleOne(a.accountId, v === true)} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{a.accountName}</div>
                            <div className="text-xs text-slate-400 font-mono">act_{a.accountId} · {a.currency || 'USD'}</div>
                          </div>
                          {a.accountStatus !== 1 && (
                            <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">inactive</Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              {selectableCount === 0 && groups.connected.length > 0 && (
                <div className="text-center py-2">
                  <Button onClick={() => onAccountsReady([])} variant="outline">
                    Open dashboard <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}

              {selectableCount > 0 && (
                <div className="flex items-center gap-2 pt-2">
                  <Button onClick={addSelected} disabled={busyAdd || selectedSet.size === 0} className="flex-1">
                    {busyAdd ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add {selectedSet.size > 0 ? `${selectedSet.size} selected` : 'selected'} & open dashboard
                  </Button>
                  <Button variant="outline" size="icon" onClick={triggerSync} disabled={syncBusy} title="Re-sync Adlux BM">
                    <RefreshCw className={cn('h-4 w-4', syncBusy && 'animate-spin')} />
                  </Button>
                </div>
              )}
            </>
          )}

          {pollCount > 0 && (
            <div className="text-center text-xs text-slate-400 pt-2">
              Auto-refreshing every 10s · {pollCount} check{pollCount === 1 ? '' : 's'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECONDARY: Share more from your own BM (collapsed by default) */}
      {adluxBmId && (
        <Card>
          <button
            type="button"
            onClick={() => setShareOpen(o => !o)}
            className="w-full text-left"
          >
            <CardHeader className="hover:bg-slate-50 cursor-pointer">
              <CardTitle className="flex items-center justify-between text-base font-medium">
                <span className="flex items-center gap-2">
                  <ShareIcon className="h-4 w-4 text-slate-500" />
                  Need to share accounts from another BM?
                </span>
                <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', shareOpen && 'rotate-180')} />
              </CardTitle>
            </CardHeader>
          </button>

          {shareOpen && (
            <CardContent className="space-y-4">
              <div className="bg-slate-50 border rounded-md p-4 space-y-2">
                <Label className="text-xs text-slate-500">Adlux Business Manager ID</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-white border rounded font-mono text-sm">{adluxBmId}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(adluxBmId)}>
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                </div>
              </div>

              <ol className="text-sm space-y-2 list-decimal pl-5 text-slate-700">
                <li>
                  Open your BM Settings:{' '}
                  <a href="https://business.facebook.com/settings/partners" target="_blank" rel="noopener" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                    business.facebook.com/settings/partners <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Click <strong>+ Add</strong> → <strong>"Give a partner access to your assets"</strong></li>
                <li>Paste the Adlux BM ID above</li>
                <li>Tick the ad accounts → check <strong>Manage campaigns</strong> + <strong>View performance</strong> → Save</li>
              </ol>

              <Alert>
                <AlertDescription className="text-xs">
                  Once shared, your accounts will appear in the list above within ~1 minute. Adlux only reads/manages the accounts you tick.
                </AlertDescription>
              </Alert>

              <div className="border-t pt-4 space-y-2">
                <Label className="text-xs text-slate-500">
                  Or auto-claim every account from your own FB Business ID
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Your FB Business ID (e.g. 1234567890)"
                    value={autoClaimBusinessId}
                    onChange={e => setAutoClaimBusinessId(e.target.value)}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button onClick={autoClaim} disabled={autoClaimBusy}>
                    {autoClaimBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Auto-claim
                  </Button>
                </div>
                <div className="text-xs text-slate-500">
                  Find your Business ID at{' '}
                  <a href="https://business.facebook.com/settings/info" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                    Business Settings → Business Info
                  </a>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
