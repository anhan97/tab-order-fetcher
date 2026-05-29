/**
 * Past-launches list + drill-down + rollback action.
 *
 * Pulls from /api/ads/history (list) and /api/ads/history/:id (detail).
 * Rollback POSTs to /api/ads/history/:id/rollback which deletes the
 * campaign on FB and flips status=rolled_back locally.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, ChevronRight, ChevronDown, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
import { HistoryRow, HistoryDetail } from './types';

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  rolled_back: 'bg-slate-50 text-slate-600 border-slate-200',
  pending: 'bg-blue-50 text-blue-700 border-blue-200'
};

export const LaunchHistory = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, HistoryDetail>>({});
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { history } = await apiFetch<{ history: HistoryRow[] }>('/api/ads/history?limit=50');
      setRows(history);
    } catch (e: any) {
      toast({ title: 'Failed to load history', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details[id]) {
      try {
        const { history } = await apiFetch<{ history: HistoryDetail }>(`/api/ads/history/${id}`);
        setDetails(d => ({ ...d, [id]: history }));
      } catch (e: any) {
        toast({ title: 'Failed to load detail', description: e?.message || String(e), variant: 'destructive' });
      }
    }
  };

  const rollback = async (row: HistoryRow) => {
    if (!confirm(`Delete FB campaign "${row.campaignName}" (${row.campaignId || 'no FB id'}) and mark this launch as rolled back?`)) return;
    setRollingBack(row.id);
    try {
      const r = await apiFetch<{ ok: boolean; message: string }>(`/api/ads/history/${row.id}/rollback`, { method: 'POST' });
      toast({ title: r.ok ? 'Rolled back' : 'Rollback failed', description: r.message, variant: r.ok ? 'default' : 'destructive' });
      refresh();
    } catch (e: any) {
      toast({ title: 'Rollback error', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Launch history</span>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !loading && (
          <div className="text-sm text-slate-500 py-8 text-center">No launches yet. Run one from the wizard tab.</div>
        )}
        <div className="space-y-2">
          {rows.map(row => {
            const isOpen = openId === row.id;
            const detail = details[row.id];
            return (
              <div key={row.id} className="border rounded-md bg-white">
                <button
                  type="button"
                  className="w-full p-3 flex items-center gap-3 text-left hover:bg-slate-50"
                  onClick={() => toggle(row.id)}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.campaignName}</span>
                      <Badge variant="outline" className={STATUS_COLORS[row.status] || ''}>{row.status}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      act_{row.accountId}
                      {row.campaignId && <> · <code>{row.campaignId}</code></>}
                      {' · '}{new Date(row.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 flex items-center gap-2 shrink-0">
                    <span className="text-emerald-600">{row.successAds} ok</span>
                    {row.failedAds > 0 && <span className="text-rose-600">· {row.failedAds} failed</span>}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t p-3 space-y-2 bg-slate-50/50">
                    {!detail && <div className="text-xs text-slate-400">Loading detail…</div>}
                    {detail && (
                      <>
                        {detail.errorSummary && (
                          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span className="break-words">{detail.errorSummary}</span>
                          </div>
                        )}
                        <div className="text-xs text-slate-500">
                          {detail.items.length} item(s)
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
                          {detail.items.map(it => (
                            <div key={it.id} className="flex items-center gap-2 text-xs p-1.5 rounded border bg-white">
                              <Badge variant="outline" className={it.status === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}>
                                {it.status}
                              </Badge>
                              <span className="flex-1 truncate">{it.filename}</span>
                              {it.adId && <code className="text-slate-400 truncate">ad {it.adId}</code>}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 pt-2">
                          {row.campaignId && (
                            <a
                              href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${row.accountId}&selected_campaign_ids=${row.campaignId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              Open in Ads Manager <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {row.status !== 'rolled_back' && row.campaignId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => rollback(row)}
                              disabled={rollingBack === row.id}
                              className="ml-auto text-rose-600 border-rose-200 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              {rollingBack === row.id ? 'Rolling back…' : 'Delete campaign'}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
