/**
 * History of supplier payments for the active store: download each one's
 * statement, or void a payment recorded by mistake (its orders become payable
 * again). Voiding needs the 'costs' capability.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Download, Loader2, Undo2 } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { downloadFromApi } from '@/utils/download';
import { useToast } from '@/hooks/use-toast';

interface Payment {
  id: string;
  supplier: string;
  status: 'PAID' | 'VOID';
  orderCount: number;
  unitCount: number;
  productCost: string;
  shippingCost: string;
  totalCost: string;
  currency: string;
  paidAt: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
  voidedAt: string | null;
}

const money = (v: string) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);

export const SupplierPaymentsDialog = ({ open, onOpenChange, canVoid, onChanged }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canVoid: boolean;
  onChanged: () => void;
}) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ settlements: Payment[] }>('/api/supplier-settlements');
      setRows(r.settlements);
    } catch (e: any) {
      toast({ title: 'Could not load supplier payments', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const statement = async (p: Payment) => {
    setBusy(`dl-${p.id}`);
    try {
      await downloadFromApi(`/api/supplier-settlements/${p.id}/statement`,
        `supplier-payment-${p.supplier}-${day(p.paidAt)}.csv`);
    } catch (e: any) {
      toast({ title: 'Download failed', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const voidPayment = async (p: Payment) => {
    if (!window.confirm(`Void the ${money(p.totalCost)} ${p.currency} payment to ${p.supplier} on ${day(p.paidAt)}? Its ${p.orderCount} orders become unpaid again.`)) return;
    setBusy(`void-${p.id}`);
    try {
      await apiFetch(`/api/supplier-settlements/${p.id}/void`, { method: 'POST' });
      toast({ title: 'Payment voided', description: `${p.orderCount} orders are payable again` });
      await load();
      onChanged();
    } catch (e: any) {
      toast({ title: 'Could not void the payment', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Supplier payments</DialogTitle>
          <DialogDescription>
            Totals are frozen when a payment is recorded. Select orders on the Fulfillment list to record a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="py-10 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No supplier payments recorded yet.</div>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Paid</th>
                  <th className="text-left px-3 py-2">Supplier</th>
                  <th className="text-right px-3 py-2">Orders</th>
                  <th className="text-right px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Shipping</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Reference</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className={`border-t border-slate-100 ${p.status === 'VOID' ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{day(p.paidAt)}</td>
                    <td className="px-3 py-2">
                      {p.supplier}
                      {p.status === 'VOID' && <Badge variant="outline" className="ml-2 text-[10px] no-underline">void</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right">{p.orderCount}</td>
                    <td className="px-3 py-2 text-right">{money(p.productCost)}</td>
                    <td className="px-3 py-2 text-right">{money(p.shippingCost)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(p.totalCost)} {p.currency}</td>
                    <td className="px-3 py-2 max-w-[160px] truncate" title={p.note ?? undefined}>{p.reference || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Download statement"
                              disabled={busy === `dl-${p.id}` || p.status === 'VOID'} onClick={() => void statement(p)}>
                        {busy === `dl-${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      {canVoid && p.status === 'PAID' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-700" title="Void payment"
                                disabled={busy === `void-${p.id}`} onClick={() => void voidPayment(p)}>
                          {busy === `void-${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
