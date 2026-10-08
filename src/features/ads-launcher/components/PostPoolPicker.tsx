/**
 * Existing posts (§10): the product's posts that already ran, plus "Add by
 * post ID" for any post. An ad from a post keeps its likes, comments and
 * shares; its copy and link cannot change.
 */
import { useState } from 'react';
import { ExternalLink, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { PostRow } from '@contract/ads-launcher';
import { formatMoney } from '../lib/format';
import { parsePostIds, postKey } from '../lib/pool';
import { PoolThumb } from './PoolThumb';

export interface PostPoolPickerProps {
  posts: PostRow[];
  total: number;
  loading: boolean;
  error: string | null;
  query: string;
  onQuery: (q: string) => void;
  selectedKeys: string[];
  onToggle: (p: PostRow) => void;
  disabled?: boolean;
  /** Narrowed to the launch's product. */
  productTitle?: string | null;
}

export function PostPoolPicker(props: PostPoolPickerProps) {
  const order = new Map(props.selectedKeys.map((k, i) => [k, i + 1]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input value={props.query} onChange={e => props.onQuery(e.target.value)} placeholder="Search post ID, ad name, copy…" className="h-8 pl-8 text-xs" />
        </div>
        <span className="text-[11px] text-slate-500">
          {props.productTitle ? `Posts that ran for ${props.productTitle}` : 'Posts that ran in your ad accounts'} · {props.total}
        </span>
        {props.loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>
      {props.error && <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">{props.error}</p>}
      {!props.loading && !props.error && props.posts.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No post found. Run "Refresh post IDs" in the Posts library, or add a post by its ID.
        </p>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {props.posts.map(p => {
          const n = order.get(postKey(p.postId)) ?? null;
          return (
            <li key={p.postId}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={n !== null}
                onClick={() => !props.disabled && props.onToggle(p)}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ') && !props.disabled) {
                    e.preventDefault();
                    props.onToggle(p);
                  }
                }}
                className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors', n !== null ? 'bg-teal-50/70' : 'hover:bg-slate-50', props.disabled && 'cursor-not-allowed opacity-70')}
              >
                <PoolThumb item={{ name: p.headline ?? p.postId, thumbUrl: p.thumbnailUrl, mediaType: p.isVideo ? 'video' : 'image', kind: 'creative' }} order={n} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{p.creative?.name || p.headline || `Post ${p.postId}`}</p>
                  <p className="line-clamp-1 text-xs text-slate-500">{p.primaryText || p.headline || '—'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-mono">{p.postId}</span>
                    <span>{p.activeAds}/{p.ads} ads active</span>
                    <span>Spend {formatMoney(p.metrics?.spend, p.currency)}</span>
                    {p.metrics?.roas != null && <span>ROAS {p.metrics.roas.toFixed(2)}</span>}
                  </p>
                </div>
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Open on Facebook"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface AddByPostIdProps {
  /** Look the ids up and add them; resolves to how many were known to the API. */
  onAdd: (postIds: string[]) => Promise<{ added: number; unknown: number }>;
  disabled?: boolean;
}

/** Paste any post ID (`123_456`), one or many. */
export function AddByPostId({ onAdd, disabled }: AddByPostIdProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const parsed = parsePostIds(text);

  const submit = async () => {
    if (parsed.valid.length === 0) {
      setMessage({ tone: 'error', text: 'Paste post IDs like 1000000001_555555555' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const r = await onAdd(parsed.valid);
      const bits = [`Added ${r.added} post${r.added === 1 ? '' : 's'}`];
      if (r.unknown) bits.push(`${r.unknown} not seen in your ad accounts yet — added by ID`);
      if (parsed.invalid.length) bits.push(`skipped ${parsed.invalid.join(', ')}`);
      setMessage({ tone: 'ok', text: bits.join(' · ') });
      setText('');
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not add the posts' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <p className="text-sm font-medium text-slate-900">Add by post ID</p>
        <p className="text-xs text-slate-500">
          Any post of a page you can advertise for, as <span className="font-mono">pageId_postId</span>. One per line or separated by commas. The ad runs the post as is.
        </p>
      </div>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder={'1000000001_555555555\n1000000001_666666666'}
        className="font-mono text-xs"
        disabled={disabled || busy}
      />
      {parsed.invalid.length > 0 && <p className="text-[11px] text-amber-700">Not a post ID: {parsed.invalid.slice(0, 5).join(', ')}{parsed.invalid.length > 5 ? '…' : ''}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" className="bg-teal-600 text-white hover:bg-teal-700" onClick={submit} disabled={disabled || busy || parsed.valid.length === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          Add {parsed.valid.length || ''} post{parsed.valid.length === 1 ? '' : 's'}
        </Button>
        {message && <p className={cn('text-xs', message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600')}>{message.text}</p>}
      </div>
    </div>
  );
}
