import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, Loader2, Pencil } from 'lucide-react';
import type { CreativeDto } from '@contract/ads-launcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePosts } from '@/features/ads-launcher/hooks/queries';
import { errorMessage } from '../lib/library';
import { CopyButton, PostIdActions } from './PostIdActions';
import { MediaThumb } from './MediaThumb';

interface CreativeDetailsDialogProps {
  creative: CreativeDto | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onEdit: (c: CreativeDto) => void;
}

const fmtDate = (iso: string | null | undefined, pattern = 'MMM d, yyyy') => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, pattern);
};

function CopyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {value && <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />}
      </div>
      {value ? (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{value}</p>
      ) : (
        <p className="text-sm italic text-slate-400">Empty</p>
      )}
    </div>
  );
}

function CreativePosts({ creativeId }: { creativeId: string }) {
  const posts = usePosts({ creativeId, source: 'all', range: 'lifetime', sort: 'recent', pageSize: 50 });
  const items = posts.data?.items ?? [];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Posts</h3>
        {posts.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
      </div>
      {posts.isLoading ? (
        <div className="space-y-1.5">
          {[0, 1].map(i => <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />)}
        </div>
      ) : posts.isError ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Could not load posts: {errorMessage(posts.error)}</span>
          <button type="button" className="underline" onClick={() => void posts.refetch()}>Retry</button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-xs text-slate-500">
          No posts yet. Posts appear once ads made from this creative have a post ID — use “Refresh post IDs” in the Posts tab if ads are already running.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(p => (
            <li key={p.postId} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <MediaThumb thumbUrl={p.thumbnailUrl} isVideo={p.isVideo} alt="" badge={false} className="h-10 w-10 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <PostIdActions postId={p.postId} permalink={p.permalink} />
                <div className="truncate text-[11px] text-slate-500">
                  {p.pageName ?? `Page ${p.pageId}`} · {p.activeAds}/{p.ads} active ad{p.ads === 1 ? '' : 's'} · last used {fmtDate(p.lastUsedAt)}
                </div>
              </div>
            </li>
          ))}
          {posts.data?.hasMore && <li className="text-[11px] text-slate-500">Showing the {items.length} most recent posts.</li>}
        </ul>
      )}
    </section>
  );
}

export function CreativeDetailsDialog({ creative: target, onOpenChange, canManage, onEdit }: CreativeDetailsDialogProps) {
  // Keep the last creative while the dialog animates closed.
  const [c, setC] = useState<CreativeDto | null>(target);
  useEffect(() => {
    if (target) setC(target);
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b px-4 py-3 pr-12 sm:px-6">
          <DialogTitle className="break-words text-base leading-snug">{c?.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            {c?.status === 'archived' && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Archived</Badge>}
            <span>{c?.productTitle}</span>
            {c?.productCode && <span className="font-mono text-xs">· {c.productCode}</span>}
          </DialogDescription>
        </DialogHeader>

        {c && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              {/* Media */}
              <div className="min-w-0">
                <div className="flex items-center justify-center overflow-hidden rounded-lg bg-slate-900/95">
                  {c.mediaType === 'video' ? (
                    <video
                      key={c.id}
                      src={c.mediaUrl}
                      poster={c.thumbUrl ?? undefined}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-[60dvh] w-full bg-black object-contain"
                    />
                  ) : (
                    <img key={c.id} src={c.mediaUrl} alt={c.name} className="max-h-[60dvh] w-full object-contain" />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>{c.mediaType === 'video' ? 'Video' : 'Image'}</span>
                  {c.width && c.height && <span>{c.width}×{c.height}</span>}
                  <a href={c.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline-offset-2 hover:underline">Open original</a>
                </div>
              </div>

              {/* Info */}
              <div className="min-w-0 space-y-4">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-slate-500">Angle</dt>
                  <dd className="break-words font-medium text-slate-900">{c.angle}</dd>
                  <dt className="text-slate-500">Product</dt>
                  <dd className="break-words text-slate-800">{c.productTitle}{c.productCode && <span className="ml-1 font-mono text-xs text-slate-500">{c.productCode}</span>}</dd>
                  <dt className="text-slate-500">Created</dt>
                  <dd className="text-slate-800">{c.creatorName} · {fmtDate(c.createdAt, 'MMM d, yyyy HH:mm')}</dd>
                  <dt className="text-slate-500">Used in</dt>
                  <dd className="text-slate-800">{c.adsCount > 0 ? `${c.adsCount} ad${c.adsCount === 1 ? '' : 's'}` : 'Not launched yet'}</dd>
                </dl>

                <div className="space-y-3 rounded-lg border p-3">
                  <CopyField label="Primary text" value={c.primaryText} />
                  <CopyField label="Headline" value={c.headline} />
                  <CopyField label="Description" value={c.description} />
                  {canManage && (
                    <Button variant="outline" size="sm" onClick={() => onEdit(c)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit copy
                    </Button>
                  )}
                </div>

                <CreativePosts creativeId={c.id} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
