/**
 * Posts tab (§10.2): one row per Facebook post that ads ran, with its
 * metrics; select posts to relaunch them or copy their IDs.
 *
 * Reusable: pass `productId` / `creativeId` to scope it (product page).
 */
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertCircle, ChevronLeft, ChevronRight, ClipboardCopy, Loader2, Megaphone, RefreshCw, Rocket, Search
} from 'lucide-react';
import type { PostRow } from '@contract/ads-launcher';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useLauncherAccounts, usePosts, useRefreshPosts, useStoreKey } from '@/features/ads-launcher/hooks/queries';
import { QuickLaunchDialog } from '@/features/ads-launcher/components/QuickLaunchDialog';
import { useDebounced } from '../hooks/use-debounced';
import { copyText } from '../lib/clipboard';
import {
  addAllInOrder, distinctProducts, errorMessage, formatCount, formatMoney, formatRoas, selectionOrder, toggleInOrder
} from '../lib/library';
import { MediaThumb } from './MediaThumb';
import { PostIdActions } from './PostIdActions';
import { SelectionBar } from './SelectionBar';

type Range = '7d' | '30d' | '90d' | 'lifetime';
type Sort = 'spend' | 'purchases' | 'roas' | 'recent';

const PAGE_SIZE = 25;
const ALL = 'all';
const byPost = (p: PostRow) => p.postId;

const RANGE_LABEL: Record<Range, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', lifetime: 'Lifetime' };
const SORT_LABEL: Record<Sort, string> = { recent: 'Recently used', spend: 'Spend', purchases: 'Purchases', roas: 'ROAS' };

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy');
};

interface PostLibraryProps {
  /** Scope to one product (product page). */
  productId?: string | null;
  /** Scope to one creative. */
  creativeId?: string;
}

