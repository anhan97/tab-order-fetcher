/**
 * Excel-style COGS price matrix.
 *
 * Rows   = product variants (grouped by product).
 * Columns= "line ship" (supplier × carrier × country) — each line shows one
 *          sub-column per SET size (Set 1 = giá 1 cái, Set 2 = giá combo 2…).
 * Cell   = TOTAL landed cost (product + ship) for that set via that line.
 *
 * Feels like a spreadsheet: click & type, Arrow/Enter/Tab navigation, paste a
 * whole block copied from Excel/Google Sheets, autosave (debounced) with a
 * visible saving/saved indicator. Data shared per store (whole team sees it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Loader2, Plus, RefreshCw, MoreVertical, Trash2, Pencil,
  Search, Check, Grid3X3, Download, Calculator
} from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface MatrixVariant {
  variantId: string;
  productId: string;
  sku: string | null;
  title: string;
  basecost: string;
  imageUrl: string | null;
}

/** Inclusive drag-fill range; anchor (r0,c0) is the cell whose value spreads. */
interface FillRange { r0: number; c0: number; r1: number; c1: number; }
interface MatrixLine {
  id: string;
  supplier: string;
  carrier: string;
  countryCode: string;
  currency: string;
  setSizes: number[];
  sortOrder: number;
  prices: Array<{ variantId: string; setQty: number; cost: string }>;
}

const COUNTRIES = ['US', 'CA', 'AU', 'GB', 'UK', 'NZ', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'IE', 'CH', 'AT', 'BE'];
const CURRENCIES = ['USD', 'AUD', 'CAD', 'GBP', 'EUR'];

const cellKey = (lineId: string, variantId: string, setQty: number) => `${lineId}|${variantId}|${setQty}`;

/** Flattened column list: one entry per (line, set). */
interface FlatCol { line: MatrixLine; setQty: number; }

