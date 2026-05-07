import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Search, Store, RefreshCw, CheckCircle2, AlertCircle, ArrowRight, X, DollarSign, Zap } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/hooks/use-toast';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';

interface CampaignRow {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string | null;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  storeId: string | null;          // current persisted store
  storeDomain: string | null;
}

interface UserStore {
  id: string;
  storeDomain: string;
  name: string | null;
}

/**
 * Store-centric mapping panel: pick a store, then check campaigns that
 * belong to it. "Save" applies set-semantics — the store's mapping is
 * replaced with the checked set, and any campaign moved here from another
 * store is automatically transferred.
 *
 * Designed to live inside FacebookPage as a tab next to the Ads dashboard.
 */
export function CampaignMappingPanel() {
  const { shopifyConfig, isShopifyConnected, facebookAccounts, bumpMappingVersion } = useAppContext();
  const { toast } = useToast();

  const [stores, setStores] = useState<UserStore[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string>('');
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [showOnlySelected, setShowOnlySelected] = useState(false);

  // Today's spend per store (live from FB) — drives the KPI strip below.
  const [todaySpend, setTodaySpend] = useState<Record<string, number>>({});
  const [todaySpendLoading, setTodaySpendLoading] = useState<Record<string, boolean>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeRange, setRecomputeRange] = useState<'today' | 'last7' | 'last30' | 'last90'>('last7');
  const [backfilling, setBackfilling] = useState(false);

  const authHeaders = useMemo(() => {
    if (!shopifyConfig) return {} as Record<string, string>;
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
  }, [shopifyConfig]);

  const load = async () => {
    if (!shopifyConfig) return;
    setLoading(true);
    try {
      const [storesRes, campsRes] = await Promise.all([
        fetch('/api/facebook/my-stores', { headers: authHeaders }),
        fetch('/api/facebook/campaigns', { headers: authHeaders })
      ]);
      if (!storesRes.ok) throw new Error(`my-stores ${storesRes.status}`);
      if (!campsRes.ok) throw new Error(`campaigns ${campsRes.status}`);
      const storesData = await storesRes.json();
      const campsData = await campsRes.json();
      let campaignList = campsData.campaigns || [];

      // Fallback: if Adlux has no accounts for this user but we have a
      // legacy FB SDK login with accounts, fetch campaigns directly using
      // the user's own token via /campaigns/bridge. Lets the panel work
      // before the user has migrated to Adlux.
      if (campaignList.length === 0 && facebookAccounts.length > 0) {
        const enabled = facebookAccounts.filter(a => a.isEnabled);
        if (enabled.length > 0) {
          // SECURITY: no token in body — backend resolves it from DB based
          // on the authenticated user. Frontend just lists accountIds.
          const bridgeRes = await fetch('/api/facebook/campaigns/bridge', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              accounts: enabled.map(a => ({
                accountId: a.id,
                accountName: a.name
              }))
            })
          });
          if (bridgeRes.ok) {
            const bridge = await bridgeRes.json();
            campaignList = bridge.campaigns || [];
          }
        }
      }

      setStores(storesData.stores || []);
      setCampaigns(campaignList);
      // Default to the first store if none picked yet.
      if (!activeStoreId && storesData.stores?.length > 0) {
        setActiveStoreId(storesData.stores[0].id);
      }
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [shopifyConfig]);

  // When the active store changes, reset selection to whatever is currently
  // mapped to that store. User can then add/remove and save.
  useEffect(() => {
    if (!activeStoreId) { setSelectedSet(new Set()); return; }
    const currentlyMapped = campaigns
      .filter(c => c.storeId === activeStoreId)
      .map(c => c.campaignId);
    setSelectedSet(new Set(currentlyMapped));
  }, [activeStoreId, campaigns]);

  const accountList = useMemo(() => {
    const set = new Map<string, string>();
    for (const c of campaigns) set.set(c.accountId, c.accountName || c.accountId);
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [campaigns]);

  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      if (filterAccount !== 'all' && c.accountId !== filterAccount) return false;
      if (showOnlySelected && !selectedSet.has(c.campaignId)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.campaignName.toLowerCase().includes(q) && !c.campaignId.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, filterAccount, search, showOnlySelected, selectedSet]);

  // Diff vs persisted state — drives the "unsaved changes" footer.
  const diff = useMemo(() => {
    if (!activeStoreId) return { added: [], removed: [], transferred: [], hasChanges: false };
    const currentlyMappedHere = new Set(campaigns.filter(c => c.storeId === activeStoreId).map(c => c.campaignId));
    const added: string[] = [];
    const removed: string[] = [];
    const transferred: Array<{ id: string; fromDomain: string }> = [];
    for (const id of selectedSet) {
      if (!currentlyMappedHere.has(id)) {
        const c = campaigns.find(x => x.campaignId === id);
        if (c?.storeId && c.storeId !== activeStoreId) {
          transferred.push({ id, fromDomain: c.storeDomain || c.storeId });
        } else {
          added.push(id);
        }
      }
    }
    for (const id of currentlyMappedHere) {
      if (!selectedSet.has(id)) removed.push(id);
    }
    return { added, removed, transferred, hasChanges: added.length + removed.length + transferred.length > 0 };
  }, [activeStoreId, selectedSet, campaigns]);

  const toggleOne = (campaignId: string, checked: boolean) => {
    setSelectedSet(prev => {
      const next = new Set(prev);
      if (checked) next.add(campaignId); else next.delete(campaignId);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedSet(prev => {
      const next = new Set(prev);
      for (const c of filtered) {
        if (checked) next.add(c.campaignId); else next.delete(c.campaignId);
      }
      return next;
    });
  };

  const resetChanges = () => {
    const currentlyMapped = campaigns
      .filter(c => c.storeId === activeStoreId)
      .map(c => c.campaignId);
    setSelectedSet(new Set(currentlyMapped));
  };

  // Fetch live "today" spend for one store. Uses /store-spend-today which
  // applies mapping → only sums campaigns mapped to that store.
  const loadTodaySpend = async (sid: string) => {
    setTodaySpendLoading(p => ({ ...p, [sid]: true }));
    try {
      const res = await fetch(`/api/facebook/store-spend-today?storeId=${encodeURIComponent(sid)}`, { headers: authHeaders });
      if (res.ok) {
        const j = await res.json();
        setTodaySpend(p => ({ ...p, [sid]: Number(j.spend) || 0 }));
      }
    } catch { /* ignore — keep stale */ }
    finally { setTodaySpendLoading(p => ({ ...p, [sid]: false })); }
  };

  // Refresh today's spend for every store with mappings.
  const loadAllTodaySpend = async () => {
    const sids = stores
      .filter(s => campaigns.some(c => c.storeId === s.id))
      .map(s => s.id);
    await Promise.all(sids.map(loadTodaySpend));
  };

  // Auto-load today's spend whenever campaigns change (mappings applied).
  useEffect(() => {
    if (stores.length === 0 || campaigns.length === 0) return;
    void loadAllTodaySpend();
  }, [stores, campaigns]);

  // Force-recompute: backfill snapshots + recompute P&L for the active store.
  // Mapping changes don't propagate to P&L automatically — this button does it.
  const recomputeNow = async () => {
    if (!activeStoreId) {
      toast({ title: 'Pick a store first', variant: 'destructive' });
      return;
    }
    const days = recomputeRange === 'today' ? 0
      : recomputeRange === 'last7' ? 7
      : recomputeRange === 'last30' ? 30
      : 90;
    const until = new Date();
    until.setUTCHours(23, 59, 59, 999);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    setRecomputing(true);
    try {
      const res = await fetch('/api/facebook/recompute-store-spend', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          storeId: activeStoreId,
          since: since.toISOString(),
          until: until.toISOString()
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const result = await res.json();
      const total = result.spend.daily.reduce((s: number, d: { spend: number }) => s + d.spend, 0);
      toast({
        title: 'Recompute done',
        description: `${result.spend.daysBackfilled}d snapshots + ${result.pl.days}d P&L · $${total.toFixed(2)} mapped spend`
      });
      await loadTodaySpend(activeStoreId);
    } catch (e: any) {
      toast({ title: 'Recompute failed', description: e.message, variant: 'destructive' });
    } finally {
      setRecomputing(false);
    }
  };

  // Wipe + re-snapshot the last 90 days for the active store. Use when
  // historical numbers look wrong — much wider window than the standard
  // recompute, and overwrites stale snapshot rows.
  const backfillAll = async () => {
    if (!activeStoreId) {
      toast({ title: 'Pick a store first', variant: 'destructive' });
      return;
    }
    if (!confirm('Re-snapshot the last 90 days from Facebook for this store? This burns ~90 × N-account FB reads but fixes stale historical data.')) return;

    setBackfilling(true);
    try {
      const res = await fetch('/api/facebook/backfill-store-spend', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ storeId: activeStoreId, daysBack: 90 })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const result = await res.json();
      const total = (result.spend?.daily || []).reduce((s: number, d: { spend: number }) => s + d.spend, 0);
      toast({
        title: 'Backfill complete',
        description: `${result.spend?.daysBackfilled || 0}d snapshots + ${result.pl?.days || 0}d P&L · $${total.toFixed(2)} mapped over ${result.daysRequested}d`
      });
      await loadTodaySpend(activeStoreId);
    } catch (e: any) {
      toast({ title: 'Backfill failed', description: e.message, variant: 'destructive' });
    } finally {
      setBackfilling(false);
    }
  };

  const save = async () => {
    if (!activeStoreId || !diff.hasChanges) return;
    setSaving(true);
    try {
      const payload = {
        storeId: activeStoreId,
        campaigns: campaigns
          .filter(c => selectedSet.has(c.campaignId))
          .map(c => ({ campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId }))
      };
      const res = await fetch('/api/facebook/campaign-mapping/save-for-store', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const result = await res.json();
      toast({
        title: 'Saved',
        description: `+${result.added} new · ${result.removed} removed · ${result.transferred} transferred from other stores`
      });
      await load();  // refresh persisted state
      // Notify Dashboard / Analytics / ProfitView so their mapped fbAdSpend
      // re-fetches without F5. Today's spend reflects the new mapping
      // immediately (live cache); historical days need a Recompute.
      bumpMappingVersion();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!isShopifyConnected) {
    return <Card><CardContent className="p-6 text-center text-slate-500">Connect Shopify first.</CardContent></Card>;
  }
  if (stores.length === 0 && !loading) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No Shopify stores found. Connect one via the Connect page first.</AlertDescription>
      </Alert>
    );
  }

  const activeStore = stores.find(s => s.id === activeStoreId);
  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selectedSet.has(c.campaignId));

  // Per-store summary cards (only stores that have mappings).
  const storesWithMappings = useMemo(() => {
    const sidsWithMapping = new Set(
      campaigns.filter(c => c.storeId).map(c => c.storeId as string)
    );
    return stores.filter(s => sidsWithMapping.has(s.id));
  }, [stores, campaigns]);

  return (
    <div className="space-y-4 pb-32">  {/* extra bottom padding so sticky save bar doesn't cover content */}

      {/* Per-store TODAY's spend KPI strip — instant verification that
          mapping is producing the right number for each store. */}
      {storesWithMappings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              Today's spend per store (mapped campaigns only)
            </h3>
            <Button size="sm" variant="ghost" onClick={loadAllTodaySpend} className="text-xs">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {storesWithMappings.map(s => {
              const spend = todaySpend[s.id];
              const isLoading = todaySpendLoading[s.id];
              const mappedCount = campaigns.filter(c => c.storeId === s.id).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveStoreId(s.id)}
                  className={cn(
                    'text-left p-3 rounded-md border bg-white hover:border-blue-300 transition-colors',
                    activeStoreId === s.id && 'ring-2 ring-blue-500 border-blue-300'
                  )}
                >
                  <div className="text-xs text-slate-500 truncate" title={s.storeDomain}>{s.storeDomain}</div>
                  <div className="text-lg font-bold mt-1">
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin inline text-slate-400" />
                    ) : spend !== undefined ? (
                      `$${spend.toFixed(2)}`
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{mappedCount} camp · today</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recompute panel — re-runs snapshot + P&L for a date range using
          current mapping. Use after editing mappings or when P&L looks off.
          The "Update all historical" button does a full 90-day rebuild —
          burns more FB quota but overwrites every stale snapshot row. */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="font-medium">Recompute spend & P&L for active store</span>
          </div>
          <Select value={recomputeRange} onValueChange={(v) => setRecomputeRange(v as any)}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today only</SelectItem>
              <SelectItem value="last7">Last 7 days</SelectItem>
              <SelectItem value="last30">Last 30 days</SelectItem>
              <SelectItem value="last90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={recomputeNow} disabled={recomputing || backfilling || !activeStoreId} size="sm" variant="outline">
            {recomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Recompute
          </Button>
          <Button
            onClick={backfillAll}
            disabled={recomputing || backfilling || !activeStoreId}
            size="sm"
            className="ml-auto bg-amber-600 hover:bg-amber-700"
            title="Wipe + re-snapshot last 90 days. Use if historical numbers look wrong."
          >
            {backfilling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Update all historical (90d)
          </Button>
        </CardContent>
      </Card>

      {/* Top: store picker + summary */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[280px]">
              <Label className="text-xs text-slate-500 uppercase tracking-wide">Configuring store</Label>
              <Select value={activeStoreId} onValueChange={setActiveStoreId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pick a store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <Store className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-medium">{s.storeDomain}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-600">{selectedSet.size}</div>
                <div className="text-xs text-slate-500">selected</div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-300" />
              <div>
                <div className="text-2xl font-bold">{campaigns.filter(c => c.storeId === activeStoreId).length}</div>
                <div className="text-xs text-slate-500">currently mapped</div>
              </div>
              <div className="h-10 w-px bg-slate-200" />
              <div>
                <div className="text-2xl font-bold text-slate-700">{campaigns.length}</div>
                <div className="text-xs text-slate-500">total campaigns</div>
              </div>
            </div>

            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters + select-all */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by campaign name or ID"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts ({accountList.length})</SelectItem>
                {accountList.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <Checkbox checked={showOnlySelected} onCheckedChange={(v) => setShowOnlySelected(v === true)} />
              Show selected only
            </label>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{filtered.length} of {campaigns.length} campaigns visible</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => toggleAllVisible(v === true)}
              />
              Select all visible
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Campaign list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin mr-3" /> Loading campaigns...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              {campaigns.length === 0
                ? 'No campaigns visible. Make sure your ad accounts are connected via Adlux Settings.'
                : 'No campaigns match the current filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-y text-xs text-slate-600 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2 w-[40px]"></th>
                    <th className="text-left px-4 py-2 font-semibold">Campaign</th>
                    <th className="text-left px-4 py-2 font-semibold">Account</th>
                    <th className="text-left px-4 py-2 font-semibold">Status</th>
                    <th className="text-left px-4 py-2 font-semibold">Current store</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const checked = selectedSet.has(c.campaignId);
                    const mappedHere = c.storeId === activeStoreId;
                    const mappedElsewhere = c.storeId && c.storeId !== activeStoreId;
                    return (
                      <tr
                        key={c.campaignId}
                        className={cn(
                          'border-b hover:bg-slate-50/50 cursor-pointer',
                          checked && 'bg-blue-50/40 hover:bg-blue-50/60',
                          mappedElsewhere && !checked && 'bg-amber-50/30'
                        )}
                        onClick={() => toggleOne(c.campaignId, !checked)}
                      >
                        <td className="px-4 py-2">
                          <Checkbox checked={checked} onCheckedChange={(v) => toggleOne(c.campaignId, v === true)} onClick={e => e.stopPropagation()} />
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium truncate max-w-md" title={c.campaignName}>{c.campaignName}</div>
                          <div className="text-xs text-slate-400 font-mono">{c.campaignId}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          <div className="truncate max-w-[180px]" title={c.accountName || ''}>{c.accountName || '—'}</div>
                          <div className="text-xs text-slate-400 font-mono">act_{c.accountId}</div>
                        </td>
                        <td className="px-4 py-2">
                          <StatusPill status={c.status || ''} effectiveStatus={c.effectiveStatus || undefined} />
                        </td>
                        <td className="px-4 py-2">
                          {mappedHere ? (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200">
                              ✓ this store
                            </Badge>
                          ) : mappedElsewhere ? (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200">
                              {c.storeDomain}
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky save bar — only renders when there are unsaved changes */}
      {diff.hasChanges && activeStore && (
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-40 bg-white border-t border-slate-200 shadow-lg">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-medium">{activeStore.storeDomain}</span>
              <span className="text-slate-400">→</span>
              {diff.added.length > 0 && (
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  +{diff.added.length} new
                </Badge>
              )}
              {diff.transferred.length > 0 && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  ⇄ {diff.transferred.length} transferred
                </Badge>
              )}
              {diff.removed.length > 0 && (
                <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200">
                  −{diff.removed.length} removed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={resetChanges} disabled={saving}>
                <X className="h-4 w-4 mr-1" /> Reset
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Save mapping
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
