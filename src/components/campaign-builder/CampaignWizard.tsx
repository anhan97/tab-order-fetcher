/**
 * Auto-launch ads — main wizard.
 *
 * 4 steps: Campaign → Ad sets → Creatives → Review. State lives in this
 * one component because the steps share a lot. The "Save as template" and
 * "Load template" controls sit in the header strip so they're available
 * from any step.
 *
 * Submission: multipart POST to /api/ads/bulk-launch with adSets+copy as
 * JSON body fields and creatives as `files`. The response is an SSE
 * stream — we parse it line-by-line for live progress.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/utils/apiClient';
import { parseAdCopyCsv, AdCopyEntry } from '@/utils/adCopyCsv';
import {
  Rocket, AlertTriangle, CheckCircle2, XCircle, Trash2, Image as ImageIcon, Film,
  Upload, FileSpreadsheet, Plus, ChevronLeft, ChevronRight, Save, ListChecks, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdSetEditor } from './AdSetEditor';
import {
  WizardConfig, EMPTY_WIZARD_CONFIG, DEFAULT_AUDIENCE,
  AdSetSpec, FbPage, FbPixel, LaunchProgressEvent, TemplateRow,
  OBJECTIVES, CTA_OPTIONS
} from './types';

interface Props {
  adAccounts: Array<{ id: string; name: string }>;
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const VIDEO_EXT = ['.mp4', '.mov', '.avi'];
const ACCEPTED = [...IMAGE_EXT, ...VIDEO_EXT];

const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

const formatSize = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
const ext = (name: string) => '.' + (name.split('.').pop() || '').toLowerCase();
const isImage = (name: string) => IMAGE_EXT.includes(ext(name));

const STEPS = ['Campaign', 'Ad sets', 'Creatives', 'Review'] as const;

export const CampaignWizard = ({ adAccounts }: Props) => {
  const { toast } = useToast();
  const [config, setConfig] = useState<WizardConfig>({ ...EMPTY_WIZARD_CONFIG });
  const set = useCallback(<K extends keyof WizardConfig>(k: K, v: WizardConfig[K]) =>
    setConfig(c => ({ ...c, [k]: v })), []);

  const [step, setStep] = useState(0);

  // Account-dependent data
  const [pages, setPages] = useState<FbPage[]>([]);
  const [pixels, setPixels] = useState<FbPixel[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Files + per-file copy
  const [files, setFiles] = useState<File[]>([]);
  const [csvName, setCsvName] = useState('');
  const [csvUnknownCols, setCsvUnknownCols] = useState<string[]>([]);
  const [perFileCopy, setPerFileCopy] = useState<Record<string, AdCopyEntry>>({});
  const [perFileAdSetIndexes, setPerFileAdSetIndexes] = useState<Record<string, number[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Templates
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [defaultLoaded, setDefaultLoaded] = useState(false);

  // Launch state
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState<LaunchProgressEvent[]>([]);
  const [results, setResults] = useState<NonNullable<LaunchProgressEvent['results']>>([]);
  const [summary, setSummary] = useState<LaunchProgressEvent['summary'] | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState({ index: 0, total: 0 });
  const progressRef = useRef<HTMLDivElement>(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Fetch templates once; auto-load default.
  useEffect(() => {
    apiFetch<{ templates: TemplateRow[] }>('/api/ads/templates')
      .then(({ templates }) => {
        setTemplates(templates);
        if (!defaultLoaded) {
          const def = templates.find(t => t.isDefault);
          if (def) {
            applyTemplate(def);
            setDefaultLoaded(true);
            toast({ title: `Loaded default template "${def.name}"` });
          }
        }
      })
      .catch(() => { /* tolerate */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch pages + pixels when ad account changes.
  useEffect(() => {
    if (!config.adAccountId) { setPages([]); setPixels([]); return; }
    let cancelled = false;
    setLoadingMeta(true);
    Promise.all([
      apiFetch<{ pages: FbPage[] }>(`/api/ads/pages?adAccountId=${encodeURIComponent(config.adAccountId)}`),
      apiFetch<{ pixels: FbPixel[] }>(`/api/ads/pixels?adAccountId=${encodeURIComponent(config.adAccountId)}`)
    ])
      .then(([p, x]) => {
        if (cancelled) return;
        setPages(p.pages || []);
        setPixels(x.pixels || []);
        if (x.pixels?.length === 1 && !config.pixelId) set('pixelId', x.pixels[0].id);
      })
      .catch(e => { if (!cancelled) toast({ title: 'Failed to load pages/pixels', description: e?.message || String(e), variant: 'destructive' }); })
      .finally(() => { if (!cancelled) setLoadingMeta(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.adAccountId]);

  // Auto-attach instagram_actor_id from the selected page when present.
  useEffect(() => {
    const page = pages.find(p => p.id === config.pageId);
    set('instagramActorId', page?.instagram_business_account?.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.pageId, pages]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const filesWithCopy = useMemo(
    () => files.filter(f => perFileCopy[f.name]).length,
    [files, perFileCopy]
  );

  const totalAds = files.length * config.adSets.length;

  const canLaunch =
    !!config.adAccountId &&
    !!config.campaignName &&
    !!config.pageId &&
    !!config.pixelId &&
    !!config.linkUrl &&
    files.length > 0 &&
    config.adSets.length > 0 &&
    (config.budgetMode === 'cbo'
      ? !!config.campaignDailyBudgetUsd && parseFloat(config.campaignDailyBudgetUsd) > 0
      : config.adSets.every(a => !!a.dailyBudget && a.dailyBudget > 0)
    ) &&
    (config.bidStrategy === 'highest_volume' || (!!config.bidAmountUsd && parseFloat(config.bidAmountUsd) > 0)) &&
    !launching;

  // ── Step actions ───────────────────────────────────────────────────────────

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep(s => Math.max(0, s - 1));

  const addAdSet = () => {
    setConfig(c => ({
      ...c,
      adSets: [...c.adSets, { name: `Ad set ${c.adSets.length + 1}`, audience: { ...DEFAULT_AUDIENCE } }]
    }));
  };
  const updateAdSet = (idx: number, next: AdSetSpec) => {
    setConfig(c => ({ ...c, adSets: c.adSets.map((a, i) => i === idx ? next : a) }));
  };
  const removeAdSet = (idx: number) => {
    setConfig(c => ({ ...c, adSets: c.adSets.filter((_, i) => i !== idx) }));
    setPerFileAdSetIndexes(m => {
      const next: Record<string, number[]> = {};
      for (const [k, arr] of Object.entries(m)) {
        const filtered = arr.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
        if (filtered.length > 0 && filtered.length !== config.adSets.length - 1) next[k] = filtered;
      }
      return next;
    });
  };

  // CSV upload
  const handleCsv = (file: File) => {
    setCsvName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { byFilename, unknownColumns, entries } = parseAdCopyCsv(String(reader.result || ''));
        setPerFileCopy(byFilename);
        setCsvUnknownCols(unknownColumns);
        toast({ title: 'CSV loaded', description: `${entries.length} ad copy ${entries.length === 1 ? 'entry' : 'entries'}${unknownColumns.length ? ` · ${unknownColumns.length} unknown column(s)` : ''}` });
        // Seed global copy from the first row if it's still empty.
        if (entries.length > 0) {
          const first = entries[0];
          setConfig(c => ({
            ...c,
            globalCopy: {
              primary_texts: c.globalCopy.primary_texts.length ? c.globalCopy.primary_texts : first.primary_texts,
              headlines: c.globalCopy.headlines.length ? c.globalCopy.headlines : first.headlines,
              descriptions: c.globalCopy.descriptions.length ? c.globalCopy.descriptions : first.descriptions
            }
          }));
        }
      } catch (e: any) {
        toast({ title: 'Invalid CSV', description: e?.message || 'Could not parse', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
  };

  const handleFileSelect = (fileList: FileList | null) => {
    if (!fileList) return;
    const valid: File[] = [];
    const rejected: string[] = [];
    Array.from(fileList).forEach(f => {
      const e = ext(f.name);
      if (!ACCEPTED.includes(e)) { rejected.push(`${f.name}: unsupported`); return; }
      if (IMAGE_EXT.includes(e) && f.size > MAX_IMAGE_SIZE) { rejected.push(`${f.name}: image > 30MB`); return; }
      if (VIDEO_EXT.includes(e) && f.size > MAX_VIDEO_SIZE) { rejected.push(`${f.name}: video > 500MB`); return; }
      valid.push(f);
    });
    if (rejected.length) toast({ title: `${rejected.length} file rejected`, description: rejected.slice(0, 3).join(', '), variant: 'destructive' });
    if (valid.length) setFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (i: number) => {
    const fname = files[i].name;
    setFiles(prev => prev.filter((_, idx) => idx !== i));
    setPerFileAdSetIndexes(m => {
      const { [fname]: _, ...rest } = m;
      return rest;
    });
  };

  // ── Template actions ───────────────────────────────────────────────────────

  const applyTemplate = (t: TemplateRow) => {
    const cfg = { ...EMPTY_WIZARD_CONFIG, ...t.config } as WizardConfig;
    // Ensure adSets is at least one entry
    if (!cfg.adSets || cfg.adSets.length === 0) cfg.adSets = [{ name: 'Ad set 1', audience: { ...DEFAULT_AUDIENCE } }];
    if (!cfg.globalCopy) cfg.globalCopy = { primary_texts: [], headlines: [], descriptions: [] };
    setConfig(cfg);
  };

  const saveAsTemplate = async () => {
    const name = templateName.trim() || config.campaignName.trim() || 'Untitled template';
    setSavingTemplate(true);
    try {
      // Persist the wizard config minus runtime/transient fields (none today).
      const { template } = await apiFetch<{ template: TemplateRow }>('/api/ads/templates', {
        method: 'POST',
        body: JSON.stringify({ name, config })
      });
      setTemplates(prev => [template, ...prev]);
      setTemplateName('');
      toast({ title: 'Template saved', description: name });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await apiFetch(`/api/ads/templates/${id}`, { method: 'DELETE' });
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: 'Template deleted' });
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message || String(e), variant: 'destructive' });
    }
  };

  // ── Launch ─────────────────────────────────────────────────────────────────

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setProgress([]);
    setResults([]);
    setSummary(null);
    setHistoryId(null);
    setCurrentIdx({ index: 0, total: totalAds });

    const fd = new FormData();
    fd.append('adAccountId', config.adAccountId);
    fd.append('campaignName', config.campaignName);
    fd.append('pageId', config.pageId);
    fd.append('pixelId', config.pixelId);
    if (config.instagramActorId) fd.append('instagramActorId', config.instagramActorId);
    fd.append('linkUrl', config.linkUrl);
    if (config.urlParams) fd.append('urlParams', config.urlParams);
    fd.append('objective', config.objective);
    fd.append('callToAction', config.callToAction);
    fd.append('status', config.status);
    if (config.startTimeIso) {
      const unix = Math.floor(new Date(config.startTimeIso).getTime() / 1000);
      if (Number.isFinite(unix) && unix > 0) fd.append('startTime', String(unix));
    }

    // Budget — translate USD → cents on the wire.
    if (config.budgetMode === 'cbo') {
      fd.append('campaignDailyBudget', String(Math.round(parseFloat(config.campaignDailyBudgetUsd) * 100)));
    }
    fd.append('bidStrategy', config.bidStrategy);
    if (config.bidStrategy !== 'highest_volume') {
      fd.append('bidAmount', String(Math.round(parseFloat(config.bidAmountUsd) * 100)));
    }

    // Ad sets
    fd.append('adSets', JSON.stringify(config.adSets));

    // Global copy
    fd.append('globalCopy', JSON.stringify(config.globalCopy));

    // Per-file copy
    if (Object.keys(perFileCopy).length > 0) {
      const map: Record<string, { primary_texts: string[]; headlines: string[]; descriptions: string[] }> = {};
      for (const [k, v] of Object.entries(perFileCopy)) {
        map[k] = { primary_texts: v.primary_texts, headlines: v.headlines, descriptions: v.descriptions };
      }
      fd.append('perFileCopy', JSON.stringify(map));
    }

    // Per-file ad-set selection
    if (Object.keys(perFileAdSetIndexes).length > 0) {
      fd.append('perFileAdSetIndexes', JSON.stringify(perFileAdSetIndexes));
    }

    files.forEach(f => fd.append('files', f));

    try {
      // We can't use apiFetch here because we need to consume the SSE
      // stream — apiFetch reads body as text. Build headers manually
      // mirroring the apiClient logic so auth still works.
      const token = localStorage.getItem('auth_token');
      const storeDomain = localStorage.getItem('active_store_domain');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (storeDomain) headers['X-Shopify-Store-Domain'] = storeDomain;

      const res = await fetch('/api/ads/bulk-launch', { method: 'POST', body: fd, headers });
      if (!res.ok || !res.body) {
        const txt = await res.text();
        toast({ title: 'Launch failed', description: txt.slice(0, 200), variant: 'destructive' });
        setLaunching(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            const ev: LaunchProgressEvent = JSON.parse(chunk.slice(6));
            setProgress(p => [...p, ev]);
            if (ev.index !== undefined && ev.total !== undefined) {
              setCurrentIdx({ index: ev.index + 1, total: ev.total });
            }
            if (ev.step === 'complete') {
              setResults(ev.results || []);
              setSummary(ev.summary || null);
              if (ev.historyId) setHistoryId(ev.historyId);
              toast({ title: 'Launch done', description: ev.message });
            }
            if (ev.step === 'history-saved' && ev.historyId) setHistoryId(ev.historyId);
            if (ev.step === 'error') {
              toast({ title: 'Launch error', description: ev.error || ev.message, variant: 'destructive' });
            }
            if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
          } catch { /* malformed event */ }
        }
      }
    } catch (e: any) {
      toast({ title: 'Launch error', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLaunching(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (adAccounts.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3 text-slate-600">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span>Bạn cần link ít nhất một Facebook ad account để dùng auto-launch. Vào tab "Assets" để link.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header strip with templates */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Rocket className="h-5 w-5 text-blue-500" />
            Auto-launch ads
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            1 campaign × N ad sets × M creatives, all PAUSED on Facebook for review.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          {templates.length > 0 && (
            <Select onValueChange={id => {
              const t = templates.find(t => t.id === id);
              if (t) { applyTemplate(t); toast({ title: `Loaded "${t.name}"` }); }
            }}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Load template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.isDefault ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="Save as…"
              className="h-8 w-40 text-xs"
              disabled={savingTemplate}
            />
            <Button variant="outline" size="sm" onClick={saveAsTemplate} disabled={savingTemplate || !config.campaignName}>
              {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span className="ml-1">Save</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Step navigation */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            disabled={launching}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors',
              i === step
                ? 'bg-blue-600 text-white border-blue-600'
                : i < step
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
          >
            <span className="font-mono text-xs">{i + 1}</span>
            {s}
            {i < step && <CheckCircle2 className="h-3.5 w-3.5" />}
          </button>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Campaign settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Ad account *</Label>
                <Select value={config.adAccountId} onValueChange={v => set('adAccountId', v)} disabled={launching}>
                  <SelectTrigger><SelectValue placeholder="Pick an account..." /></SelectTrigger>
                  <SelectContent>
                    {adAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Page * {loadingMeta && <span className="text-slate-400">(loading…)</span>}</Label>
                <Select value={config.pageId} onValueChange={v => set('pageId', v)} disabled={launching || pages.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !config.adAccountId
                        ? '— chọn ad account trước —'
                        : loadingMeta
                          ? 'Đang tải pages…'
                          : pages.length === 0
                            ? 'Không tìm thấy page — disconnect & re-Connect Facebook để cấp lại quyền'
                            : 'Pick a page...'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {pages.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}{p.instagram_business_account ? ' · IG' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {config.adAccountId && !loadingMeta && pages.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Page list rỗng — token FB Login thiếu <code className="font-mono">pages_show_list</code>.
                    Vào /facebook → Disconnect → Connect lại để cấp quyền mới.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Pixel * {loadingMeta && <span className="text-slate-400">(loading…)</span>}</Label>
                <Select value={config.pixelId} onValueChange={v => set('pixelId', v)} disabled={launching || pixels.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !config.adAccountId
                        ? '— chọn ad account trước —'
                        : loadingMeta
                          ? 'Đang tải pixels…'
                          : pixels.length === 0
                            ? 'Không có pixel trên account này — vào Ads Manager → Events Manager để tạo'
                            : 'Pick a pixel...'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {pixels.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {config.adAccountId && !loadingMeta && pixels.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Không có pixel — kiểm tra: (1) ad account đã liên kết pixel chưa
                    (Ads Manager → Pixels), (2) user là Advertiser trên BM owning the pixel.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Campaign name *</Label>
                <Input value={config.campaignName} onChange={e => set('campaignName', e.target.value)} placeholder="e.g. Caryona — May test" disabled={launching} />
              </div>
              <div>
                <Label className="text-xs">Landing URL *</Label>
                <Input value={config.linkUrl} onChange={e => set('linkUrl', e.target.value)} placeholder="https://yourstore.com/products/…" disabled={launching} />
              </div>
              <div>
                <Label className="text-xs">URL params (optional)</Label>
                <Input value={config.urlParams} onChange={e => set('urlParams', e.target.value)} placeholder="utm_source=fb&utm_campaign=may" disabled={launching} />
              </div>
              <div>
                <Label className="text-xs">Objective</Label>
                <Select value={config.objective} onValueChange={v => set('objective', v)} disabled={launching}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OBJECTIVES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Budget mode</Label>
                <Select value={config.budgetMode} onValueChange={(v: 'cbo' | 'abo') => set('budgetMode', v)} disabled={launching}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cbo">CBO — campaign budget</SelectItem>
                    <SelectItem value="abo">ABO — ad-set budget</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {config.budgetMode === 'cbo' && (
                <div>
                  <Label className="text-xs">Daily budget (USD) *</Label>
                  <Input type="number" step="1" min="1" value={config.campaignDailyBudgetUsd} onChange={e => set('campaignDailyBudgetUsd', e.target.value)} disabled={launching} />
                </div>
              )}
              <div>
                <Label className="text-xs">Bid strategy</Label>
                <Select value={config.bidStrategy} onValueChange={(v: any) => set('bidStrategy', v)} disabled={launching}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="highest_volume">Highest volume (no cap)</SelectItem>
                    <SelectItem value="bid_cap">Bid cap</SelectItem>
                    <SelectItem value="cost_cap">Cost cap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {config.bidStrategy !== 'highest_volume' && (
                <div>
                  <Label className="text-xs">{config.bidStrategy === 'bid_cap' ? 'Max bid (USD)' : 'Cost cap (USD)'} *</Label>
                  <Input type="number" step="0.5" min="0.01" value={config.bidAmountUsd} onChange={e => set('bidAmountUsd', e.target.value)} disabled={launching} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Call to action</Label>
                <Select value={config.callToAction} onValueChange={v => set('callToAction', v)} disabled={launching}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CTA_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Start time (local)</Label>
                <Input
                  type="datetime-local"
                  value={config.startTimeIso || ''}
                  onChange={e => set('startTimeIso', e.target.value || undefined)}
                  disabled={launching}
                />
                <div className="text-[11px] text-slate-400 mt-0.5">Default: next UTC midnight.</div>
              </div>
              <div>
                <Label className="text-xs">Launch status</Label>
                <Select value={config.status} onValueChange={(v: 'ACTIVE' | 'PAUSED') => set('status', v)} disabled={launching}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAUSED">PAUSED (review in Ads Manager) — recommended</SelectItem>
                    <SelectItem value="ACTIVE">ACTIVE (live immediately) — caution!</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">{config.adSets.length} ad set(s) · each gets every creative below (unless overridden)</div>
            <Button variant="outline" size="sm" onClick={addAdSet} disabled={launching}><Plus className="h-3.5 w-3.5 mr-1" /> Add ad set</Button>
          </div>
          {config.adSets.map((spec, idx) => (
            <AdSetEditor
              key={idx}
              index={idx}
              total={config.adSets.length}
              adAccountId={config.adAccountId}
              budgetMode={config.budgetMode}
              spec={spec}
              onChange={next => updateAdSet(idx, next)}
              onRemove={() => removeAdSet(idx)}
              disabled={launching}
            />
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Global copy */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Global ad copy (fallback for files not in CSV)</span>
                <span className="text-xs font-normal text-slate-500">Up to 5 of each — FB multi-text optimization.</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['primary_texts', 'headlines', 'descriptions'] as const).map(slot => (
                <div key={slot}>
                  <Label className="text-xs capitalize">{slot.replace('_', ' ')}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                    {[0, 1, 2, 3, 4].map(i => (
                      <Input
                        key={i}
                        value={config.globalCopy[slot][i] || ''}
                        onChange={e => {
                          const next = { ...config.globalCopy };
                          const arr = [...next[slot]];
                          arr[i] = e.target.value;
                          // Trim trailing empties so the API doesn't see ghosts.
                          while (arr.length && !arr[arr.length - 1]) arr.pop();
                          next[slot] = arr;
                          set('globalCopy', next);
                        }}
                        placeholder={`${slot.slice(0, -1)} ${i + 1}`}
                        disabled={launching}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* CSV upload */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-500" />Per-file copy (CSV)</span>
                <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate()} disabled={launching}>Download template</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = ''; }}
                />
                <Button variant="outline" onClick={() => csvInputRef.current?.click()} disabled={launching}>
                  <Upload className="h-4 w-4 mr-2" /> Upload CSV
                </Button>
                {csvName && (
                  <span className="text-sm text-slate-600">{csvName} · {Object.keys(perFileCopy).length} entries</span>
                )}
                {Object.keys(perFileCopy).length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => { setPerFileCopy({}); setCsvName(''); setCsvUnknownCols([]); }} disabled={launching}>Clear</Button>
                )}
              </div>
              {csvUnknownCols.length > 0 && (
                <div className="text-xs text-amber-600 bg-amber-50 rounded p-2 border border-amber-200">
                  Unknown columns ignored: {csvUnknownCols.join(', ')}
                </div>
              )}
              <div className="text-xs text-slate-500">
                Required column: <code>filename</code>. Optional per-row: <code>primary_text_1..5</code>, <code>headline_1..5</code>, <code>description_1..5</code>.
              </div>
            </CardContent>
          </Card>

          {/* Files */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Creative files</span>
                <span className="text-xs font-normal text-slate-500">{files.length} file(s) · {filesWithCopy} in CSV</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED.join(',')}
                className="hidden"
                onChange={e => { handleFileSelect(e.target.files); e.target.value = ''; }}
              />
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:bg-slate-50 border-slate-300"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
              >
                <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-blue-600">Click to upload</span> or drag images / videos here
                </p>
                <p className="text-xs text-slate-400 mt-1">JPG / PNG / WebP / GIF (max 30 MB) · MP4 / MOV (max 500 MB)</p>
              </div>
              {files.length > 0 && (
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {files.map((f, i) => {
                    const matched = !!perFileCopy[f.name];
                    const selectedIdxs = perFileAdSetIndexes[f.name];
                    return (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 p-2 border rounded-md bg-white">
                        {isImage(f.name) ? <ImageIcon className="h-4 w-4 text-slate-400" /> : <Film className="h-4 w-4 text-slate-400" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-xs text-slate-500">{formatSize(f.size)}</div>
                        </div>
                        {matched
                          ? <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">CSV ✓</Badge>
                          : <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200">global</Badge>}
                        {config.adSets.length > 1 && (
                          <div className="flex flex-wrap gap-0.5 max-w-xs">
                            {config.adSets.map((as, asi) => {
                              const picked = !selectedIdxs || selectedIdxs.includes(asi);
                              return (
                                <button
                                  key={asi}
                                  type="button"
                                  disabled={launching}
                                  onClick={() => {
                                    const next = { ...perFileAdSetIndexes };
                                    const cur = next[f.name] || config.adSets.map((_, i) => i);
                                    const flipped = cur.includes(asi) ? cur.filter(x => x !== asi) : [...cur, asi];
                                    if (flipped.length === config.adSets.length) delete next[f.name];
                                    else next[f.name] = flipped;
                                    setPerFileAdSetIndexes(next);
                                  }}
                                  className={cn(
                                    'text-[10px] px-1.5 py-0.5 rounded border',
                                    picked
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : 'bg-white text-slate-400 border-slate-200'
                                  )}
                                  title={as.name}
                                >
                                  AS{asi + 1}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeFile(i)} disabled={launching}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Review & launch</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <SummaryCell label="Ad account" value={adAccounts.find(a => a.id === config.adAccountId)?.name || config.adAccountId} />
              <SummaryCell label="Page" value={pages.find(p => p.id === config.pageId)?.name || config.pageId} />
              <SummaryCell label="Pixel" value={pixels.find(p => p.id === config.pixelId)?.name || config.pixelId} />
              <SummaryCell label="Status" value={config.status} accent={config.status === 'ACTIVE' ? 'rose' : 'emerald'} />
              <SummaryCell label="Budget" value={config.budgetMode === 'cbo' ? `CBO $${config.campaignDailyBudgetUsd}/day` : 'ABO (per ad set)'} />
              <SummaryCell label="Bid" value={config.bidStrategy === 'highest_volume' ? 'Highest volume' : `${config.bidStrategy === 'bid_cap' ? 'Bid cap' : 'Cost cap'} $${config.bidAmountUsd}`} />
              <SummaryCell label="Ad sets" value={String(config.adSets.length)} />
              <SummaryCell label="Files × ad sets" value={`${files.length} × ${config.adSets.length} = ${totalAds} ads`} />
            </div>
            <div className="text-xs text-slate-500 border-t pt-3">
              All ads will land <strong>{config.status}</strong> on Facebook. {config.status === 'PAUSED' && 'Review in Ads Manager before turning anything on.'}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleLaunch}
                disabled={!canLaunch}
                size="lg"
                className="bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 text-white shadow-md"
              >
                <Rocket className="h-5 w-5 mr-2" />
                {launching ? 'Launching…' : `Launch ${totalAds} ${totalAds === 1 ? 'ad' : 'ads'}`}
              </Button>
              {!canLaunch && !launching && (
                <span className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Fill all required fields in previous steps.
                </span>
              )}
              {historyId && (
                <span className="text-xs text-slate-500 flex items-center gap-1 ml-auto">
                  <ListChecks className="h-3.5 w-3.5" />
                  Saved to history: <code>{historyId.slice(0, 8)}…</code>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step nav (prev/next at bottom) */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={prev} disabled={step === 0 || launching}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button variant="outline" onClick={next} disabled={step === STEPS.length - 1 || launching}>
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Live progress */}
      {(launching || progress.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Progress</span>
              {summary && (
                <span className="text-xs font-normal">
                  <span className="text-emerald-600">{summary.success} ok</span>
                  {summary.failed > 0 && <span className="text-rose-600 ml-2">· {summary.failed} failed</span>}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {launching && currentIdx.total > 0 && (
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{currentIdx.index} / {currentIdx.total}</span>
                  <span>{Math.round((currentIdx.index / currentIdx.total) * 100)}%</span>
                </div>
                <Progress value={(currentIdx.index / currentIdx.total) * 100} />
              </div>
            )}
            <div ref={progressRef} className="bg-slate-50 rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
              {progress.map((ev, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-2',
                  ev.status === 'failed' && 'text-rose-600',
                  ev.status === 'done' && ev.step === 'complete' && 'text-emerald-700 font-semibold',
                  ev.step === 'video-wait' && 'text-amber-600'
                )}>
                  <span className="text-slate-400 shrink-0">[{ev.step}]</span>
                  <span>{ev.message}</span>
                </div>
              ))}
            </div>
            {results.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded border text-sm">
                    {r.status === 'success'
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <XCircle className="h-4 w-4 text-rose-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.filename}</div>
                      {r.adId && <div className="text-xs text-slate-500">Ad: <code>{r.adId}</code></div>}
                      {r.error && <div className="text-xs text-rose-500 truncate" title={r.error}>{r.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Template management — collapsed by default */}
      {templates.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-700">Manage saved templates ({templates.length})</summary>
          <div className="mt-2 space-y-1">
            {templates.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-xs p-1.5 border rounded bg-white">
                <span className="flex-1 truncate">
                  {t.name}{t.isDefault ? ' · default' : ''}
                </span>
                <span className="text-slate-400">{new Date(t.updatedAt).toLocaleDateString()}</span>
                <Button variant="ghost" size="sm" className="h-6 text-rose-500" onClick={() => deleteTemplate(t.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

function SummaryCell({ label, value, accent }: { label: string; value: string; accent?: 'rose' | 'emerald' }) {
  const color = accent === 'rose' ? 'text-rose-700' : accent === 'emerald' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="rounded-md border bg-white p-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm font-medium ${color} truncate`} title={value}>{value || '—'}</div>
    </div>
  );
}

function downloadCsvTemplate() {
  const header = 'filename,primary_text_1,primary_text_2,headline_1,headline_2,description_1,description_2';
  const sample = '161.png,"Two-line copy here","Alt copy","Bold headline","Alt headline","Short desc","Alt desc"';
  const blob = new Blob([header + '\n' + sample + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ad-copy-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
