import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SelectionBarProps {
  count: number;
  noun: string;
  onClear: () => void;
  /** Shown above the actions (e.g. "pick one product"). */
  notice?: React.ReactNode;
  children: React.ReactNode;
}

/** Sticky bottom bar for bulk actions on a selection. */
export function SelectionBar({ count, noun, onClear, notice, children }: SelectionBarProps) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-2 z-20 sm:bottom-4">
      <div className="rounded-xl border border-teal-200 bg-white/95 px-3 py-2.5 shadow-lg shadow-teal-900/10 backdrop-blur">
        {notice && <div className="mb-2 text-xs">{notice}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-800">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-600 px-1.5 text-xs font-semibold text-white">{count}</span>
            {noun}{count === 1 ? '' : 's'} selected
          </span>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-500" onClick={onClear}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
