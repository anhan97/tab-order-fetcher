import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/context/AppContext';
import { Search, RefreshCw, Plus, Trash2, CheckCircle2, Loader2, Building2, FileText, Wallet, Instagram, Globe, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignMappingDialog } from './CampaignMappingDialog';

interface AdAccountAsset {
  accountId: string;
  name: string;
  accountStatus: number | null;
  accountStatusLabel: string;
  accountType: 'business' | 'personal';
  currency: string | null;
  timezone: string | null;
  business: { id: string; name: string } | null;
  enrolled: boolean;
  enrolledAt: string | null;
}

interface PageAsset {
  pageId: string;
  name: string;
  category: string | null;
  hasInstagram: boolean;
}

interface BusinessAsset {
  businessId: string;
  name: string;
}

interface AssetSnapshot {
  adAccounts: AdAccountAsset[];
  pages: PageAsset[];
  businesses: BusinessAsset[];
}

type SubTab = 'ad-accounts' | 'pages' | 'businesses';

export const FacebookAssetManager = () => {
  const { shopifyConfig } = useAppContext();
  const { toast } = useToast();
  const [data, setData] = useState<AssetSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>('ad-accounts');
  const [search, setSearch] = useState('');
  const [enrolmentFilter, setEnrolmentFilter] = useState<'all' | 'enrolled' | 'available'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  /** When set, open the per-account mapping dialog. Auto-set after enroll
   *  so the user can map campaigns immediately without switching tabs. */
  const [mapTarget, setMapTarget] = useState<{ accountId: string; name: string } | null>(null);

  const headers = (): Record<string, string> => {
    if (!shopifyConfig) return {};
    return {
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/facebook/assets', { headers: headers() });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `${res.status}`);
      setData(body);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const enroll = async (account: AdAccountAsset) => {
    setBusyId(account.accountId);
    try {
      const res = await fetch(`/api/facebook/assets/ad-accounts/${account.accountId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ name: account.name })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${res.status}`);
      }
      toast({ title: 'Đã thêm vào hệ thống', description: account.name });
      await load();
      // Pop the mapping dialog so the user can immediately wire campaigns
      // to their stores — same flow they'd reach via the Mapping tab, but
      // pre-filtered to this account so they don't get lost in the full list.
      setMapTarget({ accountId: account.accountId, name: account.name });
    } catch (e: any) {
      toast({ title: 'Enroll failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const unenroll = async (account: AdAccountAsset) => {
    if (!confirm(`Xóa "${account.name}" khỏi hệ thống? Dữ liệu spend lịch sử vẫn giữ lại.`)) return;
    setBusyId(account.accountId);
    try {
      const res = await fetch(`/api/facebook/assets/ad-accounts/${account.accountId}`, {
        method: 'DELETE',
        headers: headers()
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${res.status}`);
      }
      toast({ title: 'Đã xóa khỏi hệ thống', description: account.name });
      await load();
    } catch (e: any) {
      toast({ title: 'Unenroll failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const filteredAdAccounts = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.adAccounts.filter(a => {
      if (enrolmentFilter === 'enrolled' && !a.enrolled) return false;
      if (enrolmentFilter === 'available' && a.enrolled) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.accountId.includes(q) && !(a.business?.name.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, search, enrolmentFilter]);

  const filteredPages = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.pages.filter(p => !q || p.name.toLowerCase().includes(q) || p.pageId.includes(q));
  }, [data, search]);

  const filteredBusinesses = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.businesses.filter(b => !q || b.name.toLowerCase().includes(q) || b.businessId.includes(q));
  }, [data, search]);

  const enrolledCount = data?.adAccounts.filter(a => a.enrolled).length || 0;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Tìm theo tên, ID, BM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={load} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
            {loading ? 'Đang tải...' : 'Refresh từ Facebook'}
          </Button>
        </div>

        {error && (
          <Card className="border-rose-200 bg-rose-50/40">
            <CardContent className="p-4 text-sm text-rose-700">{error}</CardContent>
          </Card>
        )}

        {!data && loading && (
          <Card>
            <CardContent className="p-8 flex items-center justify-center text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Đang lấy danh sách asset từ Facebook...
            </CardContent>
          </Card>
        )}

        {data && (
          <Tabs value={tab} onValueChange={(v) => { setTab(v as SubTab); setSearch(''); }}>
            <TabsList>
              <TabsTrigger value="ad-accounts" className="gap-2">
                <Wallet className="h-4 w-4" />
                Tài khoản quảng cáo
                <span className="ml-1 text-xs text-slate-500">({data.adAccounts.length})</span>
              </TabsTrigger>
              <TabsTrigger value="pages" className="gap-2">
                <FileText className="h-4 w-4" />
                Pages
                <span className="ml-1 text-xs text-slate-500">({data.pages.length})</span>
              </TabsTrigger>
              <TabsTrigger value="businesses" className="gap-2">
                <Building2 className="h-4 w-4" />
                Business Manager
                <span className="ml-1 text-xs text-slate-500">({data.businesses.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ad-accounts" className="m-0 space-y-3">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <span>
                  <strong className="text-emerald-600">{enrolledCount}</strong> đã add ·{' '}
                  <strong>{data.adAccounts.length - enrolledCount}</strong> available
                </span>
                <div className="flex gap-1 ml-auto">
                  <FilterChip active={enrolmentFilter === 'all'} onClick={() => setEnrolmentFilter('all')}>All</FilterChip>
                  <FilterChip active={enrolmentFilter === 'enrolled'} onClick={() => setEnrolmentFilter('enrolled')}>
                    <CheckCircle2 className="h-3 w-3 mr-1" />Đã add
                  </FilterChip>
                  <FilterChip active={enrolmentFilter === 'available'} onClick={() => setEnrolmentFilter('available')}>Available</FilterChip>
                </div>
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/60">
                          <TableHead>Tài khoản quảng cáo</TableHead>
                          <TableHead>Trạng thái tài khoản</TableHead>
                          <TableHead>Loại tài khoản</TableHead>
                          <TableHead>Tiền tệ</TableHead>
                          <TableHead>BM</TableHead>
                          <TableHead>Trạng thái đồng bộ</TableHead>
                          <TableHead className="text-right">Hành động</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAdAccounts.length === 0 && (
                          <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-6">Không có account nào.</TableCell></TableRow>
                        )}
                        {filteredAdAccounts.map(a => {
                          const isActive = a.accountStatus === 1;
                          return (
                            <TableRow key={a.accountId} className={cn(a.enrolled && 'bg-emerald-50/30')}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    'h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                                    a.enrolled ? 'bg-gradient-to-br from-blue-500 to-violet-600 text-white' : 'bg-slate-200 text-slate-500'
                                  )}>
                                    {a.name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-slate-900 truncate max-w-[200px]" title={a.name}>{a.name}</div>
                                    <div className="text-xs text-slate-500 font-mono">{a.accountId}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className={cn(
                                  'inline-flex items-center gap-1 text-xs',
                                  isActive ? 'text-emerald-700' : 'text-rose-700'
                                )}>
                                  <span className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    isActive ? 'bg-emerald-500' : 'bg-rose-500'
                                  )} />
                                  {a.accountStatusLabel}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm text-slate-600">
                                  {a.accountType === 'business' ? 'Doanh nghiệp' : 'Cá nhân'}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm">{a.currency || '—'}</TableCell>
                              <TableCell>
                                {a.business ? (
                                  <span className="text-sm text-slate-700 truncate max-w-[160px] inline-block" title={a.business.name}>
                                    {a.business.name}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {a.enrolled ? (
                                  <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Đã add
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200">Available</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {a.enrolled ? (
                                  <div className="inline-flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setMapTarget({ accountId: a.accountId, name: a.name })}
                                      className="text-blue-700 hover:text-blue-800 border-blue-200 hover:border-blue-300 hover:bg-blue-50"
                                    >
                                      <Link2 className="h-3.5 w-3.5 mr-1" />
                                      Map
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => unenroll(a)}
                                      disabled={busyId === a.accountId}
                                      className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 hover:bg-rose-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                                      Xóa
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => enroll(a)}
                                    disabled={busyId === a.accountId}
                                  >
                                    <Plus className="h-3.5 w-3.5 mr-1" />
                                    Add
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="pages" className="m-0">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/60">
                          <TableHead>Page</TableHead>
                          <TableHead>Page ID</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Instagram</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPages.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-slate-400 py-6">Không có page nào.</TableCell></TableRow>
                        )}
                        {filteredPages.map(p => (
                          <TableRow key={p.pageId}>
                            <TableCell>
                              <div className="font-medium text-slate-900 truncate max-w-[260px]" title={p.name}>{p.name}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-500">{p.pageId}</TableCell>
                            <TableCell className="text-sm text-slate-600">{p.category || '—'}</TableCell>
                            <TableCell>
                              {p.hasInstagram ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center text-pink-600">
                                      <Instagram className="h-4 w-4" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Page này có Instagram Business account</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-slate-500 mt-2">
                Pages liệt kê đọc từ <code>/me/accounts</code>. Khi launch ads (tab Auto-launch), bạn pick page từ list này.
              </p>
            </TabsContent>

            <TabsContent value="businesses" className="m-0">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/60">
                          <TableHead>Business Manager</TableHead>
                          <TableHead>Business ID</TableHead>
                          <TableHead className="text-right">Mở settings</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredBusinesses.length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center text-slate-400 py-6">Không có BM nào.</TableCell></TableRow>
                        )}
                        {filteredBusinesses.map(b => (
                          <TableRow key={b.businessId}>
                            <TableCell>
                              <div className="font-medium text-slate-900 truncate max-w-[260px]" title={b.name}>{b.name}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-500">{b.businessId}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="outline" size="sm" asChild>
                                <a
                                  href={`https://business.facebook.com/settings/info?business_id=${b.businessId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Globe className="h-3.5 w-3.5 mr-1" />
                                  Settings
                                </a>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-slate-500 mt-2">
                BMs đọc từ <code>/me/businesses</code>. Đây là context — không enroll vào hệ thống. Click "Settings" để mở BM trên Meta để add app, assign ad accounts, etc.
              </p>
            </TabsContent>
          </Tabs>
        )}

        {mapTarget && (
          <CampaignMappingDialog
            open={!!mapTarget}
            onOpenChange={(open) => { if (!open) setMapTarget(null); }}
            accountId={mapTarget.accountId}
            accountName={mapTarget.name}
          />
        )}
      </div>
    </TooltipProvider>
  );
};

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterChip({ active, onClick, children }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
        active
          ? 'bg-blue-50 border-blue-200 text-blue-700'
          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
      )}
    >
      {children}
    </button>
  );
}
