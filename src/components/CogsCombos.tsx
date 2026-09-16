/**
 * Combo pricing — a priced mix of DIFFERENT products, per ship line.
 *
 * The matrix above prices N units of one product (Set 1, Set 2…). A combo
 * prices a specific basket such as "shirt + cap", because two different
 * products shipped together cost differently than pricing each alone.
 *
 * P&L uses a combo only when an order's items match it EXACTLY (same products,
 * same quantities) and the combo has a price on the order's ship line. The
 * combo total is then split across the order's items, weighted by each item's
 * own Set 1 price.
 *
 * Rows = combos. Columns = ship lines, each with Product | Ship | Total.
 * Cells autosave like the matrix.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Pencil, Check, Layers, X } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';
import type { MatrixLine, MatrixVariant } from '@/components/CogsMatrix';
import { type CostPart, totalOf, fromServer } from '@/utils/cogsCost';

export interface MatrixCombo {
  id: string;
  name: string;
  items: Array<{ variantId: string; qty: number }>;
  sortOrder: number;
  prices: Array<{ lineId: string; productCost: string; shippingCost: string; cost: string }>;
}

interface Props {
  variants: MatrixVariant[];
  lines: MatrixLine[];
  combos: MatrixCombo[];
  /** Re-fetch the whole matrix (after creating / editing / deleting a combo). */
  onChanged: () => void | Promise<void>;
}

const key = (comboId: string, lineId: string, part: CostPart) => `${comboId}|${lineId}|${part}`;

