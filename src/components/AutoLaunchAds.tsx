import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/context/AppContext';
import { parseAdCopyCsv, AdCopyEntry } from '@/utils/adCopyCsv';
import { Upload, FileSpreadsheet, Rocket, AlertTriangle, CheckCircle2, XCircle, Trash2, Image as ImageIcon, Film } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FbPage { id: string; name: string; instagram_business_account?: { id: string } }
interface FbPixel { id: string; name: string }

interface UploadResult { filename: string; status: string; adId?: string; error?: string }
interface ProgressEvent {
  step: 'campaign' | 'adset' | 'upload' | 'complete' | 'error';
  status: string;
  message: string;
  index?: number;
  total?: number;
  filename?: string;
  id?: string;
  adId?: string;
  campaignId?: string;
  results?: UploadResult[];
  summary?: { total: number; success: number; failed: number };
  error?: string;
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const VIDEO_EXT = ['.mp4', '.mov', '.avi'];
const ACCEPTED = [...IMAGE_EXT, ...VIDEO_EXT];

const MAX_IMAGE_SIZE = 30 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

const formatSize = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
const ext = (name: string) => '.' + (name.split('.').pop() || '').toLowerCase();
const isImage = (name: string) => IMAGE_EXT.includes(ext(name));

interface AutoLaunchAdsProps {
  /** Ad accounts the merchant has linked. Comes from FacebookPage parent. */
  adAccounts: Array<{ id: string; name: string }>;
}

export const AutoLaunchAds = ({ adAccounts }: AutoLaunchAdsProps) => {
  const { shopifyConfig } = useAppContext();
  const { toast } = useToast();

  // Connection-dependent fetched data
  const [pages, setPages] = useState<FbPage[]>([]);
  const [pixels, setPixels] = useState<FbPixel[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Form state
  const [adAccountId, setAdAccountId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [urlParams, setUrlParams] = useState('');
  const [dailyBudget, setDailyBudget] = useState('50');
  const [bidStrategy, setBidStrategy] = useState<'bid_cap' | 'cost_cap' | 'highest_volume'>('bid_cap');
  const [bidAmount, setBidAmount] = useState('10');
  const [callToAction, setCallToAction] = useState('SHOP_NOW');
  const [countries, setCountries] = useState('US,GB,CA,AU');

  // Global ad copy fallback
  const [primaryText1, setPrimaryText1] = useState('');
  const [primaryText2, setPrimaryText2] = useState('');
  const [headline1, setHeadline1] = useState('');
  const [headline2, setHeadline2] = useState('');
  const [description1, setDescription1] = useState('');
  const [description2, setDescription2] = useState('');

  // Files + per-file copy from CSV
  const [files, setFiles] = useState<File[]>([]);
  const [csvName, setCsvName] = useState('');
  const [csvUnknownCols, setCsvUnknownCols] = useState<string[]>([]);
  const [perFileCopy, setPerFileCopy] = useState<Record<string, AdCopyEntry>>({});

  // Launch state
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [currentIdx, setCurrentIdx] = useState({ index: 0, total: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const headers = useCallback(() => {
    if (!shopifyConfig) return {};
    return {
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    } as Record<string, string>;
  }, [shopifyConfig]);

  // Fetch pages + pixels when ad account is picked
  useEffect(() => {
    if (!adAccountId || !shopifyConfig) {
      setPages([]); setPixels([]); return;
    }
    let cancelled = false;
    setLoadingMeta(true);
    (async () => {
      try {
        const [pRes, xRes] = await Promise.all([
          fetch(`/api/ads/pages?adAccountId=${encodeURIComponent(adAccountId)}`, { headers: headers() }),
          fetch(`/api/ads/pixels?adAccountId=${encodeURIComponent(adAccountId)}`, { headers: headers() })
        ]);
        if (cancelled) return;
        if (pRes.ok) {
          const { pages } = await pRes.json();
          setPages(pages || []);
        }
        if (xRes.ok) {
          const { pixels } = await xRes.json();
          setPixels(pixels || []);
          // Auto-select if there's only one
          if (pixels?.length === 1) setPixelId(pixels[0].id);
        }
      } catch (e: any) {
        if (!cancelled) toast({ title: 'Lỗi load pages/pixels', description: e?.message || String(e), variant: 'destructive' });
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adAccountId, shopifyConfig, headers, toast]);

  // CSV upload
  const handleCsv = (file: File) => {
    setCsvName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { byFilename, unknownColumns, entries } = parseAdCopyCsv(String(reader.result || ''));
        setPerFileCopy(byFilename);
        setCsvUnknownCols(unknownColumns);
        toast({
          title: 'CSV loaded',
          description: `${entries.length} ad copy ${entries.length === 1 ? 'entry' : 'entries'}${unknownColumns.length ? ` · ${unknownColumns.length} unknown column(s)` : ''}`
        });
        // Convenience: if global copy is empty, seed it from the first row
        if (entries.length > 0) {
          const first = entries[0];
          if (first.primary_texts[0] && !primaryText1) setPrimaryText1(first.primary_texts[0]);
          if (first.primary_texts[1] && !primaryText2) setPrimaryText2(first.primary_texts[1]);
          if (first.headlines[0] && !headline1) setHeadline1(first.headlines[0]);
          if (first.headlines[1] && !headline2) setHeadline2(first.headlines[1]);
          if (first.descriptions[0] && !description1) setDescription1(first.descriptions[0]);
          if (first.descriptions[1] && !description2) setDescription2(first.descriptions[1]);
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

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const filesWithCopy = useMemo(
    () => files.filter(f => perFileCopy[f.name]).length,
    [files, perFileCopy]
  );

  const canLaunch = !!adAccountId && !!campaignName && !!pageId && !!pixelId && !!linkUrl && files.length > 0 && !launching;

  const handleLaunch = async () => {
    if (!canLaunch || !shopifyConfig) return;
    setLaunching(true);
    setProgress([]);
    setResults([]);
    setSummary(null);
    setCurrentIdx({ index: 0, total: files.length });

    const fd = new FormData();
    fd.append('adAccountId', adAccountId);
    fd.append('campaignName', campaignName);
    fd.append('pageId', pageId);
    fd.append('pixelId', pixelId);
    const page = pages.find(p => p.id === pageId);
    if (page?.instagram_business_account?.id) fd.append('instagramActorId', page.instagram_business_account.id);
    fd.append('linkUrl', linkUrl);
    if (urlParams) fd.append('urlParams', urlParams);
    // Convert dollars → cents on the wire
    fd.append('dailyBudget', String(Math.round(parseFloat(dailyBudget) * 100)));
    fd.append('bidStrategy', bidStrategy);
    fd.append('bidAmount', String(Math.round(parseFloat(bidAmount) * 100)));
    fd.append('callToAction', callToAction);
    if (countries) fd.append('countries', countries);

    // Global fallback ad copy
    const globalCopy = {
      primary_texts: [primaryText1, primaryText2].filter(Boolean),
      headlines: [headline1, headline2].filter(Boolean),
      descriptions: [description1, description2].filter(Boolean)
    };
    fd.append('globalCopy', JSON.stringify(globalCopy));

    if (Object.keys(perFileCopy).length > 0) {
      // Strip filename key from values to keep payload tight
      const map: Record<string, { primary_texts: string[]; headlines: string[]; descriptions: string[] }> = {};
      for (const [k, v] of Object.entries(perFileCopy)) {
        map[k] = { primary_texts: v.primary_texts, headlines: v.headlines, descriptions: v.descriptions };
      }
      fd.append('perFileCopy', JSON.stringify(map));
    }

    files.forEach(f => fd.append('files', f));

    try {
      const res = await fetch('/api/ads/bulk-launch', { method: 'POST', body: fd, headers: headers() });
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
            const ev: ProgressEvent = JSON.parse(chunk.slice(6));
            setProgress(p => [...p, ev]);
            if (ev.index !== undefined && ev.total !== undefined) {
              setCurrentIdx({ index: ev.index + 1, total: ev.total });
            }
            if (ev.step === 'complete' && ev.results) {
              setResults(ev.results);
              setSummary(ev.summary || null);
              toast({ title: 'Done', description: ev.message });
            }
            if (ev.step === 'error') {
              toast({ title: 'Launch error', description: ev.error || ev.message, variant: 'destructive' });
            }
            if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
          } catch { /* malformed event — skip */ }
        }
      }
    } catch (e: any) {
      toast({ title: 'Launch error', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setLaunching(false);
    }
  };

  const downloadCsvTemplate = () => {
    const header = 'filename,primary_text_1,primary_text_2,headline_1,headline_2,description_1,description_2';
    const sample = '161.png,"Two-line copy here","Alt copy","Bold headline","Alt headline","Short desc","Alt desc"';
    const blob = new Blob([header + '\n' + sample + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ad-copy-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const overallPct = currentIdx.total > 0 ? (currentIdx.index / currentIdx.total) * 100 : 0;

  if (adAccounts.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3 text-slate-600">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span>Bạn cần link ít nhất một Facebook ad account để dùng auto-launch. Vào tab "Ad Accounts" để link.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Rocket className="h-5 w-5 text-blue-500" />
            Auto-launch ads
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Tạo SALES campaign (CBO) + 1 ad set (Conversion / Purchase) + N ads từ media files. Tất cả ads tạo ra ở trạng thái <strong>PAUSED</strong> — bạn vào Ads Manager kiểm tra trước khi bật.
          </p>
        </div>
      </div>

      {/* Campaign settings */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Campaign settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Ad account *</Label>
              <Select value={adAccountId} onValueChange={setAdAccountId} disabled={launching}>
                <SelectTrigger><SelectValue placeholder="Pick an account..." /></SelectTrigger>
                <SelectContent>
                  {adAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Page * {loadingMeta && <span className="text-slate-400">(loading…)</span>}</Label>
              <Select value={pageId} onValueChange={setPageId} disabled={launching || pages.length === 0}>
                <SelectTrigger><SelectValue placeholder={pages.length === 0 ? '— pick account first —' : 'Pick a page...'} /></SelectTrigger>
                <SelectContent>
                  {pages.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.instagram_business_account ? ' · IG' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Pixel * {loadingMeta && <span className="text-slate-400">(loading…)</span>}</Label>
              <Select value={pixelId} onValueChange={setPixelId} disabled={launching || pixels.length === 0}>
                <SelectTrigger><SelectValue placeholder={pixels.length === 0 ? '— pick account first —' : 'Pick a pixel...'} /></SelectTrigger>
                <SelectContent>
                  {pixels.map(x => (
                    <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Campaign name *</Label>
              <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. Caryona - May Test" disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Landing URL *</Label>
              <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://yourstore.com/products/..." disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">URL params (optional)</Label>
              <Input value={urlParams} onChange={e => setUrlParams(e.target.value)} placeholder="utm_source=fb&utm_campaign=may" disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Countries (CSV)</Label>
              <Input value={countries} onChange={e => setCountries(e.target.value)} placeholder="US,GB,CA,AU" disabled={launching} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Daily budget (USD) *</Label>
              <Input type="number" step="1" value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Bid strategy</Label>
              <Select value={bidStrategy} onValueChange={(v: any) => setBidStrategy(v)} disabled={launching}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bid_cap">Bid cap</SelectItem>
                  <SelectItem value="cost_cap">Cost cap</SelectItem>
                  <SelectItem value="highest_volume">Highest volume</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bid amount (USD)</Label>
              <Input type="number" step="0.5" value={bidAmount} onChange={e => setBidAmount(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Call to action</Label>
              <Select value={callToAction} onValueChange={setCallToAction} disabled={launching}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SHOP_NOW">Shop now</SelectItem>
                  <SelectItem value="LEARN_MORE">Learn more</SelectItem>
                  <SelectItem value="GET_OFFER">Get offer</SelectItem>
                  <SelectItem value="ORDER_NOW">Order now</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Global ad copy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Global ad copy (fallback)</span>
            <span className="text-xs font-normal text-slate-500">Used when CSV doesn't include a row for a file.</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Primary text 1</Label>
              <Input value={primaryText1} onChange={e => setPrimaryText1(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Primary text 2</Label>
              <Input value={primaryText2} onChange={e => setPrimaryText2(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Headline 1</Label>
              <Input value={headline1} onChange={e => setHeadline1(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Headline 2</Label>
              <Input value={headline2} onChange={e => setHeadline2(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Description 1</Label>
              <Input value={description1} onChange={e => setDescription1(e.target.value)} disabled={launching} />
            </div>
            <div>
              <Label className="text-xs">Description 2</Label>
              <Input value={description2} onChange={e => setDescription2(e.target.value)} disabled={launching} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSV ad copy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-500" />Ad copy CSV (per-file)</span>
            <Button variant="ghost" size="sm" onClick={downloadCsvTemplate} disabled={launching}>Download template</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = ''; }}
            />
            <Button variant="outline" onClick={() => csvInputRef.current?.click()} disabled={launching}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            {csvName && (
              <span className="text-sm text-slate-600">
                {csvName} · {Object.keys(perFileCopy).length} entries
              </span>
            )}
            {Object.keys(perFileCopy).length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setPerFileCopy({}); setCsvName(''); setCsvUnknownCols([]); }} disabled={launching}>
                Clear
              </Button>
            )}
          </div>
          {csvUnknownCols.length > 0 && (
            <div className="text-xs text-amber-600 bg-amber-50 rounded p-2 border border-amber-200">
              Unknown columns ignored: {csvUnknownCols.join(', ')}
            </div>
          )}
          <div className="text-xs text-slate-500">
            Required column: <code>filename</code>. Optional per-row: <code>primary_text_1..5</code>, <code>headline_1..5</code>, <code>description_1..5</code>. CSV cells can hold multi-line text inside quotes.
          </div>
        </CardContent>
      </Card>

      {/* Files */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Creative files</span>
            <span className="text-xs font-normal text-slate-500">{files.length} file(s) · {filesWithCopy} matched in CSV</span>
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
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
              "hover:bg-slate-50 border-slate-300"
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
          >
            <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
            <p className="text-sm text-slate-600">
              <span className="font-medium text-blue-600">Click to upload</span> or drag images / videos here
            </p>
            <p className="text-xs text-slate-400 mt-1">
              JPG / PNG / WebP / GIF (max 30 MB) · MP4 / MOV (max 500 MB)
            </p>
          </div>
          {files.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
              {files.map((f, i) => {
                const matched = !!perFileCopy[f.name];
                return (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-2 p-2 border rounded-md bg-white">
                    {isImage(f.name) ? <ImageIcon className="h-4 w-4 text-slate-400" /> : <Film className="h-4 w-4 text-slate-400" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-xs text-slate-500">{formatSize(f.size)}</div>
                    </div>
                    {matched ? (
                      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">CSV ✓</Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200">global</Badge>
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

      {/* Launch button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleLaunch}
          disabled={!canLaunch}
          size="lg"
          className="bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 text-white shadow-md shadow-blue-500/30"
        >
          <Rocket className="h-5 w-5 mr-2" />
          {launching ? 'Launching…' : `Launch ${files.length} ${files.length === 1 ? 'ad' : 'ads'} (PAUSED)`}
        </Button>
        {!canLaunch && !launching && files.length > 0 && (
          <span className="text-xs text-slate-500">Fill all required fields above first.</span>
        )}
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
                  <span>{Math.round(overallPct)}%</span>
                </div>
                <Progress value={overallPct} />
              </div>
            )}
            <div ref={progressRef} className="bg-slate-50 rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
              {progress.map((ev, i) => (
                <div key={i} className={cn(
                  "flex items-start gap-2",
                  ev.status === 'failed' && 'text-rose-600',
                  ev.status === 'done' && ev.step === 'complete' && 'text-emerald-700 font-semibold'
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
    </div>
  );
};
