/**
 * Sticky bar shown while orders are selected on the Fulfillment page: what is
 * owed to the supplier for them, and the actions that follow — download the
 * statement to send them, then record the payment.
 *
 * All money is computed by the server from each order's FROZEN line-item
 * costs (POST /api/orders/cost-summary). The bar only displays it, and refuses
 * to record a payment the server would refuse: missing costs, orders already
 * paid, cancelled orders, or more than one supplier in the selection.
 */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { AlertTriangle, Download, HandCoins, Loader2, X } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { downloadFromApi } from '@/utils/download';
import { useToast } from '@/hooks/use-toast';

interface Bucket { key: string; orders: number; units: number; product: number; shipping: number; total: number; }
interface OrderRef { id: string; orderNumber: string; }

export interface CostSummary {
  selected: number;
  orders: number;
  units: number;
  product: number;
  shipping: number;
  total: number;
  currency: string;
  missingCost: OrderRef[];
  alreadySettled: OrderRef[];
  cancelled: OrderRef[];
  unsplitOrders: number;
  suppliers: string[];
  bySupplier: Bucket[];
  byCarrier: Bucket[];
  byCountry: Bucket[];
}

/** Explicit ids, or "everything matching these filters" (across pages). */
export type Selection =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'filters'; filters: Record<string, string>; count: number };

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const refs = (list: OrderRef[], max = 6) =>
  list.slice(0, max).map(o => `#${o.orderNumber}`).join(', ') + (list.length > max ? ` +${list.length - max}` : '');

/** Mirrors settlementBlocker() on the server so the button is honest. */
function blocker(s: CostSummary): string | null {
  if (s.missingCost.length) return `${s.missingCost.length} order(s) have no cost yet`;
  if (s.alreadySettled.length) return `${s.alreadySettled.length} order(s) are already paid`;
  if (s.cancelled.length) return `${s.cancelled.length} cancelled order(s) selected`;
  if (s.suppliers.length > 1) return 'Several suppliers selected — pay one at a time';
  if (s.orders === 0) return 'Nothing payable in the selection';
  return null;
}

interface Props {
  selection: Selection;
  canPay: boolean;
  onClear: () => void;
  onPaid: () => void;
}

