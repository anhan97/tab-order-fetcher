import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { copyText } from '../lib/clipboard';

/** Icon button that copies `text` and shows a short tick. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } else {
      toast({ title: 'Could not copy', description: text, variant: 'destructive' });
    }
  };
  return (
    <Button type="button" variant="ghost" size="sm" className={cn('h-7 w-7 shrink-0 p-0 text-slate-500', className)} onClick={onClick} title={label} aria-label={label}>
      {copied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** Post ID (mono) + "Copy post ID" + "Open on Facebook". */
export function PostIdActions({ postId, permalink, className }: { postId: string; permalink: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-0.5', className)}>
      <span className="truncate font-mono text-xs text-slate-700" title={postId}>{postId}</span>
      <CopyButton text={postId} label="Copy post ID" />
      <Button asChild variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0 text-slate-500" title="Open on Facebook">
        <a href={permalink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label="Open on Facebook">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  );
}