export const CogsCombos = ({ variants, lines, combos, onChanged }: Props) => {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dialog, setDialog] = useState<null | { mode: 'create' } | { mode: 'edit'; combo: MatrixCombo }>(null);

  const variantById = useMemo(() => new Map(variants.map(v => [v.variantId, v])), [variants]);

  // Seed cell values whenever the server list changes.
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const c of combos) {
      for (const p of c.prices) {
        vals[key(c.id, p.lineId, 'p')] = fromServer(p.productCost);
        vals[key(c.id, p.lineId, 's')] = fromServer(p.shippingCost);
      }
    }
    setValues(vals);
    setDirty(new Set());
  }, [combos]);

  // ── Autosave, same cadence as the matrix ───────────────────────────────────
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (dirty.size === 0) return;
    const t = setTimeout(async () => {
      const keys = [...dirtyRef.current];
      if (keys.length === 0) return;
      setSaveState('saving');
      try {
        const bases = [...new Set(keys.map(k => k.slice(0, k.lastIndexOf('|'))))];
        const cells = bases.map(b => {
          const [comboId, lineId] = b.split('|');
          const p = valuesRef.current[`${b}|p`] ?? '';
          const s = valuesRef.current[`${b}|s`] ?? '';
          return { comboId, lineId, productCost: p.trim() ? p : null, shippingCost: s.trim() ? s : null };
        });
        await apiFetch('/api/cogs-matrix/combo-prices', { method: 'PUT', body: JSON.stringify({ cells }) });
        setDirty(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
        setSaveState('saved');
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
      } catch (e: any) {
        setSaveState('idle');
        toast({ title: 'Could not save combo prices', description: e?.message, variant: 'destructive' });
      }
    }, 900);
    return () => clearTimeout(t);
  }, [dirty, toast]);

  const setCell = (k: string, raw: string) => {
    if (raw !== '' && !/^\d*[.,]?\d*$/.test(raw)) return;
    setValues(prev => ({ ...prev, [k]: raw }));
    setDirty(prev => new Set(prev).add(k));
  };

  const removeCombo = async (combo: MatrixCombo) => {
    if (!window.confirm(`Delete combo "${combo.name}"? Its prices on every ship line will be lost.`)) return;
    try {
      await apiFetch(`/api/cogs-matrix/combos/${combo.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (e: any) {
      toast({ title: 'Could not delete the combo', description: e?.message, variant: 'destructive' });
    }
  };

  const describe = (combo: MatrixCombo) =>
    combo.items
      .map(i => `${i.qty}× ${variantById.get(i.variantId)?.title ?? `#${i.variantId}`}`)
      .join(' + ');

  return (
    <div className="space-y-2 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-teal-600" />
          <h3 className="font-semibold text-slate-800">Combos</h3>
          <span className="text-xs text-slate-400">different products bought together</span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-slate-400 min-w-[80px] text-right">
          {saveState === 'saving' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
          {saveState === 'saved' && <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Saved</span>}
        </span>
        <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'create' })}>
          <Plus className="h-4 w-4 mr-1.5" /> Add combo
        </Button>
      </div>

      {combos.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl p-6 text-center text-sm text-slate-500">
          No combos yet. Add one when buying two different products together costs a different amount —
          for example <i>1× Shirt + 1× Cap</i>.
        </div>
      ) : (
        <div className="border rounded-xl overflow-auto bg-white">
          <table className="border-collapse text-sm min-w-full">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 z-20 bg-slate-100 border-b border-r px-3 py-2 text-left min-w-[280px] font-semibold text-slate-700">
                  Combo
                </th>
                {lines.map(line => (
                  <th key={line.id} colSpan={3} className="bg-slate-100 border-b border-r px-2 py-1.5 text-center whitespace-nowrap font-semibold text-slate-800">
                    {line.carrier} · {line.countryCode}
                    {line.supplier !== 'Default' && <span className="ml-1 text-[10px] font-normal text-slate-500">{line.supplier}</span>}
                  </th>
                ))}
              </tr>
              <tr>
                {lines.flatMap(line => [
                  <th key={`${line.id}-p`} className="bg-slate-50 border-b border-r border-r-slate-100 px-1 py-0.5 text-[10px] font-normal text-slate-500 min-w-[72px]">Product</th>,
                  <th key={`${line.id}-s`} className="bg-slate-50 border-b border-r border-r-slate-100 px-1 py-0.5 text-[10px] font-normal text-slate-500 min-w-[72px]">Ship</th>,
                  <th key={`${line.id}-t`} className="bg-slate-100/70 border-b border-r px-1 py-0.5 text-[10px] font-semibold text-slate-600 min-w-[64px]">Total</th>
                ])}
              </tr>
            </thead>
            <tbody>
              {combos.map(combo => (
                <tr key={combo.id} className="hover:bg-teal-50/30">
                  <td className="sticky left-0 z-10 bg-white border-b border-r px-3 py-1.5 max-w-[360px]">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 truncate">{combo.name}</div>
                        <div className="text-[11px] text-slate-500 truncate" title={describe(combo)}>{describe(combo)}</div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Edit combo"
                              onClick={() => setDialog({ mode: 'edit', combo })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-rose-500 hover:text-rose-700" title="Delete combo"
                              onClick={() => void removeCombo(combo)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                  {lines.flatMap(line => {
                    const kp = key(combo.id, line.id, 'p');
                    const ks = key(combo.id, line.id, 's');
                    const cell = (k: string, part: CostPart) => (
                      <td key={k} className="border-b border-r border-r-slate-100 p-0">
                        <input
                          value={values[k] ?? ''}
                          onChange={e => setCell(k, e.target.value)}
                          onFocus={e => e.currentTarget.select()}
                          inputMode="decimal"
                          placeholder="—"
                          aria-label={`${combo.name} · ${line.carrier} ${line.countryCode} · ${part === 'p' ? 'product' : 'shipping'} cost`}
                          className={`w-full h-8 px-2 text-right text-sm outline-none bg-transparent
                            focus:bg-teal-50 focus:ring-2 focus:ring-inset focus:ring-teal-400 placeholder:text-slate-200
                            ${dirty.has(k) ? 'bg-amber-50' : ''}`}
                        />
                      </td>
                    );
                    const total = totalOf(values[kp], values[ks]);
                    return [
                      cell(kp, 'p'),
                      cell(ks, 's'),
                      <td key={`${combo.id}|${line.id}|t`} className="border-b border-r bg-slate-50/70 px-2 text-right text-sm tabular-nums font-medium text-slate-700">
                        {total || <span className="text-slate-200">—</span>}
                      </td>
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        An order uses a combo price only when its items match the combo <b>exactly</b> and the combo has a price on
        the order&apos;s ship line. Otherwise each product is costed from the matrix above. Hit <b>Apply to P&amp;L</b> after
        changing prices to recalculate past orders.
      </p>

      <ComboDialog
        state={dialog}
        variants={variants}
        onClose={() => setDialog(null)}
        onSaved={async () => { setDialog(null); await onChanged(); }}
      />
    </div>
  );
};

// ── Create / edit dialog ────────────────────────────────────────────────────

interface DraftItem { variantId: string; qty: string; }

const ComboDialog = ({ state, variants, onClose, onSaved }: {
  state: null | { mode: 'create' } | { mode: 'edit'; combo: MatrixCombo };
  variants: MatrixVariant[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit') {
      setName(state.combo.name);
      setItems(state.combo.items.map(i => ({ variantId: i.variantId, qty: String(i.qty) })));
    } else {
      setName('');
      setItems([{ variantId: '', qty: '1' }, { variantId: '', qty: '1' }]);
    }
  }, [state]);

  const chosen = items.filter(i => i.variantId);
  const distinct = new Set(chosen.map(i => i.variantId)).size;
  const canSave = name.trim() !== '' && distinct >= 2 && chosen.every(i => parseInt(i.qty, 10) >= 1);

  const save = async () => {
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        items: chosen.map(i => ({ variantId: i.variantId, qty: parseInt(i.qty, 10) }))
      });
      if (state?.mode === 'edit') {
        await apiFetch(`/api/cogs-matrix/combos/${state.combo.id}`, { method: 'PATCH', body });
      } else {
        await apiFetch('/api/cogs-matrix/combos', { method: 'POST', body });
      }
      await onSaved();
    } catch (e: any) {
      toast({ title: 'Could not save the combo', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const update = (idx: number, patch: Partial<DraftItem>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  return (
    <Dialog open={!!state} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit combo' : 'Add combo'}</DialogTitle>
          <DialogDescription>
            Pick at least two different products. Quantities must match what the customer orders.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shirt + Cap" />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Products *</Label>
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select value={it.variantId} onValueChange={v => update(idx, { variantId: v })}>
                  <SelectTrigger className="flex-1 h-9"><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {variants.map(v => (
                      <SelectItem key={v.variantId} value={v.variantId}>
                        {v.title}{v.sku ? ` · ${v.sku}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={it.qty}
                  onChange={e => /^\d{0,2}$/.test(e.target.value) && update(idx, { qty: e.target.value })}
                  inputMode="numeric"
                  className="w-16 h-9 text-right"
                  aria-label="Quantity"
                />
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={items.length <= 2}
                        title="Remove product" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setItems(prev => [...prev, { variantId: '', qty: '1' }])}>
              <Plus className="h-4 w-4 mr-1.5" /> Add product
            </Button>
            {chosen.length >= 2 && distinct < 2 && (
              <p className="text-xs text-amber-600">
                Pick two different products — several units of one product belong in the matrix Set columns.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!canSave || saving} className="bg-teal-600 hover:bg-teal-700">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {state?.mode === 'edit' ? 'Save' : 'Add combo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
