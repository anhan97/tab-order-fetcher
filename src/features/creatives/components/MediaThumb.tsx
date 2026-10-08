import { useState } from 'react';
import { Film, ImageOff, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaThumbProps {
  /** Poster / thumbnail URL. */
  thumbUrl: string | null | undefined;
  /** Original media URL — used when there is no thumbnail. */
  mediaUrl?: string | null;
  isVideo: boolean;
  alt: string;
  className?: string;
  /** Show the play badge on videos. */
  badge?: boolean;
  fit?: 'cover' | 'contain';
}

/** Square-agnostic thumbnail: poster image, else the media itself, else a placeholder. */
export function MediaThumb({ thumbUrl, mediaUrl, isVideo, alt, className, badge = true, fit = 'cover' }: MediaThumbProps) {
  const [broken, setBroken] = useState(false);
  const src = thumbUrl ?? mediaUrl ?? null;
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain';
  // A video without a poster: let the browser show its first frame.
  const videoFallback = !thumbUrl && isVideo && !!mediaUrl;

  return (
    <div className={cn('relative overflow-hidden bg-slate-100', className)}>
      {!src || broken ? (
        <div className="absolute inset-0 flex items-center justify-center text-slate-300">
          {isVideo ? <Film className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />}
        </div>
      ) : videoFallback ? (
        <video
          src={`${mediaUrl}#t=0.5`}
          muted
          playsInline
          preload="metadata"
          className={cn('absolute inset-0 h-full w-full', objectFit)}
          onError={() => setBroken(true)}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn('absolute inset-0 h-full w-full', objectFit)}
          onError={() => setBroken(true)}
        />
      )}
      {isVideo && badge && (
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Play className="h-2.5 w-2.5 fill-current" /> Video
        </span>
      )}
    </div>
  );
}