export function PostLibrary({ productId, creativeId }: PostLibraryProps) {
  const { toast } = useToast();
  const { canInStore } = useAuth();
  const canManage = canInStore('manage');
  const storeKey = useStoreKey();
  const accounts = useLauncherAccounts();
  const refresh = useRefreshPosts();

  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft.trim(), 300);
  const [adAccountId, setAdAccountId] = useState<string>(ALL);
  const [status, setStatus] = useState<'active' | 'all'>('all');
  const [source, setSource] = useState<'library' | 'all'>('all');
  const [range, setRange] = useState<Range>('30d');
  const [sort, setSort] = useState<Sort>('recent');

  const params = {
    q: q || undefined,
    productId: productId ?? undefined,
    creativeId,
    adAccountId: adAccountId === ALL ? undefined : adAccountId,
    status,
    source,
    range,
    sort,
    pageSize: PAGE_SIZE
  };
  const filterKey = JSON.stringify(params);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const posts = usePosts({ ...params, page }, storeKey !== 'none');
  const items = useMemo(() => posts.data?.items ?? [], [posts.data]);
  const total = posts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const missing = posts.data?.missingPostIds ?? 0;

  // ─── Selection (ordered, survives paging) ────────────────────────────────
  const [selected, setSelected] = useState<PostRow[]>([]);
  useEffect(() => setSelected([]), [storeKey]);
  const allShownSelected = items.length > 0 && items.every(p => selected.some(s => s.postId === p.postId));
  const someShownSelected = items.some(p => selected.some(s => s.postId === p.postId));
  const toggleShown = (checked: boolean) => {
    if (checked) setSelected(prev => addAllInOrder(prev, items, byPost));
    else {
      const shown = new Set(items.map(byPost));
      setSelected(prev => prev.filter(p => !shown.has(p.postId)));
    }
  };
  const toggle = (p: PostRow) => setSelected(prev => toggleInOrder(prev, p, byPost));
  const productIds = distinctProducts(selected.map(p => p.product?.id));
  const mixed = productIds.length > 1;
  const [launchOpen, setLaunchOpen] = useState(false);

  const copyIds = async () => {
    const text = selected.map(byPost).join('\n');
    const ok = await copyText(text);
    toast(ok
      ? { title: `${selected.length} post ID${selected.length === 1 ? '' : 's'} copied` }
      : { title: 'Could not copy', description: text, variant: 'destructive' });
  };

  const runRefresh = async () => {
    try {
      const r = await refresh.mutateAsync({
        adAccountId: adAccountId === ALL ? undefined : adAccountId,
        productId: productId ?? undefined,
        creativeId
      });
      const failures = r.failures.map(f => `${f.name || f.adAccountId}: ${f.error}`);
      toast({
        title: r.found > 0 ? `Found ${r.found} post ID${r.found === 1 ? '' : 's'}` : 'No new post IDs found',
        description: [
          `Checked ${r.checked} ad${r.checked === 1 ? '' : 's'}.`,
          r.remaining > 0 ? `${r.remaining} still to check — press Refresh again.` : '',
          failures.length ? `Failed: ${failures.join('; ')}` : ''
        ].filter(Boolean).join(' '),
        variant: failures.length && r.checked === 0 ? 'destructive' : undefined
      });
    } catch (e) {
      toast({ title: 'Refresh failed', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const money = (p: PostRow, v: string | null) => formatMoney(v, p.currency);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative min-w-0 lg:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={qDraft} onChange={e => setQDraft(e.target.value)} placeholder="Search post ID, ad, creative, copy…" className="h-9 pl-9" aria-label="Search posts" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Select value={adAccountId} onValueChange={setAdAccountId}>
            <SelectTrigger className="col-span-2 h-9 min-w-0 sm:w-52" aria-label="Ad account">
              <SelectValue placeholder="Ad account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All ad accounts</SelectItem>
              {(accounts.data ?? []).map(a => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="truncate">{a.name}{a.isDemo ? ' (demo)' : ''}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 min-w-0 sm:w-36" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All posts</SelectItem>
              <SelectItem value="active">Running now</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={v => setSource(v as typeof source)}>
            <SelectTrigger className="h-9 min-w-0 sm:w-40" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any source</SelectItem>
              <SelectItem value="library">From the library</SelectItem>
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={v => setRange(v as Range)}>
            <SelectTrigger className="h-9 min-w-0 sm:w-36" aria-label="Date range"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABEL) as Range[]).map(r => <SelectItem key={r} value={r}>{RANGE_LABEL[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={v => setSort(v as Sort)}>
            <SelectTrigger className="h-9 min-w-0 sm:w-44" aria-label="Sort by">
              <span className="truncate">Sort: {SORT_LABEL[sort]}</span>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as Sort[]).map(s => <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 lg:ml-auto"
          onClick={() => void runRefresh()}
          disabled={!canManage || refresh.isPending || missing === 0}
          title={missing === 0 ? 'Every ad in this view already has a post ID (or was checked in the last 6 hours)' : 'Ask Meta for the post IDs of ads that do not have one yet'}
        >
          {refresh.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh post IDs{posts.data ? ` (${missing} missing)` : ''}
        </Button>
      </div>

      {posts.data?.range && (
        <p className="text-xs text-slate-500">
          Metrics {posts.data.range.from ? `from ${fmtDate(posts.data.range.from)} to ${fmtDate(posts.data.range.to)}` : `lifetime to ${fmtDate(posts.data.range.to)}`}. Zero when Meta has no insights for the period.
        </p>
      )}

      {/* Body */}
      {posts.isLoading ? (
        <Card className="space-y-2 p-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />)}
        </Card>
      ) : posts.isError ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <AlertCircle className="h-6 w-6 text-rose-500" />
          <div className="font-medium text-slate-900">Could not load posts</div>
          <p className="max-w-md text-sm text-slate-500">{errorMessage(posts.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void posts.refetch()}>Try again</Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center sm:p-10">
          <div className="rounded-xl bg-teal-50 p-3 text-teal-600"><Megaphone className="h-6 w-6" /></div>
          <div className="font-medium text-slate-900">{q ? `No posts match “${q}”` : 'No posts here yet'}</div>
          <p className="max-w-md text-sm text-slate-500">
            Posts appear once ads have a post ID. Try a longer date range or “Any source”
            {missing > 0 ? `, or press “Refresh post IDs” — ${missing} ad${missing === 1 ? '' : 's'} still need one.` : '.'}
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className={cn('hidden overflow-hidden xl:block', posts.isPlaceholderData && 'opacity-60')}>
            <Table className="table-fixed [&_td]:px-2 [&_td]:py-2 [&_th]:h-10 [&_th]:px-2">
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allShownSelected ? true : someShownSelected ? 'indeterminate' : false}
                      onCheckedChange={c => toggleShown(c === true)}
                      aria-label="Select shown posts"
                    />
                  </TableHead>
                  <TableHead className="w-[28%]">Post</TableHead>
                  <TableHead className="w-[21%]">Creative · product</TableHead>
                  <TableHead className="w-[7%] text-right">Ads</TableHead>
                  <TableHead className="w-[10%]">Last used</TableHead>
                  <TableHead className="w-[9%] text-right">Spend</TableHead>
                  <TableHead className="w-[7%] text-right">Purch.</TableHead>
                  <TableHead className="w-[6%] text-right">ROAS</TableHead>
                  <TableHead className="w-[8%] text-right">CPA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(p => {
                  const order = selectionOrder(selected, p.postId, byPost);
                  return (
                    <TableRow key={p.postId} className={cn('text-xs', order ? 'bg-teal-50/60' : 'hover:bg-slate-50/60')}>
                      <TableCell className="relative">
                        <Checkbox checked={order > 0} onCheckedChange={() => toggle(p)} aria-label={`Select post ${p.postId}`} />
                        {order > 0 && <span className="absolute left-1 top-1 text-[9px] font-bold text-teal-700">{order}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <MediaThumb thumbUrl={p.thumbnailUrl} isVideo={p.isVideo} alt="" badge={false} className="h-10 w-10 shrink-0 rounded" />
                          <div className="min-w-0 flex-1">
                            <PostIdActions postId={p.postId} permalink={p.permalink} />
                            <div className="truncate text-[11px] text-slate-500" title={p.headline ?? p.primaryText ?? undefined}>
                              {p.pageName ?? `Page ${p.pageId}`}{p.isVideo ? ' · video' : ''}{p.headline ? ` · ${p.headline}` : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="truncate font-medium text-slate-800" title={p.creative?.name}>{p.creative?.name ?? <span className="font-normal text-slate-400">Not from the library</span>}</div>
                        <div className="truncate text-[11px] text-slate-500" title={p.product?.title}>
                          {p.product ? <>{p.product.title}{p.product.code && <span className="font-mono"> · {p.product.code}</span>}</> : p.lastAd?.campaignName ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={p.activeAds > 0 ? 'font-medium text-teal-700' : ''}>{p.activeAds}</span>
                        <span className="text-slate-400">/{p.ads}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-600">{fmtDate(p.lastUsedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p, p.metrics.spend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(p.metrics.purchases)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRoas(p.metrics.roas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p, p.metrics.cpa)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile / narrow cards */}
          <div className={cn('space-y-2 xl:hidden', posts.isPlaceholderData && 'opacity-60')}>
            <label className="flex items-center gap-2 px-1 text-xs text-slate-600">
              <Checkbox checked={allShownSelected ? true : someShownSelected ? 'indeterminate' : false} onCheckedChange={c => toggleShown(c === true)} />
              Select all shown
            </label>
            {items.map(p => {
              const order = selectionOrder(selected, p.postId, byPost);
              return (
                <Card key={p.postId} className={cn('p-2.5', order > 0 && 'border-teal-500 ring-1 ring-teal-500/50')}>
                  <div className="flex gap-2.5">
                    <div className="relative shrink-0">
                      <MediaThumb thumbUrl={p.thumbnailUrl} isVideo={p.isVideo} alt="" badge={false} className="h-16 w-16 rounded" />
                      <button
                        type="button"
                        onClick={() => toggle(p)}
                        aria-pressed={order > 0}
                        aria-label={`Select post ${p.postId}`}
                        className={cn(
                          'absolute -left-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 text-xs font-bold shadow',
                          order > 0 ? 'border-teal-600 bg-teal-600 text-white' : 'border-white bg-slate-300 text-transparent'
                        )}
                      >
                        {order || '·'}
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <PostIdActions postId={p.postId} permalink={p.permalink} />
                      <div className="truncate text-xs font-medium text-slate-800">{p.creative?.name ?? p.lastAd?.name ?? (p.pageName ?? `Page ${p.pageId}`)}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {p.product ? `${p.product.title}${p.product.code ? ` · ${p.product.code}` : ''}` : 'Not from the library'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 border-t pt-2 text-[11px] sm:grid-cols-6">
                    <Metric label="Spend" value={money(p, p.metrics.spend)} />
                    <Metric label="Purchases" value={formatCount(p.metrics.purchases)} />
                    <Metric label="ROAS" value={formatRoas(p.metrics.roas)} />
                    <Metric label="CPA" value={money(p, p.metrics.cpa)} />
                    <Metric label="Ads" value={`${p.activeAds}/${p.ads} active`} />
                    <Metric label="Last used" value={fmtDate(p.lastUsedAt)} />
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min((page - 1) * PAGE_SIZE + items.length, total)} of {total} posts
            {posts.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </span>
          {(pages > 1 || posts.data?.hasMore) && (
            <div className="flex items-center gap-2">
              <span className="text-xs">Page {page}/{pages}</span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={!posts.data?.hasMore && page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <SelectionBar
        count={selected.length}
        noun="post"
        onClear={() => setSelected([])}
        notice={mixed ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">The selected posts sell {productIds.length} different products. A launch is for one product.</span>
            <button
              type="button"
              className="font-medium underline"
              onClick={() => setSelected(prev => prev.filter(p => !p.product || p.product.id === productIds[0]))}
            >
              Keep only “{selected.find(p => p.product?.id === productIds[0])?.product?.title}”
            </button>
          </div>
        ) : null}
      >
        <Button variant="outline" size="sm" onClick={() => void copyIds()}>
          <ClipboardCopy className="mr-1.5 h-4 w-4" /> Copy post IDs
        </Button>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setLaunchOpen(true)} disabled={mixed || !canManage}>
          <Rocket className="mr-1.5 h-4 w-4" /> Launch ads
        </Button>
      </SelectionBar>

      <QuickLaunchDialog open={launchOpen} onOpenChange={setLaunchOpen} posts={selected} productId={productIds[0] ?? productId ?? null} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-400">{label}</div>
      <div className="truncate font-medium tabular-nums text-slate-800">{value}</div>
    </div>
  );
}
