import { useState } from 'react';
import { Globe, MoreHorizontal, ThumbsUp, MessageCircle, Share2, Film } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallToAction, MediaType } from '@contract/ads-launcher';
import { ctaLabel } from '../lib/format';
import { PageAvatar } from './setup-fields';

export interface FacebookAdPreviewProps {
  pageName?: string | null;
  pageAvatarUrl?: string | null;
  primaryText?: string | null;
  headline?: string | null;
  description?: string | null;
  displayLink?: string | null;
  callToAction?: CallToAction | null;
  mediaUrl?: string | null;
  thumbUrl?: string | null;
  mediaType?: MediaType;
  /** An existing post: show a note that Meta shows the post as published. */
  isPost?: boolean;
  className?: string;
}

const CLAMP = 140;

/** Phone-style Facebook feed ad (§3.2 step 2 / step 4). */
export function FacebookAdPreview({
  pageName,
  pageAvatarUrl,
  primaryText,
  headline,
  description,
  displayLink,
  callToAction,
  mediaUrl,
  thumbUrl,
  mediaType = 'image',
  isPost,
  className
}: FacebookAdPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const text = primaryText ?? '';
  const long = text.length > CLAMP;
  const shown = long && !expanded ? `${text.slice(0, CLAMP).trimEnd()}… ` : text;

  return (
    <div className={cn('w-full max-w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <PageAvatar name={pageName} pictureUrl={pageAvatarUrl} className="h-9 w-9 text-sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-slate-900">{pageName || 'Your page'}</p>
          <p className="flex items-center gap-1 text-[11px] text-slate-500">
            Sponsored · <Globe className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
      </div>

      {text ? (
        <p className="whitespace-pre-line break-words px-3 pb-2 text-[13px] leading-snug text-slate-900">
          {shown}
          {long && (
            <button type="button" className="font-semibold text-slate-500 hover:underline" onClick={() => setExpanded(v => !v)}>
              {expanded ? ' See less' : 'See more'}
            </button>
          )}
        </p>
      ) : (
        <p className="px-3 pb-2 text-[13px] italic text-slate-400">{isPost ? 'Post text as published' : 'No primary text'}</p>
      )}

      <div className="relative aspect-square w-full bg-slate-100">
        {mediaType === 'video' && mediaUrl && !isPost ? (
          <video
            key={mediaUrl}
            src={mediaUrl}
            poster={thumbUrl ?? undefined}
            controls
            muted
            playsInline
            preload="metadata"
            className="h-full w-full bg-black object-contain"
          />
        ) : mediaUrl || thumbUrl ? (
          <img src={(mediaType === 'image' ? mediaUrl : thumbUrl) ?? mediaUrl ?? thumbUrl ?? ''} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No media</div>
        )}
        {isPost && mediaType === 'video' && <Film className="absolute right-2 top-2 h-4 w-4 text-white drop-shadow" />}
      </div>

      <div className="flex items-center gap-3 bg-slate-50 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase text-slate-500">{displayLink || 'your-store.com'}</p>
          <p className="line-clamp-2 break-words text-[13px] font-semibold leading-tight text-slate-900">{headline || (isPost ? 'Headline as published' : 'Headline')}</p>
          {description && <p className="truncate text-[12px] text-slate-500">{description}</p>}
        </div>
        {callToAction && (
          <span className="shrink-0 rounded-md bg-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-800">{ctaLabel(callToAction)}</span>
        )}
      </div>

      <div className="flex items-center justify-around border-t border-slate-100 px-3 py-1.5 text-[12px] font-medium text-slate-500">
        <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> Comment</span>
        <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" /> Share</span>
      </div>
    </div>
  );
}
