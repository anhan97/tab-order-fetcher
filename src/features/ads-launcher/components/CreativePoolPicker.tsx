/**
 * Creatives of the product as small Facebook ads; click to add / remove from
 * the pool. Newest first, "Not launched (n) / All", "Select all shown" (§3.2).
 */
import { useMemo } from 'react';
import { CheckSquare, Film, Loader2, Search, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { CallToAction, CreativeDto } from '@contract/ads-launcher';
import { ctaLabel } from '../lib/format';
import { PageAvatar } from './setup-fields';

export interface CreativePoolPickerProps {
  creatives: CreativeDto[];
  total: number;
  notLaunched: number;
  loading: boolean;
  error: string | null;
  filter: 'not' | 'all';
  onFilter: (f: 'not' | 'all') => void;
  query: string;
  onQuery: (q: string) => void;
  /** Pool keys in selection order (creative key = its uuid). */
  selectedKeys: string[];
  onToggle: (c: CreativeDto) => void;
  onSelectMany: (cs: CreativeDto[]) => void;
  onDeselectMany: (cs: CreativeDto[]) => void;
  page?: { name: string; pictureUrl: string | null } | null;
  callToAction?: CallToAction | null;
  disabled?: boolean;
}

export function CreativePoolPicker(props: CreativePoolPickerProps) {
  const { creatives, selectedKeys, disabled } = props;
  const sorted = useMemo(
    () => [...creatives].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [creatives]
  );
  const order = useMemo(() => new Map(selectedKeys.map((k, i) => [k, i + 1])), [selectedKeys]);
  const allShownSelected = sorted.length > 0 && sorted.every(c => order.has(c.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={props.filter}
          onValueChange={v => v && props.onFilter(v as 'not' | 'all')}
          className="rounded-md border border-slate-200 bg-white p-0.5"
        >
          <ToggleGroupItem value="not" className="h-7 px-2.5 text-xs data-[state=on]:bg-teal-50 data-[state=on]:text-teal-800">
            Not launched ({props.notLaunched})
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-7 px-2.5 text-xs data-[state=on]:bg-teal-50 data-[state=on]:text-teal-800">
            All{props.filter === 'all' ? ` (${props.total})` : ''}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input value={props.query} onChange={e => props.onQuery(e.target.value)} placeholder="Search angle, copy…" className="h-8 pl-8 text-xs" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={disabled || sorted.length === 0}
          onClick={() => (allShownSelected ? props.onDeselectMany(sorted) : props.onSelectMany(sorted))}
        >
          {allShownSelected ? <CheckSquare /> : <Square />}
          {allShownSelected ? 'Deselect shown' : 'Select all shown'}
        </Button>
        {props.loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {props.error && <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{props.error}</p>}

      {!props.loading && sorted.length === 0 && !props.error && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {props.filter === 'not' ? 'Every creative of this product has been launched. Switch to "All" to launch one again.' : 'No creative for this product yet. Upload some in the Creatives library.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {sorted.map(c => (
          <CreativeCard
            key={c.id}
            creative={c}
            order={order.get(c.id) ?? null}
            onToggle={() => props.onToggle(c)}
            page={props.page}
            callToAction={props.callToAction}
            disabled={disabled}
          />
        ))}
      </div>
      {props.total > sorted.length && (
        <p className="text-center text-[11px] text-slate-500">Showing the newest {sorted.length} of {props.total}. Search to narrow down.</p>
      )}
    </div>
  );
}

function CreativeCard({
  creative: c,
  order,
  onToggle,
  page,
  callToAction,
  disabled
}: {
  creative: CreativeDto;
  order: number | null;
  onToggle: () => void;
  page?: { name: string; pictureUrl: string | null } | null;
  callToAction?: CallToAction | null;
  disabled?: boolean;
}) {
  const selected = order !== null;
  const thumb = c.thumbUrl ?? (c.mediaType === 'image' ? c.mediaUrl : null);
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition',
        selected ? 'border-teal-500 ring-2 ring-teal-500/40' : 'border-slate-200 hover:border-slate-300 hover:shadow',
        disabled && 'cursor-not-allowed opacity-70'
      )}
    >
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <PageAvatar name={page?.name} pictureUrl={page?.pictureUrl} className="h-5 w-5 text-[9px]" />
        <div className="min-w-0 leading-none">
          <p className="truncate text-[11px] font-semibold text-slate-800">{page?.name || 'Your page'}</p>
          <p className="text-[9px] text-slate-400">Sponsored</p>
        </div>
      </div>
      <p className="line-clamp-2 min-h-[2rem] px-2 pb-1.5 text-[11px] leading-4 text-slate-700">{c.primaryText || <span className="italic text-slate-400">No primary text</span>}</p>
      <div className="relative aspect-square w-full bg-slate-100">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-400"><Film className="h-6 w-6" /></div>}
        {c.mediaType === 'video' && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"><Film className="h-3 w-3" /> Video</span>
        )}
        {c.adsCount > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">Launched · {c.adsCount} ads</span>
        )}
      </div>
      <div className="flex w-full items-center gap-2 self-stretch bg-slate-50 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-slate-800">{c.headline || 'Headline'}</p>
          <p className="truncate text-[10px] text-slate-500" title={c.angle}>{c.angle}</p>
        </div>
        {callToAction && <span className="hidden shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 sm:inline">{ctaLabel(callToAction)}</span>}
      </div>
      <span
        className={cn(
          'absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 text-[11px] font-bold',
          selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-white bg-white/70 text-transparent group-hover:border-teal-400'
        )}
        aria-hidden
      >
        {order ?? '·'}
      </span>
    </button>
  );
}