export const CogsMatrix = () => {
  const { activeStore } = useAuth();
  const { toast } = useToast();
  const [variants, setVariants] = useState<MatrixVariant[]>([]);
  const [lines, setLines] = useState<MatrixLine[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [q, setQ] = useState('');
  const [lineDialog, setLineDialog] = useState<null | { mode: 'create' } | { mode: 'edit'; line: MatrixLine }>(null);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fill, setFill] = useState<FillRange | null>(null);
  const fillRef = useRef<FillRange | null>(null);
  fillRef.current = fill;
  // Cell the mouse went down on — becomes the fill anchor the moment the
  // pointer crosses into another cell while the button is still held.
  const pendingDrag = useRef<{ r: number; c: number } | null>(null);

  // Line dialog fields
  const [fSupplier, setFSupplier] = useState('Default');
  const [fCarrier, setFCarrier] = useState('');
  const [fCountry, setFCountry] = useState('US');
  const [fCurrency, setFCurrency] = useState('USD');
  const [fSaving, setFSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const r = await apiFetch<{ variants: MatrixVariant[]; lines: MatrixLine[] }>('/api/cogs-matrix');
      setVariants(r.variants);
      setLines(r.lines);
      const vals: Record<string, string> = {};
      for (const l of r.lines) {
        for (const p of l.prices) vals[cellKey(l.id, p.variantId, p.setQty)] = String(Number(p.cost));
      }
      setValues(vals);
      setDirty(new Set());
    } catch (e: any) {
      toast({ title: 'Không tải được bảng giá', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeStore, toast]);

  useEffect(() => { void load(); }, [load]);

  // ── Autosave (debounced 900ms after the last edit) ────────────────────────
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (dirty.size === 0) return;
    const t = setTimeout(async () => {
      const keys = [...dirtyRef.current];
      if (keys.length === 0) return;
      setSaveState('saving');
      try {
        const cells = keys.map(k => {
          const [lineId, variantId, setQty] = k.split('|');
          const raw = valuesRef.current[k];
          return { lineId, variantId, setQty: Number(setQty), cost: raw?.trim() ? raw : null };
        });
        await apiFetch('/api/cogs-matrix/prices', { method: 'PUT', body: JSON.stringify({ cells }) });
        setDirty(prev => {
          const next = new Set(prev);
          keys.forEach(k => next.delete(k));
          return next;
        });
        setSaveState('saved');
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
      } catch (e: any) {
        setSaveState('idle');
        toast({ title: 'Lưu giá thất bại', description: e?.message, variant: 'destructive' });
      }
    }, 900);
    return () => clearTimeout(t);
  }, [dirty, toast]);

  // ── Derived: filtered product groups + flat columns ───────────────────────
  const flatCols: FlatCol[] = useMemo(
    () => lines.flatMap(line => line.setSizes.map(setQty => ({ line, setQty }))),
    [lines]
  );

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? variants.filter(v => v.title.toLowerCase().includes(needle) || (v.sku || '').toLowerCase().includes(needle))
      : variants;
    const byProduct = new Map<string, MatrixVariant[]>();
    for (const v of filtered) {
      const arr = byProduct.get(v.productId) || [];
      arr.push(v);
      byProduct.set(v.productId, arr);
    }
    return [...byProduct.entries()].map(([productId, vs]) => {
      // Product label = common prefix of variant titles (up to " - "), else first title.
      let label = vs[0].title;
      const dash = label.indexOf(' - ');
      if (vs.length > 1 && dash > 0 && vs.every(v => v.title.startsWith(label.slice(0, dash)))) {
        label = label.slice(0, dash);
      }
      return {
        productId,
        label,
        image: vs.find(v => v.imageUrl)?.imageUrl ?? null,
        variants: vs.map(v => {
          const short = vs.length > 1 && v.title.startsWith(label) && v.title.length > label.length
            ? v.title.slice(label.length).replace(/^\s*-\s*/, '')
            : v.title;
          return { ...v, shortTitle: short || v.title };
        })
      };
    });
  }, [variants, q]);

  /** Visible row list (variant rows only, in render order) for keyboard/paste. */
  const flatRows = useMemo(() => groups.flatMap(g => g.variants), [groups]);

  // ── Cell editing ──────────────────────────────────────────────────────────
  const setCell = (key: string, raw: string) => {
    // Allow digits + one separator only; keep raw while typing.
    if (raw !== '' && !/^\d*[.,]?\d*$/.test(raw)) return;
    setValues(prev => ({ ...prev, [key]: raw }));
    setDirty(prev => new Set(prev).add(key));
  };

  const focusCell = (r: number, c: number) => {
    const el = document.getElementById(`cogs-cell-${r}-${c}`) as HTMLInputElement | null;
    if (el) { el.focus(); el.select(); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const nav: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Enter: [r + 1, c]
    };
    if (e.key in nav) {
      e.preventDefault();
      const [nr, nc] = nav[e.key];
      if (nr >= 0 && nr < flatRows.length) focusCell(nr, nc);
      return;
    }
    // Left/Right only jump cells when the caret is at the edge of the text.
    const input = e.currentTarget;
    if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0 && c > 0) {
      e.preventDefault(); focusCell(r, c - 1);
    } else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && c < flatCols.length - 1) {
      e.preventDefault(); focusCell(r, c + 1);
    }
  };

  /** Paste a block copied from Excel/Sheets starting at (r, c). */
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return; // single value → default behavior
    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter(row => row.length > 0);
    let filled = 0;
    setValues(prev => {
      const next = { ...prev };
      const newDirty: string[] = [];
      rows.forEach((row, dr) => {
        row.split('\t').forEach((val, dc) => {
          const rr = r + dr, cc = c + dc;
          if (rr >= flatRows.length || cc >= flatCols.length) return;
          const cleaned = val.trim().replace(/[^0-9.,]/g, '');
          const col = flatCols[cc];
          const key = cellKey(col.line.id, flatRows[rr].variantId, col.setQty);
          next[key] = cleaned;
          newDirty.push(key);
          filled++;
        });
      });
      setDirty(pd => { const s = new Set(pd); newDirty.forEach(k => s.add(k)); return s; });
      return next;
    });
    toast({ title: `Đã dán ${filled} ô` });
  };

  // ── Excel-style drag-fill (no handle) ─────────────────────────────────────
  // Hold the mouse down on a cell and sweep across the row or column: the
  // moment the pointer crosses into another cell, fill mode kicks in — the
  // press-down cell is the anchor and its value spreads over the swept range
  // on release. A plain click (press + release in one cell) still just edits.
  const flatColsRef = useRef(flatCols);
  flatColsRef.current = flatCols;
  const flatRowsRef = useRef(flatRows);
  flatRowsRef.current = flatRows;

  const applyFill = useCallback(() => {
    const range = fillRef.current;
    setFill(null);
    if (!range) return;
    const { r0, c0, r1, c1 } = range;
    if (r0 === r1 && c0 === c1) return;
    const cols = flatColsRef.current, rows = flatRowsRef.current;
    const src = cols[c0] && rows[r0]
      ? valuesRef.current[cellKey(cols[c0].line.id, rows[r0].variantId, cols[c0].setQty)] ?? ''
      : '';
    const keys: string[] = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        if (r === r0 && c === c0) continue;
        keys.push(cellKey(cols[c].line.id, rows[r].variantId, cols[c].setQty));
      }
    }
    setValues(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = src; });
      return next;
    });
    setDirty(prev => { const s = new Set(prev); keys.forEach(k => s.add(k)); return s; });
    toast({ title: `Đã fill ${keys.length} ô${src === '' ? ' (xoá giá)' : ` = ${src}`}` });
  }, [toast]);

  const onCellMouseDown = (r: number, c: number) => {
    pendingDrag.current = { r, c };
    const onUp = () => {
      document.removeEventListener('mouseup', onUp);
      pendingDrag.current = null;
      applyFill();
    };
    document.addEventListener('mouseup', onUp);
  };

  /** Constrain to the dominant axis, re-evaluated every move so you can change direction mid-drag. */
  const constrained = (anchor: { r: number; c: number }, r: number, c: number): FillRange => {
    const dr = Math.abs(r - anchor.r), dc = Math.abs(c - anchor.c);
    return dr >= dc
      ? { r0: anchor.r, c0: anchor.c, r1: r, c1: anchor.c }
      : { r0: anchor.r, c0: anchor.c, r1: anchor.r, c1: c };
  };

  const onCellMouseEnter = (r: number, c: number) => {
    const start = pendingDrag.current;
    if (!start) return;
    if (!fillRef.current) {
      if (start.r === r && start.c === c) return; // still inside the press-down cell
      window.getSelection()?.removeAllRanges();   // cancel any text selection started in the input
      setFill(constrained(start, r, c));
    } else {
      setFill(constrained(start, r, c));
    }
  };

  const inFill = (r: number, c: number): boolean => {
    if (!fill) return false;
    return r >= Math.min(fill.r0, fill.r1) && r <= Math.max(fill.r0, fill.r1)
        && c >= Math.min(fill.c0, fill.c1) && c <= Math.max(fill.c0, fill.c1);
  };

  // ── Line CRUD ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setFSupplier('Default'); setFCarrier(''); setFCountry('US'); setFCurrency('USD');
    setLineDialog({ mode: 'create' });
  };
  const openEdit = (line: MatrixLine) => {
    setFSupplier(line.supplier); setFCarrier(line.carrier);
    setFCountry(line.countryCode); setFCurrency(line.currency);
    setLineDialog({ mode: 'edit', line });
  };

  const saveLine = async () => {
    setFSaving(true);
    try {
      const body = { supplier: fSupplier, carrier: fCarrier, countryCode: fCountry, currency: fCurrency };
      if (lineDialog?.mode === 'edit') {
        await apiFetch(`/api/cogs-matrix/lines/${lineDialog.line.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/cogs-matrix/lines', { method: 'POST', body: JSON.stringify({ ...body, setSizes: [1, 2, 3] }) });
      }
      setLineDialog(null);
      await load();
    } catch (e: any) {
      toast({ title: 'Lưu line thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setFSaving(false);
    }
  };

  const deleteLine = async (line: MatrixLine) => {
    if (!window.confirm(`Xoá line ${line.carrier} · ${line.countryCode}? Toàn bộ giá của line này sẽ mất.`)) return;
    try {
      await apiFetch(`/api/cogs-matrix/lines/${line.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      toast({ title: 'Xoá line thất bại', description: e?.message, variant: 'destructive' });
    }
  };

  const changeSets = async (line: MatrixLine, action: 'add' | 'removeLast') => {
    const sizes = action === 'add'
      ? [...line.setSizes, Math.max(...line.setSizes) + 1]
      : line.setSizes.slice(0, -1);
    if (sizes.length === 0) return;
    try {
      await apiFetch(`/api/cogs-matrix/lines/${line.id}`, { method: 'PATCH', body: JSON.stringify({ setSizes: sizes }) });
      setLines(prev => prev.map(l => (l.id === line.id ? { ...l, setSizes: sizes } : l)));
    } catch (e: any) {
      toast({ title: 'Không đổi được set', description: e?.message, variant: 'destructive' });
    }
  };

  /** Re-freeze unitBasecost for the last 90 days of orders using the matrix. */
  const applyToPL = async () => {
    setApplying(true);
    try {
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const r = await apiFetch<{ ordersProcessed: number }>('/api/pl/recompute-cogs', {
        method: 'POST',
        body: JSON.stringify({ from })
      });
      toast({ title: `Đã tính lại giá vốn cho ${r.ordersProcessed} đơn (90 ngày)` });
    } catch (e: any) {
      toast({ title: 'Tính lại P&L thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const importPricebooks = async () => {
    setImporting(true);
    try {
      const r = await apiFetch<{ createdLines: number; createdCells: number }>(
        '/api/cogs-matrix/import-pricebooks', { method: 'POST' }
      );
      toast({
        title: r.createdLines > 0
          ? `Đã nhập ${r.createdLines} line, ${r.createdCells} ô giá từ cấu hình cũ`
          : 'Không có gì mới để nhập (đã nhập trước đó hoặc chưa có dữ liệu cũ)'
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Nhập dữ liệu cũ thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!activeStore) {
    return (
      <div className="border-2 border-dashed rounded-xl p-12 text-center text-slate-500">
        <div className="font-medium text-slate-700 mb-1">Chưa chọn store</div>
        <p className="text-sm">Kết nối / chọn store ở sidebar để cấu hình bảng giá vốn.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Đang tải bảng giá…
      </div>
    );
  }

  let rowCounter = -1; // running index across groups → keyboard grid coordinates

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Tìm sản phẩm / SKU…" value={q} onChange={e => setQ(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="flex-1" />
        <span className="text-xs text-slate-400 min-w-[90px] text-right">
          {saveState === 'saving' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Đang lưu…</span>}
          {saveState === 'saved' && <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Đã lưu</span>}
          {saveState === 'idle' && dirty.size > 0 && 'Đang gõ…'}
        </span>
        <Button variant="outline" size="sm" onClick={() => void load()} title="Tải lại">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={importPricebooks} disabled={importing} title="Nhập line + giá từ cấu hình COGS cũ (không ghi đè)">
          {importing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
          Nhập từ cấu hình cũ
        </Button>
        <Button variant="outline" size="sm" onClick={applyToPL} disabled={applying}
                title="Tính lại giá vốn các đơn 90 ngày gần nhất theo bảng giá này (P&L sẽ cập nhật)">
          {applying ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Calculator className="h-4 w-4 mr-1.5" />}
          Áp dụng vào P&L
        </Button>
        <Button size="sm" onClick={openCreate} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="h-4 w-4 mr-1.5" /> Thêm line ship
        </Button>
      </div>

      {/* Empty state */}
      {lines.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl p-12 text-center text-slate-500 space-y-3">
          <Grid3X3 className="h-10 w-10 mx-auto text-slate-300" />
          <div className="font-medium text-slate-700">Chưa có line ship nào</div>
          <p className="text-sm max-w-md mx-auto">
            Mỗi <b>line ship</b> là một cột giá: supplier + đơn vị vận chuyển + quốc gia
            (VD: <i>Default · YT · US</i>). Thêm line đầu tiên hoặc nhập lại từ cấu hình cũ.
          </p>
          <div className="flex justify-center gap-2 pt-1">
            <Button variant="outline" onClick={importPricebooks} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
              Nhập từ cấu hình cũ
            </Button>
            <Button onClick={openCreate} className="bg-teal-600 hover:bg-teal-700">
              <Plus className="h-4 w-4 mr-1.5" /> Thêm line ship
            </Button>
          </div>
        </div>
      ) : (
        <div className="border rounded-xl overflow-auto max-h-[70vh] bg-white">
          <table className={`border-collapse text-sm min-w-full ${fill ? 'select-none cursor-crosshair' : ''}`}>
            <thead>
              {/* Line header row */}
              <tr className="sticky top-0 z-30">
                <th className="sticky left-0 z-40 bg-slate-100 border-b border-r px-3 py-2 text-left min-w-[260px] font-semibold text-slate-700">
                  Sản phẩm
                </th>
                {lines.map(line => (
                  <th key={line.id} colSpan={line.setSizes.length}
                      className="bg-slate-100 border-b border-r px-2 py-1.5 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <div className="leading-tight">
                        <div className="font-semibold text-slate-800">
                          {line.carrier} · {line.countryCode}
                        </div>
                        <div className="text-[10px] font-normal text-slate-500">
                          {line.supplier !== 'Default' ? `${line.supplier} · ` : ''}{line.currency}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => changeSets(line, 'add')}>
                            <Plus className="h-4 w-4 mr-2" /> Thêm set {Math.max(...line.setSizes) + 1}
                          </DropdownMenuItem>
                          {line.setSizes.length > 1 && (
                            <DropdownMenuItem onClick={() => changeSets(line, 'removeLast')}>
                              <Trash2 className="h-4 w-4 mr-2" /> Ẩn set {Math.max(...line.setSizes)} (giá vẫn được giữ)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openEdit(line)}>
                            <Pencil className="h-4 w-4 mr-2" /> Sửa line
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-rose-600" onClick={() => deleteLine(line)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Xoá line
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </th>
                ))}
              </tr>
              {/* Set sub-header row */}
              <tr className="sticky top-[46px] z-30">
                <th className="sticky left-0 z-40 bg-slate-50 border-b border-r px-3 py-1 text-left text-[11px] font-normal text-slate-400">
                  giá = tổng cost (hàng + ship) cho cả set
                </th>
                {flatCols.map((col, ci) => (
                  <th key={`${col.line.id}-${col.setQty}`}
                      className={`bg-slate-50 border-b px-2 py-1 text-center text-xs font-medium text-slate-500 min-w-[86px] ${ci < flatCols.length - 1 && flatCols[ci + 1].line.id !== col.line.id ? 'border-r' : 'border-r border-r-slate-100'}`}>
                    Set {col.setQty}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <FragmentGroup key={g.productId} label={g.label} image={g.image} colCount={flatCols.length}>
                  {g.variants.map(v => {
                    rowCounter += 1;
                    const r = rowCounter;
                    return (
                      <tr key={v.variantId} className="hover:bg-teal-50/30">
                        <td className="sticky left-0 z-20 bg-white border-b border-r px-3 py-1 whitespace-nowrap max-w-[320px]">
                          <div className="flex items-center gap-2">
                            {v.imageUrl ? (
                              <img src={v.imageUrl} alt="" loading="lazy"
                                   className="w-7 h-7 rounded object-cover border border-slate-200 shrink-0" />
                            ) : (
                              <div className="w-7 h-7 rounded bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-[9px] text-slate-400">
                                {v.shortTitle.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-slate-800">{v.shortTitle}</div>
                              {v.sku && <div className="text-[10px] text-slate-400 truncate">{v.sku}</div>}
                            </div>
                          </div>
                        </td>
                        {flatCols.map((col, c) => {
                          const key = cellKey(col.line.id, v.variantId, col.setQty);
                          const val = values[key] ?? '';
                          const isDirty = dirty.has(key);
                          const lineEdge = c < flatCols.length - 1 && flatCols[c + 1].line.id !== col.line.id;
                          const highlighted = inFill(r, c);
                          const isAnchor = fill && fill.r0 === r && fill.c0 === c;
                          return (
                            <td
                              key={key}
                              onMouseDown={() => onCellMouseDown(r, c)}
                              onMouseEnter={() => onCellMouseEnter(r, c)}
                              onDragStart={e => e.preventDefault()}
                              className={`relative border-b p-0 transition-colors duration-75
                                ${lineEdge ? 'border-r' : 'border-r border-r-slate-100'}
                                ${highlighted ? (isAnchor ? 'bg-teal-200/80 ring-1 ring-inset ring-teal-500' : 'bg-teal-100/70') : ''}`}
                            >
                              <input
                                id={`cogs-cell-${r}-${c}`}
                                value={val}
                                onChange={e => setCell(key, e.target.value)}
                                onKeyDown={e => onKeyDown(e, r, c)}
                                onPaste={e => onPaste(e, r, c)}
                                onFocus={e => e.currentTarget.select()}
                                inputMode="decimal"
                                placeholder="—"
                                className={`w-full h-8 px-2 text-right text-sm outline-none bg-transparent
                                  focus:bg-teal-50 focus:ring-2 focus:ring-inset focus:ring-teal-400
                                  placeholder:text-slate-200 ${isDirty ? 'bg-amber-50' : ''}
                                  ${fill ? 'pointer-events-none' : ''}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </FragmentGroup>
              ))}
              {flatRows.length === 0 && (
                <tr>
                  <td colSpan={flatCols.length + 1} className="h-24 text-center text-slate-400">
                    Không có sản phẩm khớp tìm kiếm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        💡 Mẹo: bấm vào ô rồi gõ giá — tự lưu sau ~1 giây. Di chuyển bằng phím mũi tên / Enter.
        Copy nguyên vùng từ Excel/Google Sheets rồi dán (Ctrl+V) vào ô bắt đầu.
        <b> Giữ chuột trên 1 ô rồi kéo</b> ngang/dọc để fill giá ô đó sang cả vùng (như Excel).
        <b> Set N</b> = tổng giá vốn khi khách mua N cái (đã gồm ship của set đó).
      </p>

      {/* Line create/edit dialog */}
      <Dialog open={!!lineDialog} onOpenChange={o => { if (!o) setLineDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{lineDialog?.mode === 'edit' ? 'Sửa line ship' : 'Thêm line ship'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Đơn vị vận chuyển (line) *</Label>
              <Input value={fCarrier} onChange={e => setFCarrier(e.target.value)} placeholder="VD: YT, LP, SF, YunExpress…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Quốc gia *</Label>
                <Select value={fCountry} onValueChange={setFCountry}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Tiền tệ</Label>
                <Select value={fCurrency} onValueChange={setFCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-sm">Supplier (tuỳ chọn)</Label>
              <Input value={fSupplier} onChange={e => setFSupplier(e.target.value)} placeholder="Default" />
              <p className="text-[11px] text-slate-400 mt-1">
                Để "Default" nếu chỉ có 1 nhà cung cấp. Đặt tên riêng khi cùng 1 line ship nhưng giá theo supplier khác nhau.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineDialog(null)}>Huỷ</Button>
            <Button onClick={saveLine} disabled={fSaving || !fCarrier.trim()} className="bg-teal-600 hover:bg-teal-700">
              {fSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {lineDialog?.mode === 'edit' ? 'Lưu' : 'Thêm line'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** Product group header row + its variant rows. */
const FragmentGroup = ({ label, image, colCount, children }: {
  label: string; image: string | null; colCount: number; children: React.ReactNode;
}) => (
  <>
    <tr>
      <td className="sticky left-0 z-20 bg-slate-50/95 border-b border-r px-3 py-1.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {image && (
            <img src={image} alt="" loading="lazy"
                 className="w-5 h-5 rounded object-cover border border-slate-200 shrink-0" />
          )}
          <span className="font-semibold text-slate-600 text-xs uppercase tracking-wide">{label}</span>
        </div>
      </td>
      <td colSpan={colCount} className="bg-slate-50/95 border-b" />
    </tr>
    {children}
  </>
);
