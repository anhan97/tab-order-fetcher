import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Save, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/hooks/use-toast';

interface UserStore {
  id: string;
  storeDomain: string;
  name: string | null;
}

interface CampaignRow {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string | null;
  status: string | null;
  effectiveStatus: string | null;
  storeId: string | null;        // existing mapping (from server)
  storeDomain: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ad account whose campaigns we're mapping. */
  accountId: string;
  accountName: string;
}

/**
 * Per-account mapping dialog opened from FacebookAssetManager.
 *
 * Flow: user enrolls or clicks "Map campaigns" on an enrolled ad account →
 * dialog loads /campaigns + /my-stores, filters to THIS account, lets user
 * pick a target store per campaign (or "Unmapped"). On save we:
 *   1. Group selections by storeId.
 *   2. For each store touched, POST /campaign-mapping/save-for-store with
 *      the union of (existing mapping for that store, in OTHER accounts)
 *      + (newly-selected campaigns from THIS account → that store).
 *   3. Bump AppContext.mappingVersion → Dashboard / Analytics / ProfitView
 *      auto-refetch fbAdSpend.
 *
 * "save-for-store" replaces the store's mapping with the given list, so we
 * MUST union with existing mappings from other accounts to avoid wiping
 * them. The /campaign-mapping (PUT) per-row endpoint would also work but
 * it's N round-trips vs N-stores-touched.
 */
export function CampaignMappingDialog({ open, onOpenChange, accountId, accountName }: Props) {
  const { shopifyConfig, bumpMappingVersion } = useAppContext();
  const { toast } = useToast();

  const [stores, setStores] = useState<UserStore[]>([]);
  const [allCampaigns, setAllCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  /** campaignId → target storeId | '' (unmapped). Local edits only. */
  const [picks, setPicks] = useState<Record<string, string>>({});

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
      let campaignList: CampaignRow[] = (await campsRes.json()).campaigns || [];

      // Bridge fallback: when Adlux pool is empty, /campaigns returns nothing
      // but /campaigns/bridge fetches via the user's own FB token.
      if (campaignList.length === 0) {
        const bridgeRes = await fetch('/api/facebook/campaigns/bridge', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ accounts: [{ accountId, accountName }] })
        });
        if (bridgeRes.ok) {
          campaignList = (await bridgeRes.json()).campaigns || [];
        }
      }

      setStores(storesData.stores || []);
      setAllCampaigns(campaignList);
      // Seed picks from existing mappings.
      const seeded: Record<string, string> = {};
      for (const c of campaignList) {
        if (c.accountId === accountId) seeded[c.campaignId] = c.storeId || '';
      }
      setPicks(seeded);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) void load(); /* eslint-disable-next-line */ }, [open, accountId]);

  const accountCampaigns = useMemo(() => {
    return allCampaigns
      .filter(c => c.accountId === accountId)
      .filter(c => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return c.campaignName.toLowerCase().includes(q) || c.campaignId.includes(q);
      });
  }, [allCampaigns, accountId, search]);

  const setPick = (campaignId: string, storeId: string) => {
    setPicks(prev => ({ ...prev, [campaignId]: storeId }));
  };

  const bulkAssign = (storeId: string) => {
    setPicks(prev => {
      const next = { ...prev };
      for (const c of accountCampaigns) next[c.campaignId] = storeId;
      return next;
    });
  };

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const c of accountCampaigns) {
      const before = c.storeId || '';
      const after = picks[c.campaignId] ?? '';
      if (before !== after) n++;
    }
    return n;
  }, [accountCampaigns, picks]);

  const save = async () => {
    if (dirtyCount === 0) { onOpenChange(false); return; }
    setSaving(true);
    try {
      // For each store touched (either gaining or losing a campaign in this
      // account), compute new full mapping list = (existing mappings in
      // OTHER accounts for that store) + (campaigns FROM this account
      // newly assigned to that store). Then POST save-for-store.
      const storesTouched = new Set<string>();
      for (const c of accountCampaigns) {
        const before = c.storeId || '';
        const after = picks[c.campaignId] ?? '';
        if (before && before !== after) storesTouched.add(before);
        if (after && before !== after) storesTouched.add(after);
      }

      for (const sid of storesTouched) {
        const keepFromOtherAccounts = allCampaigns
          .filter(c => c.accountId !== accountId && c.storeId === sid);
        const fromThisAccount = accountCampaigns
          .filter(c => (picks[c.campaignId] ?? '') === sid);
        const merged = [...keepFromOtherAccounts, ...fromThisAccount].map(c => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          accountId: c.accountId
        }));
        const res = await fetch('/api/facebook/campaign-mapping/save-for-store', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ storeId: sid, campaigns: merged })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `save-for-store ${res.status}`);
        }
      }
      toast({
        title: 'Mapping saved',
        description: `${dirtyCount} campaign${dirtyCount === 1 ? '' : 's'} updated across ${storesTouched.size} store${storesTouched.size === 1 ? '' : 's'}.`
      });
      bumpMappingVersion();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Map campaigns → store
            <Badge variant="outline" className="font-mono text-xs">{accountName}</Badge>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading campaigns…
          </div>
        ) : stores.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>No Shopify stores found. Add a store first via /connect.</AlertDescription>
          </Alert>
        ) : accountCampaigns.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No campaigns found for this ad account. The account may have no campaigns yet,
              or your FB token doesn't have ads_read access on it.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by campaign name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <Select onValueChange={(v) => bulkAssign(v === '__unmap' ? '' : v)}>
                <SelectTrigger className="w-56 h-9">
                  <SelectValue placeholder="Bulk-assign all visible…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unmap">→ Unmap all</SelectItem>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>→ {s.name || s.storeDomain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Campaign list */}
            <div className="border rounded-md max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 z-10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Campaign</th>
                    <th className="text-left px-3 py-2 w-32">Status</th>
                    <th className="text-left px-3 py-2 w-56">Mapped to store</th>
                  </tr>
                </thead>
                <tbody>
                  {accountCampaigns.map(c => {
                    const before = c.storeId || '';
                    const after = picks[c.campaignId] ?? '';
                    const isDirty = before !== after;
                    return (
                      <tr key={c.campaignId} className={isDirty ? 'bg-amber-50/40' : 'hover:bg-slate-50/50 border-t border-slate-100'}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900 truncate max-w-md" title={c.campaignName}>{c.campaignName}</div>
                          <div className="text-xs text-slate-500 font-mono">{c.campaignId}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.effectiveStatus === 'ACTIVE' ? (
                            <span className="text-emerald-600">Active</span>
                          ) : c.effectiveStatus === 'PAUSED' ? (
                            <span className="text-amber-600">Paused</span>
                          ) : (
                            <span className="text-slate-500">{c.effectiveStatus || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Select value={after || '__unmap'} onValueChange={(v) => setPick(c.campaignId, v === '__unmap' ? '' : v)}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unmap"><span className="text-slate-500">Unmapped</span></SelectItem>
                              {stores.map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.name || s.storeDomain}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              {dirtyCount > 0 ? <>{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}.</> : 'No changes.'}
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || dirtyCount === 0} className="bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
