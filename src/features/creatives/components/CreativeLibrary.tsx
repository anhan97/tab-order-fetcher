/**
 * Creatives tab: filters, grid with ordered multi-select, bulk launch.
 *
 * Selection keeps the ORDER of clicks (it becomes the launch pool order) and
 * survives paging/filtering; a launch covers one product (§3.3).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, CheckSquare, ChevronLeft, ChevronRight, ImagePlus, Loader2, Rocket, Search, SlidersHorizontal, Square
} from 'lucide-react';
import type { CreativeDto } from '@contract/ads-launcher';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { useCreativeMutations, useCreatives, useProducts, useStoreKey } from '@/features/ads-launcher/hooks/queries';
import { QuickLaunchDialog } from '@/features/ads-launcher/components/QuickLaunchDialog';
import { useDebounced } from '../hooks/use-debounced';
import {
  addAllInOrder, distinctProducts, errorMessage, refreshSelection, selectionOrder, toggleInOrder
} from '../lib/library';
import { CreativeCard } from './CreativeCard';
import { CreativeDetailsDialog } from './CreativeDetailsDialog';
import { EditCreativeDialog } from './EditCreativeDialog';
import { ProductPicker } from './ProductPicker';
import { SelectionBar } from './SelectionBar';

const PAGE_SIZE = 24;
const byId = (c: CreativeDto) => c.id;

interface CreativeLibraryProps {
  productId: string | null;
  onProductChange: (productId: string | null) => void;
  canManage: boolean;
  onUpload: () => void;
}

export function CreativeLibrary({ productId, onProductChange, canManage, onUpload }: CreativeLibraryProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const storeKey = useStoreKey();
  const products = useProducts();
  const mutations = useCreativeMutations();

  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [launched, setLaunched] = useState<'not' | 'all'>('not');
  const [qDraft, setQDraft] = useState('');
  const q = useDebounced(qDraft.trim(), 300);

  const params = {
    productId: productId ?? undefined,
    status,
    launched: status === 'active' ? launched : 'all',
    q: q || undefined,
    pageSize: PAGE_SIZE
  } as const;
  // Page resets whenever the filters change (no effect → no stale-page fetch).
  const filterKey = JSON.stringify(params);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });

  const list = useCreatives({ ...params, page }, storeKey !== 'none');
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Archiving/deleting the last item of the last page: step back to a page that exists.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && items.length === 0 && page > 1) {
      setPageState({ key: filterKey, page: pages });
    }
  }, [list.data, list.isPlaceholderData, items.length, page, pages, filterKey]);

  // ─── Selection ────────────────────────────────────────────────────────────
  const [selectedRaw, setSelected] = useState<CreativeDto[]>([]);
  const selected = useMemo(() => refreshSelection(selectedRaw, items, byId), [selectedRaw, items]);
  useEffect(() => setSelected([]), [storeKey]);

  const selectable = canManage && status === 'active';
  const shownSelectable = selectable ? items.filter(c => c.status === 'active') : [];
  const allShownSelected = shownSelectable.length > 0 && shownSelectable.every(c => selected.some(s => s.id === c.id));
  const productIds = distinctProducts(selected.map(c => c.productId));
  const mixed = productIds.length > 1;
  const firstProductTitle = selected[0]?.productTitle ?? '';

  const toggleShown = () => {
    if (allShownSelected) {
      const shown = new Set(shownSelectable.map(byId));
      setSelected(prev => prev.filter(c => !shown.has(c.id)));
    } else {
      setSelected(prev => addAllInOrder(prev, shownSelectable, byId));
    }
  };
  const dropFromSelection = (id: string) => setSelected(prev => prev.filter(c => c.id !== id));

  // ─── Dialogs ──────────────────────────────────────────────────────────────
  const [details, setDetails] = useState<CreativeDto | null>(null);
  const [editing, setEditing] = useState<CreativeDto | null>(null);
  const [deleting, setDeleting] = useState<CreativeDto | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);

  const archive = async (c: CreativeDto) => {
    try {
      await mutations.archive.mutateAsync(c.id);
      dropFromSelection(c.id);
      toast({ title: 'Creative archived', description: 'Find it under Status: Archived to restore it.' });
    } catch (e) {
      toast({ title: 'Could not archive', description: errorMessage(e), variant: 'destructive' });
    }
  };
  const restore = async (c: CreativeDto) => {
    try {
      await mutations.restore.mutateAsync(c.id);
      toast({ title: 'Creative restored' });
    } catch (e) {
      toast({ title: 'Could not restore', description: errorMessage(e), variant: 'destructive' });
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const c = deleting;
    try {
      await mutations.remove.mutateAsync(c.id);
      dropFromSelection(c.id);
      if (details?.id === c.id) setDetails(null);
      toast({ title: 'Creative deleted' });
      setDeleting(null);
    } catch (e) {
      toast({ title: 'Could not delete', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const customise = () => navigate(`/ads-launcher?creatives=${selected.map(byId).join(',')}`);
  const hasFilters = !!q || !!productId;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <ProductPicker
          products={products.data}
          loading={products.isLoading}
          value={productId}
          onChange={onProductChange}
          allowAll
          className="lg:w-72"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-32" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {status === 'active' && (
            <ToggleGroup
              type="single"
              value={launched}
              onValueChange={v => v && setLaunched(v as typeof launched)}
              className="rounded-md border bg-white p-0.5"
              aria-label="Launch state"
            >
              <ToggleGroupItem value="not" className="h-8 px-2.5 text-xs data-[state=on]:bg-teal-50 data-[state=on]:text-teal-800">
                Not launched{list.data ? ` (${list.data.notLaunched})` : ''}
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="h-8 px-2.5 text-xs data-[state=on]:bg-teal-50 data-[state=on]:text-teal-800">
                All
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        <div className="relative min-w-0 flex-1 lg:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={qDraft}
            onChange={e => setQDraft(e.target.value)}
            placeholder="Search name, angle, copy…"
            className="h-9 pl-9"
            aria-label="Search creatives"
          />
        </div>
        {selectable && (
          <Button variant="outline" size="sm" className="h-9 self-start lg:self-auto" onClick={toggleShown} disabled={shownSelectable.length === 0}>
            {allShownSelected ? <CheckSquare className="mr-1.5 h-4 w-4 text-teal-600" /> : <Square className="mr-1.5 h-4 w-4" />}
            {allShownSelected ? 'Deselect shown' : 'Select all shown'}
          </Button>
        )}
      </div>

      {/* Grid */}
      {list.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border bg-white">
              <div className="aspect-square animate-pulse bg-slate-100" />
              <div className="space-y-1.5 p-2">
                <div className="h-3 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <AlertCircle className="h-6 w-6 text-rose-500" />
          <div className="font-medium text-slate-900">Could not load creatives</div>
          <p className="max-w-md text-sm text-slate-500">{errorMessage(list.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>Try again</Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center sm:p-10">
          <div className="rounded-xl bg-teal-50 p-3 text-teal-600"><ImagePlus className="h-6 w-6" /></div>
          {status === 'archived' ? (
            <>
              <div className="font-medium text-slate-900">No archived creatives</div>
              <p className="text-sm text-slate-500">Archived creatives show up here so you can restore them.</p>
            </>
          ) : q ? (
            <>
              <div className="font-medium text-slate-900">Nothing matches “{q}”</div>
              <Button variant="outline" size="sm" onClick={() => setQDraft('')}>Clear search</Button>
            </>
          ) : launched === 'not' && (list.data?.total ?? 0) === 0 ? (
            <>
              <div className="font-medium text-slate-900">No creatives waiting to launch</div>
              <p className="max-w-md text-sm text-slate-500">
                Every creative {productId ? 'of this product ' : ''}has been launched, or none were uploaded yet.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setLaunched('all')}>Show all creatives</Button>
                {canManage && <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={onUpload}>Upload creatives</Button>}
              </div>
            </>
          ) : (
            <>
              <div className="font-medium text-slate-900">{hasFilters ? 'No creatives for this product' : 'No creatives yet'}</div>
              <p className="text-sm text-slate-500">Upload images or videos, then launch them as Meta ads.</p>
              {canManage && <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={onUpload}>Upload creatives</Button>}
            </>
          )}
        </Card>
      ) : (
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
          {items.map(c => (
            <CreativeCard
              key={c.id}
              creative={c}
              order={selectionOrder(selected, c.id, byId)}
              selectable={selectable && c.status === 'active'}
              canManage={canManage}
              onToggle={() => setSelected(prev => toggleInOrder(prev, c, byId))}
              onDetails={() => setDetails(c)}
              onEdit={() => setEditing(c)}
              onArchive={() => void archive(c)}
              onRestore={() => void restore(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            {list.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs">Page {page}/{pages}</span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-slate-500">You have view access to this store — uploading, editing and launching need manage access.</p>
      )}

      {/* Bulk actions */}
      <SelectionBar
        count={selected.length}
        noun="creative"
        onClear={() => setSelected([])}
        notice={mixed ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              The selection covers {productIds.length} products. A launch is for one product — keep only one product's creatives.
            </span>
            <button
              type="button"
              className="font-medium underline"
              onClick={() => setSelected(prev => prev.filter(c => c.productId === productIds[0]))}
            >
              Keep only “{firstProductTitle}”
            </button>
          </div>
        ) : null}
      >
        <Button variant="outline" size="sm" onClick={customise} disabled={mixed || !canManage}>
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Customise in Ads Launcher</span>
          <span className="sm:hidden">Customise</span>
        </Button>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setLaunchOpen(true)} disabled={mixed || !canManage}>
          <Rocket className="mr-1.5 h-4 w-4" /> Launch ads
        </Button>
      </SelectionBar>

      <CreativeDetailsDialog
        creative={details}
        onOpenChange={o => !o && setDetails(null)}
        canManage={canManage}
        onEdit={c => {
          setDetails(null);
          setEditing(c);
        }}
      />
      <EditCreativeDialog creative={editing} onOpenChange={o => !o && setEditing(null)} />

      <AlertDialog open={!!deleting} onOpenChange={o => !o && !mutations.remove.isPending && setDeleting(null)}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this creative?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              “{deleting?.name}” is removed from the library. Ads already launched from it keep running on Meta.
              {deleting && deleting.adsCount > 0 && ' To just hide it, archive it instead.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutations.remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={mutations.remove.isPending}
              onClick={e => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {mutations.remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuickLaunchDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        creatives={selected}
        productId={productIds[0] ?? null}
      />
    </div>
  );
}
