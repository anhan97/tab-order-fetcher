import { Film, Image as ImageIcon, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PoolItem } from '../lib/pool';

interface PoolThumbProps {
  item: Pick<PoolItem, 'name' | 'thumbUrl' | 'mediaType' | 'kind'>;
  /** Selection order (1-based) shown in the corner. */
  order?: number | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  showKind?: boolean;
}

const SIZES = { xs: 'h-8 w-8', sm: 'h-11 w-11', md: 'h-16 w-16' } as const;

/** Square thumbnail of a pool item: image / video poster, with a Post or video marker. */
export function PoolThumb({ item, order, size = 'sm', className, showKind = true }: PoolThumbProps) {
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100', SIZES[size], className)}
      title={item.name}
    >
      {item.thumbUrl ? (
        <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-400">
          {item.kind === 'post' ? <MessageSquareText className="h-4 w-4" /> : item.mediaType === 'video' ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
        </div>
      )}
      {showKind && item.kind === 'post' && size !== 'xs' && (
        <span className="absolute bottom-0 left-0 right-0 bg-slate-900/70 text-center text-[9px] font-semibold uppercase leading-3 text-white">Post</span>
      )}
      {showKind && item.kind !== 'post' && item.mediaType === 'video' && item.thumbUrl && (
        <Film className="absolute bottom-0.5 right-0.5 h-3 w-3 text-white drop-shadow" />
      )}
      {order != null && (
        <span className="absolute left-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[9px] font-bold text-white">
          {order}
        </span>
      )}
    </div>
  );
}
