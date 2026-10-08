import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, FileImage, FileVideo, Loader2, RotateCcw, UploadCloud, X
} from 'lucide-react';
import { LIMITS, creativeCopySchema, creativeName, creatorDisplayName, type ProductOption } from '@contract/ads-launcher';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ACCEPT_ATTR, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, formatBytes } from '../lib/media-prep';
import { normalizeAngle } from '../lib/library';
import { isBusy, type UploadItem, type UploadMeta, type UploadQueue } from '../hooks/use-upload-queue';
import { ProductPicker } from './ProductPicker';

interface UploadCreativesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductOption[] | undefined;
  productsLoading?: boolean;
  /** Pre-selected product (the library's product filter). */
  defaultProductId: string | null;
  queue: UploadQueue;
}

const STATUS_LABEL: Record<UploadItem['status'], string> = {
  queued: 'Queued',
  processing: 'Processing…',
  uploading: 'Uploading…',
  done: 'Uploaded',
  error: 'Failed'
};

function StatusIcon({ item }: { item: UploadItem }) {
  switch (item.status) {
    case 'done': return <CheckCircle2 className="h-4 w-4 text-teal-600" />;
    case 'error': return <AlertCircle className="h-4 w-4 text-rose-600" />;
    case 'queued': return <Clock className="h-4 w-4 text-slate-400" />;
    default: return <Loader2 className="h-4 w-4 animate-spin text-teal-600" />;
  }
}

