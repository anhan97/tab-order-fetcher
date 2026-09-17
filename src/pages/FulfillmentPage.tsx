/**
 * Fulfillment view (ShipBob-style) — DB-backed orders whose whole shipping
 * lifecycle syncs automatically from Shopify (webhooks + scheduler +
 * fulfillment shipment_status). Order status is READ-ONLY here: manage the
 * order on Shopify and it reflects back.
 *
 * What this page does:
 *   • filter by order date (default: today, store timezone), status, search
 *   • two attention views that ignore the date filter because they are about
 *     current state: STUCK (shipped N+ days, not delivered) and ISSUES
 *   • supplier reconciliation: select orders → owed amount (product +
 *     shipping, from each order's frozen cost) → download the statement →
 *     record the payment, which locks those orders against paying twice
 *   • sync / backfill from Shopify, and say plainly why payment fees are 0
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Loader2, Search, Download, RefreshCw, ChevronLeft, ChevronRight, Eye, PackageOpen,
  History, HandCoins, AlertTriangle, Info, CheckCircle2
} from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/hooks/use-toast';
import { OrderExportDialog } from '@/components/OrderExportDialog';
import { DateRangeControl, daysToRange } from '@/components/GlobalDateRange';
import { SupplierSelectionBar, type Selection } from '@/components/SupplierSelectionBar';
import { SupplierPaymentsDialog } from '@/components/SupplierPaymentsDialog';
import { addDaysToDateString, formatInTz, todayInTz } from '@/utils/dateUtils';

type IssueReason = 'shipping_error' | 'tracking_missing' | 'paid_not_shipped' | 'missing_cost';

interface FulfillOrder {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  totalAmount: number;
  currency: string;
  status: string;            // Shopify financial status
  // Payment processing fee, from the Shopify Payments balance ledger.
  // null = never synced; 0 = synced and genuinely no fee (or not on Shopify Payments).
  paymentFee: string | number | null;
  paymentGateway: string | null;
  fulfillStatus: string;     // internal lifecycle
  deliveryStatus: string | null;
  trackingNumber: string | null;
  shippingCompany: string | null;
  supplier: string | null;
  shippingAddress: Record<string, string | null> | null;
  processedAt: string | null;
  shippedAt: string | null;
  shippedAtEstimated: boolean;
  daysSinceShipped: number | null;
  issues: IssueReason[];
  supplierCost: { product: number; shipping: number; total: number; units: number; missing: boolean; unsplit: boolean };
  supplierSettlement: { id: string; paidAt: string; reference: string | null; status: string } | null;
  lineItems: Array<{
    id: string; title: string | null; sku: string | null; variantTitle: string | null;
    quantity: number; price: string | number; hasVariant: boolean;
    unitBasecost: string | null; unitProductCost: string | null; unitShippingCost: string | null;
  }>;
}

interface SyncStatus {
  ordersSyncedAt: string | null;
  feeSyncAt: string | null;
  feeSyncError: string | null;
  orderCount: number;
  firstOrderAt: string | null;
}

function fmtFee(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TABS = ['ALL', 'PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'UNPAID', 'STUCK', 'ISSUES'] as const;
type Tab = (typeof STATUS_TABS)[number];
const isView = (t: Tab) => t === 'STUCK' || t === 'ISSUES';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SHIPPED: 'bg-violet-100 text-violet-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700'
};

const ISSUE_LABEL: Record<IssueReason, string> = {
  shipping_error: 'Delivery problem',
  tracking_missing: 'Tracking not found',
  paid_not_shipped: 'Paid, not shipped',
  missing_cost: 'No cost'
};

const PAGE_SIZE = 50;

export const FulfillmentPage = () => {
  const { activeStore, user, canInStore } = useAuth();
  const { timezone } = useAppContext();
  const { toast } = useToast();
  const canSeePaymentFee = user?.role === 'admin';
  const canSync = canInStore('sync');
  const canPay = canInStore('costs');

  const [tab, setTab] = useState<Tab>('ALL');
  const [range, setRange] = useState(() => {
    const today = todayInTz(timezone);
    return daysToRange(today, today, timezone);
  });
  const [stuckDays, setStuckDays] = useState(15);
  const [stuckDraft, setStuckDraft] = useState('15');
  const [settlement, setSettlement] = useState<'all' | 'unsettled' | 'settled'>('all');
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [orders, setOrders] = useState<FulfillOrder[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<FulfillOrder | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  // Selection: explicit ids, or "every order matching the filters".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  /** Query params shared by the list, the export, and "select all matching". */
  const filterParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (q) p.q = q;
    if (tab === 'UNPAID') p.paymentStatus = 'unpaid';
    else if (isView(tab)) p.view = tab;
    else if (tab !== 'ALL') p.fulfillStatus = tab;
    if (!isView(tab)) {
      p.from = range.from.toISOString();
      p.to = range.to.toISOString();
    }
    if (tab === 'STUCK') p.stuckDays = String(stuckDays);
    if (settlement !== 'all') p.settlement = settlement;
    return p;
  }, [q, tab, range, stuckDays, settlement]);
  const filterKey = JSON.stringify(filterParams);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...filterParams, limit: String(PAGE_SIZE), offset: String(offset) });
      const r = await apiFetch<{ orders: FulfillOrder[]; total: number; tabs: Record<string, number> }>(`/api/orders?${params}`);
      setOrders(r.orders);
      setTotal(r.total);
      setTabs(r.tabs || {});
    } catch (e: any) {
      toast({ title: 'Could not load orders', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore, filterKey, offset, toast]);

  const loadSyncStatus = useCallback(async () => {
    if (!activeStore) return;
    try { setSyncStatus(await apiFetch<SyncStatus>('/api/orders/sync-status')); } catch { /* cosmetic */ }
  }, [activeStore]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSyncStatus(); }, [loadSyncStatus]);
  // New filters → first page, fresh selection (a selection means "these orders").
  useEffect(() => { setOffset(0); setSelected(new Set()); setAllMatching(false); }, [filterKey]);

  const runSync = async (since?: string) => {
    setSyncing(true);
    try {
      const r = await apiFetch<{ orders: { ordersCreated: number; ordersUpdated: number }; fees: { errors: string[] } }>(
        '/api/orders/sync', { method: 'POST', body: JSON.stringify(since ? { since } : {}) }
      );
      toast({
        title: since ? 'Backfill finished' : 'Orders synced from Shopify',
        description: `${r.orders.ordersCreated} new, ${r.orders.ordersUpdated} updated` +
          (r.fees.errors.length ? ' · payment fees could not be synced (see banner)' : '')
      });
      await Promise.all([load(), loadSyncStatus()]);
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e?.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const addressLine = (o: FulfillOrder): string => {
    const a = o.shippingAddress || {};
    return [a.address1, a.city, a.province, a.country].filter(Boolean).join(', ');
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = orders.map(o => o.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every(id => allMatching || selected.has(id));
  const selectionCount = allMatching ? total : selected.size;
  const selection: Selection | null = allMatching
    ? { kind: 'filters', filters: filterParams, count: total }
    : selected.size ? { kind: 'ids', ids: [...selected] } : null;

  const togglePage = (checked: boolean) => {
    setAllMatching(false);
    setSelected(prev => {
      const next = new Set(prev);
      pageIds.forEach(id => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };
  const toggleOne = (id: string, checked: boolean) => {
    if (allMatching) {
      // Leaving "all matching" mode keeps what is visible minus this one.
      setAllMatching(false);
      setSelected(new Set(pageIds.filter(x => x !== id)));
      return;
    }
    setSelected(prev => { const next = new Set(prev); checked ? next.add(id) : next.delete(id); return next; });
  };
  const clearSelection = () => { setSelected(new Set()); setAllMatching(false); };

  // checkbox + 10 data columns (+ payment fee for admins)
  const colCount = 11 + (canSeePaymentFee ? 1 : 0);

  if (!activeStore) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card className="p-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">No store selected</h2>
          <p className="text-slate-600">Connect or pick a store in the sidebar to manage fulfilment.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/30">
          <PackageOpen className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Fulfillment</h1>
          <p className="text-xs text-slate-500">
            Orders and delivery status sync from Shopify (webhooks, plus every 10 minutes). Status is read-only here.
            {syncStatus && (
              <> · <b>{syncStatus.orderCount}</b> orders stored
                {syncStatus.firstOrderAt && <> since {formatInTz(syncStatus.firstOrderAt, timezone, 'MMM d, yyyy')}</>}
                {syncStatus.ordersSyncedAt && <> · last sync {formatInTz(syncStatus.ordersSyncedAt, timezone, 'MMM d HH:mm')}</>}
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void runSync()} disabled={syncing || !canSync}>
          {syncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Sync now
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBackfillOpen(true)} disabled={syncing || !canSync}
                title="Re-pull older orders from Shopify">
          <History className="h-4 w-4 mr-1.5" /> Backfill
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPaymentsOpen(true)}>
          <HandCoins className="h-4 w-4 mr-1.5" /> Supplier payments
        </Button>
        <Button size="sm" onClick={() => setExportOpen(true)} className="bg-teal-600 hover:bg-teal-700">
          <Download className="h-4 w-4 mr-1.5" /> Export
        </Button>
      </div>

      {canSeePaymentFee && syncStatus?.feeSyncError && <FeeSyncBanner error={syncStatus.feeSyncError} />}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
        <TabsList className="flex-wrap h-auto">
          {STATUS_TABS.map(t => (
            <TabsTrigger key={t} value={t} className="gap-1.5">
              {t === 'ALL' ? 'All' : t === 'UNPAID' ? 'Unpaid'
                : t === 'STUCK' ? `Shipped ${stuckDays}+ days`
                : t === 'ISSUES' ? 'Issues' : t.charAt(0) + t.slice(1).toLowerCase()}
              <Badge variant="secondary"
                     className={`text-[10px] px-1.5 ${(t === 'STUCK' || t === 'ISSUES') && (tabs[t] ?? 0) > 0 ? 'bg-amber-100 text-amber-800' : ''}`}>
                {tabs[t] ?? 0}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {isView(tab) ? (
          <span className="text-xs text-slate-500 border rounded-md px-3 py-2 bg-slate-50">
            All dates — this view shows current state
          </span>
        ) : (
          <DateRangeControl from={range.from} to={range.to} timezone={timezone} align="start"
                            onChange={r => setRange(r)} />
        )}
        {tab === 'STUCK' && (
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-slate-500">Not delivered after</Label>
            <Input value={stuckDraft} inputMode="numeric" className="w-16 h-9"
                   onChange={e => /^\d{0,3}$/.test(e.target.value) && setStuckDraft(e.target.value)}
                   onBlur={() => { const n = parseInt(stuckDraft, 10); if (n >= 1) setStuckDays(n); else setStuckDraft(String(stuckDays)); }}
                   onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className="text-xs text-slate-500">days</span>
          </div>
        )}
        <Select value={settlement} onValueChange={v => setSettlement(v as typeof settlement)}>
          <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Supplier: all</SelectItem>
            <SelectItem value="unsettled">Supplier: not paid yet</SelectItem>
            <SelectItem value="settled">Supplier: paid</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search order no. / name / phone / tracking…"
            value={qDraft}
            onChange={e => setQDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qDraft.trim()); }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setQ(qDraft.trim())}>Search</Button>
      </div>

      {/* "Select all matching" prompt */}
      {pageAllSelected && total > orders.length && (
        <div className="rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-sm text-teal-900">
          {allMatching ? (
            <>All <b>{total}</b> matching orders are selected. <button className="underline" onClick={clearSelection}>Clear selection</button></>
          ) : (
            <>All {orders.length} orders on this page are selected.{' '}
              <button className="underline font-medium" onClick={() => setAllMatching(true)}>Select all {total} matching orders</button></>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={pageAllSelected} onCheckedChange={c => togglePage(!!c)} aria-label="Select page" />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Products</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {canSeePaymentFee && <TableHead className="text-right whitespace-nowrap">Payment fee</TableHead>}
                <TableHead className="text-right whitespace-nowrap">Supplier cost</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Fulfillment</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="h-32 text-center text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="h-32 text-center text-slate-400">
                    {tab === 'STUCK' ? `No orders shipped ${stuckDays}+ days ago are still undelivered.`
                      : tab === 'ISSUES' ? 'No orders need attention.'
                      : 'No orders in this range. Try another date, or "Backfill" if older orders are missing.'}
                  </TableCell>
                </TableRow>
              ) : orders.map(o => {
                const isSel = allMatching || selected.has(o.id);
                return (
                  <TableRow key={o.id} className={isSel ? 'bg-teal-50/50' : 'hover:bg-slate-50/60'}>
                    <TableCell>
                      <Checkbox checked={isSel} onCheckedChange={c => toggleOne(o.id, !!c)} aria-label={`Select order ${o.orderNumber}`} />
                    </TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">#{o.orderNumber}</TableCell>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {o.processedAt ? formatInTz(o.processedAt, timezone, 'MMM d, yyyy') : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{o.customerName || '—'}</div>
                      <div className="text-xs text-slate-500">{o.customerPhone || o.customerEmail || ''}</div>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="text-xs truncate">
                        {o.lineItems.map(li => `${li.quantity}× ${li.title ?? li.sku ?? '?'}`).join(', ') || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {o.totalAmount.toLocaleString()} {o.currency}
                    </TableCell>
                    {canSeePaymentFee && (
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {fmtFee(o.paymentFee)}
                        {o.paymentGateway && <div className="text-[10px] text-slate-400">{o.paymentGateway}</div>}
                      </TableCell>
                    )}
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {o.supplierCost.missing ? (
                        <span className="text-amber-600 text-xs">no cost</span>
                      ) : o.supplierCost.total > 0 ? money(o.supplierCost.total) : '—'}
                      {o.supplierSettlement && (
                        <div className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5 justify-end w-full">
                          <CheckCircle2 className="h-3 w-3" /> paid {o.supplierSettlement.paidAt.slice(0, 10)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={o.status === 'paid' ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700'}>
                        {o.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[o.fulfillStatus] || ''}>{o.fulfillStatus}</Badge>
                      {o.deliveryStatus && o.fulfillStatus !== 'DELIVERED' && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{o.deliveryStatus}</div>
                      )}
                      {o.fulfillStatus === 'SHIPPED' && o.daysSinceShipped !== null && (
                        <div className={`text-[10px] mt-0.5 ${o.daysSinceShipped >= stuckDays ? 'text-amber-700 font-medium' : 'text-slate-400'}`}
                             title={o.shippedAtEstimated ? 'Ship date unknown — counted from the order date' : undefined}>
                          {o.shippedAtEstimated ? '~' : ''}{o.daysSinceShipped}d since shipped
                        </div>
                      )}
                      {o.issues.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {o.issues.map(i => (
                            <Badge key={i} variant="outline" className="text-[10px] px-1.5 border-amber-300 bg-amber-50 text-amber-800">
                              {ISSUE_LABEL[i]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {o.trackingNumber || '—'}
                      {o.shippingCompany && <div className="font-sans text-[10px] text-slate-400">{o.shippingCompany}</div>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(o)} title="Details">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} orders · page {page}/{pages}{selectionCount > 0 && <> · <b>{selectionCount}</b> selected</>}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {selection && (
        <SupplierSelectionBar
          selection={selection}
          canPay={canPay}
          onClear={clearSelection}
          onPaid={() => { clearSelection(); void load(); }}
        />
      )}

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Order #{detail?.orderNumber}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge className={STATUS_BADGE[detail.fulfillStatus] || ''}>{detail.fulfillStatus}</Badge>
                <Badge variant="outline">{detail.status}</Badge>
                {detail.deliveryStatus && <Badge variant="outline">{detail.deliveryStatus}</Badge>}
                {detail.issues.map(i => (
                  <Badge key={i} variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{ISSUE_LABEL[i]}</Badge>
                ))}
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Customer</div>
                <div>{detail.customerName || '—'}</div>
                <div className="text-slate-500">{detail.customerEmail}</div>
                <div className="text-slate-500">{detail.customerPhone}</div>
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Shipping address</div>
                <div className="text-slate-600">{addressLine(detail) || '—'}</div>
                {detail.shippingAddress?.zip && <div className="text-slate-500">Zip: {detail.shippingAddress.zip}</div>}
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Products &amp; supplier cost</div>
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-slate-400">
                    <tr><th className="text-left font-normal">Item</th><th className="text-right font-normal">Price</th><th className="text-right font-normal">Product</th><th className="text-right font-normal">Ship</th><th className="text-right font-normal">Cost</th></tr>
                  </thead>
                  <tbody>
                    {detail.lineItems.map(li => {
                      const unit = li.unitBasecost === null ? null : Number(li.unitBasecost);
                      return (
                        <tr key={li.id} className="border-t border-slate-100">
                          <td className="py-1">{li.quantity}× {li.title ?? li.sku ?? '?'}{li.variantTitle ? <span className="text-slate-400"> · {li.variantTitle}</span> : null}</td>
                          <td className="text-right">{li.price}</td>
                          <td className="text-right">{li.unitProductCost === null ? (unit === null ? '' : '—') : money(Number(li.unitProductCost) * li.quantity)}</td>
                          <td className="text-right">{li.unitShippingCost === null ? (unit === null ? '' : '—') : money(Number(li.unitShippingCost) * li.quantity)}</td>
                          <td className="text-right font-medium">
                            {!li.hasVariant ? <span className="text-slate-400">n/a</span>
                              : unit === null ? <span className="text-amber-600">no cost</span>
                              : money(unit * li.quantity)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex justify-between font-semibold pt-1.5 border-t mt-1">
                  <span>Order total</span>
                  <span>{detail.totalAmount.toLocaleString()} {detail.currency}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Owed to supplier{detail.supplier ? ` (${detail.supplier})` : ''}</span>
                  <span>{detail.supplierCost.missing ? 'incomplete' : money(detail.supplierCost.total)}</span>
                </div>
                {detail.supplierSettlement && (
                  <div className="text-xs text-emerald-700 mt-1">
                    Paid to supplier on {detail.supplierSettlement.paidAt.slice(0, 10)}
                    {detail.supplierSettlement.reference ? ` · ${detail.supplierSettlement.reference}` : ''}
                  </div>
                )}
              </div>
              {detail.trackingNumber && (
                <div>
                  <div className="font-semibold text-slate-900 mb-1">Tracking</div>
                  <div className="font-mono">{detail.trackingNumber}</div>
                  <div className="text-slate-500">
                    {detail.shippingCompany}
                    {detail.shippedAt && <> · shipped {formatInTz(detail.shippedAt, timezone, 'MMM d, yyyy')}</>}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <OrderExportDialog open={exportOpen} onOpenChange={setExportOpen} q={q} tab={tab} filters={filterParams} />
      <SupplierPaymentsDialog open={paymentsOpen} onOpenChange={setPaymentsOpen} canVoid={canPay} onChanged={() => void load()} />
      <BackfillDialog open={backfillOpen} onOpenChange={setBackfillOpen} timezone={timezone}
                      busy={syncing} onRun={since => { setBackfillOpen(false); void runSync(since); }} />
    </div>
  );
};

/** Plain-language reason payment fees are missing, for admins. */
const FeeSyncBanner = ({ error }: { error: string }) => {
  const missingScope = error.startsWith('missing_scope');
  const notPayments = error.startsWith('not_shopify_payments');
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notPayments ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      {notPayments ? <Info className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
      <div>
        {missingScope ? (
          <>
            <b>Payment fees can&apos;t be read for this store.</b> Shopify only exposes processing fees through the Shopify
            Payments payouts API, and the store&apos;s connection lacks the <code>read_shopify_payments_payouts</code> permission.
            Add that scope to the Shopify app in the Partner Dashboard, then reconnect the store under <b>Stores</b>.
          </>
        ) : notPayments ? (
          <>This store doesn&apos;t use Shopify Payments, so Shopify provides no per-order processing fees (PayPal and other gateways don&apos;t share theirs).</>
        ) : (
          <><b>Payment fee sync failed:</b> {error.replace(/^error:\s*/, '')}</>
        )}
      </div>
    </div>
  );
};

const BackfillDialog = ({ open, onOpenChange, timezone, busy, onRun }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  timezone: string;
  busy: boolean;
  onRun: (sinceIso: string) => void;
}) => {
  const [since, setSince] = useState(() => addDaysToDateString(todayInTz(timezone), -60));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Backfill orders from Shopify</DialogTitle>
          <DialogDescription>
            Re-pulls every order created since the date below — use it when orders are missing here, and to fill in
            ship dates and payment fees for older orders. Large ranges can take a few minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-sm">Orders created since</Label>
          <Input type="date" value={since} onChange={e => setSince(e.target.value)} />
          <p className="text-xs text-slate-500">
            Shopify only returns the last 60 days unless the app has been granted <code>read_all_orders</code>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onRun(daysToRange(since, since, timezone).from.toISOString())} disabled={busy || !since}
                  className="bg-teal-600 hover:bg-teal-700">
            <History className="h-4 w-4 mr-1.5" /> Start backfill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
