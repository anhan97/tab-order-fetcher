/**
 * Per-creative copy edits beside a live Facebook preview (§3.2 step 4).
 * A blank box means "the creative's own copy". Posts cannot be edited.
 */
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { LIMITS, type CallToAction } from '@contract/ads-launcher';
import type { PoolItem } from '../lib/pool';
import type { CopyOverride } from '../lib/structure';
import { FacebookAdPreview } from './FacebookAdPreview';
import { PoolThumb } from './PoolThumb';
import { Field } from './setup-fields';

export interface CopyEditorProps {
  items: PoolItem[];
  copy: Record<string, CopyOverride>;
  onCopy: (creativeId: string, patch: CopyOverride) => void;
  onReset: (creativeId: string) => void;
  page: { name: string; pictureUrl: string | null } | null;
  displayLink: string;
  callToAction: CallToAction;
  disabled?: boolean;
}

const filled = (v?: string) => typeof v === 'string' && v.trim() !== '';
const isEdited = (c?: CopyOverride) => !!c && (filled(c.primaryText) || filled(c.headline) || filled(c.description));

export function CopyEditor(props: CopyEditorProps) {
  const { items, copy, disabled } = props;
  const [selected, setSelected] = useState(items[0]?.key ?? '');
  useEffect(() => {
    if (!items.some(i => i.key === selected)) setSelected(items[0]?.key ?? '');
  }, [items, selected]);
  const item = items.find(i => i.key === selected) ?? items[0];
  if (!item) return null;

  const edit = item.kind === 'creative' && item.creativeId ? copy[item.creativeId] : undefined;
  const value = (f: keyof CopyOverride, original: string) => (filled(edit?.[f]) ? edit![f]! : original);
  const set = (f: keyof CopyOverride) => (v: string) => item.creativeId && props.onCopy(item.creativeId, { [f]: v });

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-semibold text-slate-900">Copy & preview</p>
        <p className="text-[11px] text-slate-500">Leave a box empty to use the creative's own copy. Edits apply to every ad made from that creative.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-3 py-2">
        {items.map((i, n) => {
          const edited = i.kind === 'creative' && i.creativeId ? isEdited(copy[i.creativeId]) : false;
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => setSelected(i.key)}
              className={cn('relative shrink-0 rounded-md p-0.5', i.key === item.key ? 'ring-2 ring-teal-500' : 'opacity-80 hover:opacity-100')}
              aria-label={`Edit copy of ${i.name}`}
              aria-pressed={i.key === item.key}
            >
              <PoolThumb item={i} order={n + 1} size="sm" />
              {edited && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500" title="Copy edited" />}
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-xs font-medium text-slate-700">{item.name}</p>
            {item.kind === 'creative' && isEdited(edit) && (
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => item.creativeId && props.onReset(item.creativeId)} disabled={disabled}>
                <RotateCcw className="!size-3" /> Original copy
              </Button>
            )}
          </div>
          {item.kind === 'post' ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Existing post <span className="font-mono">{item.postId}</span>: the ad runs it exactly as published — text, media, link and button — and keeps its likes, comments and shares. Its copy cannot be edited.
            </p>
          ) : (
            <>
              <Field label="Primary text" hint={`${(edit?.primaryText ?? '').length}/${LIMITS.primaryTextLength}`}>
                <Textarea
                  value={edit?.primaryText ?? ''}
                  onChange={e => set('primaryText')(e.target.value)}
                  placeholder={item.primaryText || 'No primary text'}
                  maxLength={LIMITS.primaryTextLength}
                  rows={5}
                  disabled={disabled}
                  className="text-sm"
                />
              </Field>
              <Field label="Headline">
                <Input value={edit?.headline ?? ''} onChange={e => set('headline')(e.target.value)} placeholder={item.headline || 'No headline'} maxLength={LIMITS.headlineLength} disabled={disabled} className="h-9" />
              </Field>
              <Field label="Description">
                <Input value={edit?.description ?? ''} onChange={e => set('description')(e.target.value)} placeholder={item.description || 'No description'} maxLength={LIMITS.descriptionLength} disabled={disabled} className="h-9" />
              </Field>
            </>
          )}
        </div>
        <div className="flex justify-center md:block">
          <FacebookAdPreview
            pageName={item.kind === 'post' ? item.pageName ?? props.page?.name : props.page?.name}
            pageAvatarUrl={item.kind === 'post' ? null : props.page?.pictureUrl}
            primaryText={value('primaryText', item.primaryText)}
            headline={value('headline', item.headline)}
            description={value('description', item.description)}
            displayLink={item.kind === 'post' ? null : props.displayLink}
            callToAction={props.callToAction}
            mediaUrl={item.mediaUrl}
            thumbUrl={item.thumbUrl}
            mediaType={item.mediaType}
            isPost={item.kind === 'post'}
          />
        </div>
      </div>
    </div>
  );
}