export function UploadCreativesDialog({ open, onOpenChange, products, productsLoading, defaultProductId, queue }: UploadCreativesDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [productId, setProductId] = useState<string | null>(defaultProductId);
  const [productCode, setProductCode] = useState('');
  const [angle, setAngle] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const { items, running, counts } = queue;

  // Opening fresh (nothing pending / failed) starts a new batch on the library's product.
  useEffect(() => {
    if (!open) return;
    if (!queue.running && counts.pending === 0 && counts.failed === 0) {
      queue.reset();
      setTouched(false);
      if (defaultProductId) {
        setProductId(defaultProductId);
        setProductCode(products?.find(p => p.id === defaultProductId)?.code ?? '');
      }
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Products may arrive after the product was picked: prefill its code once.
  useEffect(() => {
    if (productId && !productCode) setProductCode(products?.find(p => p.id === productId)?.code ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const product = products?.find(p => p.id === productId) ?? null;
  const creator = user ? creatorDisplayName(user) : 'Unknown';
  const namePreview = creativeName(creator, angle.trim() || 'Angle', productCode, new Date());

  const parsed = creativeCopySchema.safeParse({ angle, primaryText, headline, description });
  const fieldError = (field: string) =>
    !parsed.success ? parsed.error.issues.find(i => i.path[0] === field)?.message : undefined;
  const angleError = touched ? fieldError('angle') : undefined;
  const productError = touched && !productId ? 'Pick the product these creatives sell' : undefined;
  const pending = counts.pending;
  const queued = items.filter(i => i.status === 'queued').length;
  const left = items.filter(i => i.status === 'queued' || isBusy(i)).length;

  const pickProduct = (id: string | null) => {
    setProductId(id);
    setProductCode(products?.find(p => p.id === id)?.code ?? '');
  };

  const addFiles = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length) queue.add(files);
  };

  const meta = (): UploadMeta | null => {
    setTouched(true);
    if (!productId || !parsed.success) return null;
    return { productId, productCode, angle: parsed.data.angle, primaryText, headline, description };
  };

  const start = async (onlyIds?: string[]) => {
    const m = meta();
    if (!m) return;
    const { ok, failed } = await queue.run(m, onlyIds);
    if (ok + failed === 0) return;
    toast({
      title: failed ? `${ok} uploaded, ${failed} failed` : `${ok} creative${ok === 1 ? '' : 's'} uploaded`,
      description: failed ? 'Fix the problem and press Retry on the failed files.' : undefined,
      variant: failed && !ok ? 'destructive' : undefined
    });
  };

  const locked = running;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b px-4 py-3 sm:px-6">
          <DialogTitle>Upload creatives</DialogTitle>
          <DialogDescription>
            Each file becomes one creative with the copy below. Images up to {formatBytes(MAX_IMAGE_BYTES)}, videos up to {formatBytes(MAX_VIDEO_BYTES)}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left: fields */}
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="upload-product">Product <span className="text-rose-500">*</span></Label>
                  <ProductPicker
                    id="upload-product"
                    products={products}
                    loading={productsLoading}
                    value={productId}
                    onChange={pickProduct}
                    disabled={locked}
                    modal
                  />
                  {productError && <p className="text-xs text-rose-600">{productError}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="upload-code">Product code</Label>
                  <Input
                    id="upload-code"
                    value={productCode}
                    onChange={e => setProductCode(e.target.value.replace(/\|/g, '/'))}
                    maxLength={64}
                    placeholder={product?.code || 'CODE'}
                    disabled={locked}
                    className="h-9 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="rounded-md border border-teal-100 bg-teal-50/60 px-2.5 py-1.5">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-teal-700">Creative name</div>
                  <div className="break-words text-xs font-medium text-slate-800">{namePreview}</div>
                </div>
                <Label htmlFor="upload-angle">Angle <span className="text-rose-500">*</span></Label>
                <Input
                  id="upload-angle"
                  value={angle}
                  onChange={e => setAngle(normalizeAngle(e.target.value))}
                  onBlur={() => angle && setTouched(true)}
                  maxLength={255}
                  placeholder="e.g. Dead corner fix"
                  disabled={locked}
                  aria-invalid={!!angleError}
                />
                {angleError && <p className="text-xs text-rose-600">{angleError}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="upload-primary">Primary text</Label>
                <Textarea
                  id="upload-primary"
                  value={primaryText}
                  onChange={e => setPrimaryText(e.target.value)}
                  maxLength={LIMITS.primaryTextLength}
                  rows={4}
                  disabled={locked}
                  className="resize-y"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="upload-headline">Headline</Label>
                  <Input id="upload-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={LIMITS.headlineLength} disabled={locked} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="upload-description">Description</Label>
                  <Input id="upload-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={LIMITS.descriptionLength} disabled={locked} />
                </div>
              </div>
            </div>

            {/* Right: files */}
            <div className="flex min-w-0 flex-col gap-2">
              <Label>Files</Label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInput.current?.click();
                  }
                }}
                onDragOver={e => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50'
                )}
              >
                <UploadCloud className="h-7 w-7 text-teal-600" />
                <div className="text-sm font-medium text-slate-800">Drop files here or click to choose</div>
                <div className="text-xs text-slate-500">JPEG, PNG, GIF, WebP, HEIC · MP4, MOV, WebM, M4V</div>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={e => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {items.length > 0 && (
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {counts.total} file{counts.total === 1 ? '' : 's'} · {counts.done} uploaded
                    {counts.failed > 0 && <span className="text-rose-600"> · {counts.failed} failed</span>}
                  </span>
                  {counts.done > 0 && !running && (
                    <button type="button" className="underline hover:text-slate-700" onClick={queue.clearFinished}>Clear uploaded</button>
                  )}
                </div>
              )}

              <ul className="max-h-72 space-y-1.5 overflow-y-auto md:max-h-[22rem]">
                {items.map(item => (
                  <li
                    key={item.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2 py-1.5',
                      item.status === 'error' ? 'border-rose-200 bg-rose-50/50' : item.status === 'done' ? 'border-teal-100 bg-teal-50/40' : 'border-slate-200'
                    )}
                  >
                    <span className="mt-0.5 shrink-0 text-slate-400">
                      {item.kind === 'video' ? <FileVideo className="h-4 w-4" /> : <FileImage className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800" title={item.file.name}>{item.file.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatBytes(item.file.size)} · {STATUS_LABEL[item.status]}
                        {item.note && item.status !== 'error' && <> · {item.note}</>}
                      </div>
                      {item.error && <div className="break-words text-[11px] text-rose-600">{item.error}</div>}
                    </div>
                    <span className="mt-0.5 shrink-0"><StatusIcon item={item} /></span>
                    {item.status === 'error' && item.retryable && !running && (
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => void start([item.id])}>
                        <RotateCcw className="mr-1 h-3 w-3" /> Retry
                      </Button>
                    )}
                    {!isBusy(item) && item.status !== 'done' && (
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"
                        onClick={() => queue.remove(item.id)}
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {running ? 'Hide (keeps uploading)' : 'Close'}
          </Button>
          <Button onClick={() => void start()} disabled={running || pending === 0} className="bg-teal-600 hover:bg-teal-700">
            {running ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Uploading… {left} left</>
            ) : queued === 0 && pending > 0 ? (
              <><RotateCcw className="mr-1.5 h-4 w-4" /> Retry failed ({pending})</>
            ) : (
              <><UploadCloud className="mr-1.5 h-4 w-4" /> Upload{pending > 0 ? ` ${pending} file${pending === 1 ? '' : 's'}` : ''}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