export const SupplierSelectionBar = ({ selection, canPay, onClear, onPaid }: Props) => {
  const { toast } = useToast();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const body = selection.kind === 'ids' ? { ids: selection.ids } : { filters: selection.filters };
  const bodyKey = JSON.stringify(body);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await apiFetch<CostSummary>('/api/orders/cost-summary', { method: 'POST', body: bodyKey });
        if (!cancelled) setSummary(r);
      } catch (e: any) {
        if (!cancelled) { setSummary(null); setError(e?.message || 'Could not total the selection'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [bodyKey]);

  const count = selection.kind === 'ids' ? selection.ids.length : selection.count;
  const stop = summary ? blocker(summary) : 'Totalling…';

  const downloadStatement = async () => {
    setDownloading(true);
    try {
      await downloadFromApi('/api/orders/supplier-statement',
        `supplier-statement-${format(new Date(), 'yyyy-MM-dd')}.csv`,
        { method: 'POST', body: bodyKey });
    } catch (e: any) {
      toast({ title: 'Could not download the statement', description: e?.message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="sticky bottom-0 z-30 -mx-1 rounded-xl border border-teal-200 bg-white/95 shadow-lg backdrop-blur px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} title="Clear selection">
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-slate-800">{count} selected</span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>

        {summary && (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
            <span className="text-slate-500">{summary.orders} payable · {summary.units} units</span>
            <span>Product <b>{money(summary.product)}</b></span>
            <span>Shipping <b>{money(summary.shipping)}</b></span>
            <span className="text-base">
              Owed to supplier <b className="text-teal-700">{money(summary.total)} {summary.currency}</b>
            </span>
            {summary.suppliers.length === 1 && (
              <span className="text-xs text-slate-500">Supplier: <b>{summary.suppliers[0]}</b></span>
            )}
          </div>
        )}
        {error && <span className="text-sm text-rose-600">{error}</span>}

        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void downloadStatement()} disabled={downloading || !summary}>
          {downloading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
          Statement CSV
        </Button>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700"
                disabled={!canPay || !!stop}
                title={!canPay ? 'Your access to this store cannot record payments' : stop ?? undefined}
                onClick={() => setPayOpen(true)}>
          <HandCoins className="h-4 w-4 mr-1.5" /> Mark paid to supplier…
        </Button>
      </div>

      {summary && (summary.missingCost.length > 0 || summary.alreadySettled.length > 0 || summary.cancelled.length > 0 || summary.suppliers.length > 1 || summary.unsplitOrders > 0) && (
        <div className="flex flex-col gap-1 text-xs">
          {summary.missingCost.length > 0 && (
            <Warn>
              <b>{summary.missingCost.length}</b> order(s) have products with no cost and are left out of the total: {refs(summary.missingCost)}.
              Price them under COGS, then hit <b>Apply to P&amp;L</b>.
            </Warn>
          )}
          {summary.alreadySettled.length > 0 && (
            <Warn><b>{summary.alreadySettled.length}</b> order(s) are already in a supplier payment and are not counted again: {refs(summary.alreadySettled)}.</Warn>
          )}
          {summary.cancelled.length > 0 && (
            <Warn><b>{summary.cancelled.length}</b> cancelled order(s) are not counted: {refs(summary.cancelled)}.</Warn>
          )}
          {summary.suppliers.length > 1 && (
            <Warn>
              Several suppliers: {summary.bySupplier.map(b => `${b.key} ${money(b.total)}`).join(' · ')}. Record one payment per supplier.
            </Warn>
          )}
          {summary.unsplitOrders > 0 && (
            <p className="text-slate-500">
              {summary.unsplitOrders} order(s) were costed before product/shipping were split — their whole cost is shown as product.
              The total is exact; <b>Apply to P&amp;L</b> on COGS fills in the split.
            </p>
          )}
        </div>
      )}

      {summary && summary.orders > 0 && (summary.byCarrier.length > 1 || summary.byCountry.length > 1) && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer select-none text-slate-500">Breakdown by carrier and country</summary>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <BucketTable title="Carrier" rows={summary.byCarrier} />
            <BucketTable title="Country" rows={summary.byCountry} />
          </div>
        </details>
      )}

      {summary && (
        <PayDialog open={payOpen} onOpenChange={setPayOpen} summary={summary} selection={selection}
                   onPaid={() => { setPayOpen(false); onPaid(); }} />
      )}
    </div>
  );
};

const Warn = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-start gap-1.5 text-amber-700">
    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
    <span>{children}</span>
  </p>
);

const BucketTable = ({ title, rows }: { title: string; rows: Bucket[] }) => (
  <table className="w-full tabular-nums">
    <thead className="text-slate-400">
      <tr><th className="text-left font-normal">{title}</th><th className="text-right font-normal">Orders</th><th className="text-right font-normal">Product</th><th className="text-right font-normal">Ship</th><th className="text-right font-normal">Total</th></tr>
    </thead>
    <tbody>
      {rows.map(r => (
        <tr key={r.key} className="border-t border-slate-100">
          <td>{r.key}</td><td className="text-right">{r.orders}</td>
          <td className="text-right">{money(r.product)}</td><td className="text-right">{money(r.shipping)}</td>
          <td className="text-right font-medium">{money(r.total)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const PayDialog = ({ open, onOpenChange, summary, selection, onPaid }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  summary: CostSummary;
  selection: Selection;
  onPaid: () => void;
}) => {
  const { toast } = useToast();
  const [paidAt, setPaidAt] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const record = async () => {
    setSaving(true);
    try {
      // "Select all matching" is resolved to concrete ids first, so the payment
      // covers exactly the orders that were totalled — not whatever matches
      // the filters a moment later.
      let orderIds: string[];
      if (selection.kind === 'ids') {
        orderIds = selection.ids;
      } else {
        const params = new URLSearchParams({ ...selection.filters, limit: '200', offset: '0' });
        orderIds = [];
        for (let offset = 0; offset < selection.count; offset += 200) {
          params.set('offset', String(offset));
          const page = await apiFetch<{ orders: Array<{ id: string }> }>(`/api/orders?${params}`);
          orderIds.push(...page.orders.map(o => o.id));
          if (page.orders.length < 200) break;
        }
      }
      // Only what the summary counted as payable goes into the payment.
      const excluded = new Set([...summary.missingCost, ...summary.alreadySettled, ...summary.cancelled].map(o => o.id));
      orderIds = orderIds.filter(id => !excluded.has(id));

      await apiFetch('/api/supplier-settlements', {
        method: 'POST',
        body: JSON.stringify({ orderIds, paidAt: `${paidAt}T12:00:00.000Z`, reference, note })
      });
      toast({ title: 'Supplier payment recorded', description: `${summary.orders} orders · ${money(summary.total)} ${summary.currency}` });
      setReference(''); setNote('');
      onPaid();
    } catch (e: any) {
      toast({ title: 'Could not record the payment', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record supplier payment</DialogTitle>
          <DialogDescription>
            These orders are marked as paid and cannot be selected for another payment unless this one is voided.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-slate-50 p-3 text-sm tabular-nums space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Supplier</span><b>{summary.suppliers[0]}</b></div>
          <div className="flex justify-between"><span className="text-slate-500">Orders · units</span><span>{summary.orders} · {summary.units}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Product</span><span>{money(summary.product)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Shipping</span><span>{money(summary.shipping)}</span></div>
          <div className="flex justify-between border-t pt-1 text-base"><span>Total</span><b>{money(summary.total)} {summary.currency}</b></div>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Payment date</Label>
            <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
          </div>
          <div>
            <Label className="text-sm">Reference</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank transfer / invoice no." />
          </div>
          <div>
            <Label className="text-sm">Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void record()} disabled={saving || !paidAt} className="bg-teal-600 hover:bg-teal-700">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
