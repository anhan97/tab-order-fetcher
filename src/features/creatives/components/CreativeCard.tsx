import { Archive, ArchiveRestore, Check, Eye, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { CreativeDto } from '@contract/ads-launcher';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MediaThumb } from './MediaThumb';

interface CreativeCardProps {
  creative: CreativeDto;
  /** 1-based position in the selection; 0 = not selected. */
  order: number;
  /** Clicking toggles selection (else it opens the details). */
  selectable: boolean;
  canManage: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

export function CreativeCard({
  creative: c, order, selectable, canManage, onToggle, onDetails, onEdit, onArchive, onRestore, onDelete
}: CreativeCardProps) {
  const selected = order > 0;
  const activate = selectable ? onToggle : onDetails;

  return (
    <div
      role={selectable ? 'checkbox' : 'button'}
      aria-checked={selectable ? selected : undefined}
      aria-label={c.name}
      tabIndex={0}
      onClick={activate}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          activate();
        }
      }}
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border bg-white text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        selected ? 'border-teal-500 ring-2 ring-teal-500/60' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
        c.status === 'archived' && 'opacity-80'
      )}
    >
      <MediaThumb
        thumbUrl={c.thumbUrl}
        mediaUrl={c.mediaUrl}
        isVideo={c.mediaType === 'video'}
        alt={c.name}
        className="aspect-square w-full"
      />

      {/* Selection order badge / checkbox */}
      {selectable && (
        <span
          aria-hidden
          className={cn(
            'absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 text-xs font-bold shadow-sm',
            selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-white bg-black/25 text-transparent group-hover:bg-black/40'
          )}
        >
          {selected ? order : <Check className="h-3 w-3 text-white/80" />}
        </span>
      )}

      {/* Menu */}
      <div className="absolute right-1.5 top-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-7 w-7 bg-white/90 p-0 shadow-sm hover:bg-white" aria-label="Creative actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onDetails}>
              <Eye className="mr-2 h-4 w-4" /> View details
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit} disabled={!canManage}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            {c.status === 'active' ? (
              <DropdownMenuItem onSelect={onArchive} disabled={!canManage}>
                <Archive className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onRestore} disabled={!canManage}>
                <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} disabled={!canManage} className="text-rose-600 focus:text-rose-700">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
        <p className="line-clamp-2 break-words text-xs font-medium leading-snug text-slate-900" title={c.name}>{c.name}</p>
        <p className="truncate text-[11px] text-slate-500" title={c.angle}>{c.angle}</p>
        <div className="mt-auto flex min-w-0 items-center justify-between gap-1 pt-0.5">
          <span className="truncate font-mono text-[10px] text-slate-400" title={c.productTitle}>{c.productCode || c.productTitle}</span>
          {c.adsCount > 0 ? (
            <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">In {c.adsCount} ad{c.adsCount === 1 ? '' : 's'}</span>
          ) : (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Not launched</span>
          )}
        </div>
      </div>
    </div>
  );
}
