/**
 * Custom-column export for fulfillment orders.
 *
 * Lets the user pick which columns to export and in what order, save that
 * layout as a named preset (stored per-store in the DB, so the whole team
 * shares it — e.g. one preset per supplier whose sheet wants a specific set
 * of fields in a specific order), then either download a CSV or copy the rows
 * as text (tab-separated) to paste straight into a spreadsheet.
 *
 * The column catalog comes from GET /api/orders/export-fields — the same list
 * the backend export uses — so the two never drift.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  ArrowUp, ArrowDown, X, Plus, Save, Download, Copy, Trash2, Loader2
} from 'lucide-react';
import { apiFetch, buildHeaders } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

interface FieldDef { key: string; label: string; }
interface Preset {
  id: string;
  name: string;
  columns: string[];
  delimiter: 'comma' | 'tab';
  includeHeader: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current list filters so the export matches what's on screen. */
  q: string;
  tab: string;
}

export const OrderExportDialog = ({ open, onOpenChange, q, tab }: Props) => {
  const { toast } = useToast();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState<'comma' | 'tab'>('comma');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [presetName, setPresetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);

  const labelOf = useCallback(
    (key: string) => fields.find(f => f.key === key)?.label ?? key,
    [fields]
  );

  const available = useMemo(
    () => fields.filter(f => !selected.includes(f.key)),
    [fields, selected]
  );

  // Load the field catalog + saved presets when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cat, list] = await Promise.all([
          apiFetch<{ fields: FieldDef[]; defaultColumns: string[] }>('/api/orders/export-fields'),
          apiFetch<{ presets: Preset[] }>('/api/orders/export-presets')
        ]);
        if (cancelled) return;
        setFields(cat.fields);
        setPresets(list.presets);
        // Start from the last saved preset if any, else the default layout.
        if (list.presets.length > 0) {
          applyPreset(list.presets[0]);
        } else {
          setSelected(cat.defaultColumns);
          setActivePresetId('');
          setPresetName('');
        }
      } catch (e: any) {
        toast({ title: 'Không tải được cấu hình cột', description: e?.message, variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyPreset = (p: Preset) => {
    setSelected(Array.isArray(p.columns) ? p.columns : []);
    setDelimiter(p.delimiter === 'tab' ? 'tab' : 'comma');
    setIncludeHeader(p.includeHeader !== false);
    setActivePresetId(p.id);
    setPresetName(p.name);
  };

  const add = (key: string) => { setSelected(s => [...s, key]); setActivePresetId(''); };
  const remove = (key: string) => { setSelected(s => s.filter(k => k !== key)); setActivePresetId(''); };
  const move = (idx: number, dir: -1 | 1) => {
    setSelected(s => {
      const next = [...s];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return s;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setActivePresetId('');
  };

  const buildParams = (format: 'csv' | 'tsv') => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tab === 'UNPAID') params.set('paymentStatus', 'unpaid');
    else if (tab !== 'ALL') params.set('fulfillStatus', tab);
    params.set('columns', selected.join(','));
    params.set('format', format);
    if (!includeHeader) params.set('header', 'false');
    return params;
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return toast({ title: 'Nhập tên preset', variant: 'destructive' });
    if (selected.length === 0) return toast({ title: 'Chọn ít nhất 1 cột', variant: 'destructive' });
    setSaving(true);
    try {
      const { preset } = await apiFetch<{ preset: Preset }>('/api/orders/export-presets', {
        method: 'POST',
        body: JSON.stringify({ name, columns: selected, delimiter, includeHeader })
      });
      setPresets(prev => {
        const rest = prev.filter(p => p.id !== preset.id && p.name !== preset.name);
        return [...rest, preset].sort((a, b) => a.name.localeCompare(b.name));
      });
      setActivePresetId(preset.id);
      toast({ title: `Đã lưu preset "${preset.name}"` });
    } catch (e: any) {
      toast({ title: 'Lưu preset thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deletePreset = async () => {
    if (!activePresetId) return;
    const p = presets.find(x => x.id === activePresetId);
    if (!p) return;
    try {
      await apiFetch(`/api/orders/export-presets/${p.id}`, { method: 'DELETE' });
      setPresets(prev => prev.filter(x => x.id !== p.id));
      setActivePresetId('');
      toast({ title: `Đã xoá preset "${p.name}"` });
    } catch (e: any) {
      toast({ title: 'Xoá preset thất bại', description: e?.message, variant: 'destructive' });
    }
  };

  const download = async () => {
    if (selected.length === 0) return toast({ title: 'Chọn ít nhất 1 cột', variant: 'destructive' });
    setBusy('download');
    try {
      const format = delimiter === 'tab' ? 'tsv' : 'csv';
      const res = await fetch(`/api/orders/export?${buildParams(format)}`, { headers: buildHeaders() });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${tab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${format === 'tsv' ? 'txt' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Đã tải file export' });
    } catch (e: any) {
      toast({ title: 'Tải file thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const copyText = async () => {
    if (selected.length === 0) return toast({ title: 'Chọn ít nhất 1 cột', variant: 'destructive' });
    setBusy('copy');
    try {
      const format = delimiter === 'tab' ? 'tsv' : 'csv';
      const res = await fetch(`/api/orders/export?${buildParams(format)}`, { headers: buildHeaders() });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      let text = await res.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM for clipboard
      await copyToClipboard(text);
      toast({ title: 'Đã copy — dán thẳng vào Google Sheet / Excel' });
    } catch (e: any) {
      toast({ title: 'Copy thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tuỳ chỉnh cột export</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Đang tải…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Preset picker */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs text-slate-500">Preset đã lưu</Label>
                <Select
                  value={activePresetId || 'none'}
                  onValueChange={v => {
                    if (v === 'none') return;
                    const p = presets.find(x => x.id === v);
                    if (p) applyPreset(p);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="— Chọn preset —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Không dùng preset —</SelectItem>
                    {presets.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline" size="sm" onClick={deletePreset}
                disabled={!activePresetId} title="Xoá preset đang chọn"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Two-panel column editor */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500">Cột sẽ export (theo thứ tự)</Label>
                <ScrollArea className="h-56 rounded-md border mt-1">
                  <div className="p-1.5 space-y-1">
                    {selected.length === 0 ? (
                      <div className="text-xs text-slate-400 p-3 text-center">Chưa chọn cột nào</div>
                    ) : selected.map((key, idx) => (
                      <div key={key} className="flex items-center gap-1 rounded bg-slate-50 border px-2 py-1">
                        <span className="text-slate-300 text-xs w-5 tabular-nums">{idx + 1}</span>
                        <span className="flex-1 text-sm truncate">{labelOf(key)}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => move(idx, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === selected.length - 1} onClick={() => move(idx, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-rose-500" onClick={() => remove(key)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <Label className="text-xs text-slate-500">Cột có sẵn (bấm để thêm)</Label>
                <ScrollArea className="h-56 rounded-md border mt-1">
                  <div className="p-1.5 space-y-1">
                    {available.length === 0 ? (
                      <div className="text-xs text-slate-400 p-3 text-center">Đã thêm hết cột</div>
                    ) : available.map(f => (
                      <button
                        key={f.key}
                        onClick={() => add(f.key)}
                        className="w-full flex items-center gap-1.5 rounded px-2 py-1 text-sm text-left hover:bg-teal-50 hover:text-teal-700"
                      >
                        <Plus className="h-3.5 w-3.5 text-slate-400" />
                        <span className="truncate">{f.label}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Format + header options */}
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Định dạng</Label>
                <RadioGroup
                  value={delimiter}
                  onValueChange={v => setDelimiter(v as 'comma' | 'tab')}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <RadioGroupItem value="comma" id="fmt-comma" /> Dấu phẩy (CSV)
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <RadioGroupItem value="tab" id="fmt-tab" /> Tab (dán vào Sheet)
                  </label>
                </RadioGroup>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer mt-4">
                <Checkbox checked={includeHeader} onCheckedChange={v => setIncludeHeader(!!v)} />
                Kèm dòng tiêu đề
              </label>
            </div>

            {/* Save preset */}
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1">
                <Label className="text-xs text-slate-500">Lưu bộ cột này thành preset</Label>
                <Input
                  placeholder="VD: YunTu, Shengtu, US-supplier…"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={savePreset} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Lưu preset
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={copyText} disabled={!!busy || loading}>
            {busy === 'copy' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Copy className="h-4 w-4 mr-1.5" />}
            Copy text
          </Button>
          <Button onClick={download} disabled={!!busy || loading} className="bg-teal-600 hover:bg-teal-700">
            {busy === 'download' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            Tải file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** clipboard.writeText with a legacy execCommand fallback (non-HTTPS/older). */
async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to legacy path */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}
