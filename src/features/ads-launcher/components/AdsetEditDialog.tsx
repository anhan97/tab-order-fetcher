/**
 * Pick the items of one ad set by hand (pencil on the diagram, §3.2 step 3).
 * The choice is filled like an automatic ad set (fillTo) when "Repeat to
 * fill" is on and ads per ad set is a number (§5.3 note).
 */
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Count } from '@contract/ads-launcher';
import type { PoolItem } from '../lib/pool';
import type { PlannedAdset } from '../lib/structure';
import { PoolThumb } from './PoolThumb';

export interface AdsetEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adset: PlannedAdset | null;
  pool: PoolItem[];
  adsPerAdset: Count;
  repeatToFill: boolean;
  /** null = back to automatic. */
  onSave: (itemKeys: string[] | null) => void;
}

export function AdsetEditDialog({ open, onOpenChange, adset, pool, adsPerAdset, repeatToFill, onSave }: AdsetEditDialogProps) {
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (open && adset) setChosen([...new Set(adset.itemKeys)]);
  }, [open, adset]);

  const toggle = (key: string) => setChosen(c => (c.includes(key) ? c.filter(k => k !== key) : [...c, key]));
  const k = typeof adsPerAdset === 'number' ? adsPerAdset : null;
  const filled = k !== null && repeatToFill && chosen.length > 0 && chosen.length < k;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">Creatives of this ad set</DialogTitle>
          <DialogDescription className="break-words text-xs">
            {adset?.name}
            {k !== null && ` · ${k} ad${k === 1 ? '' : 's'} per ad set`}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {pool.map(item => {
              const n = chosen.indexOf(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggle(item.key)}
                  aria-pressed={n >= 0}
                  className={cn(
                    'flex min-w-0 flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition',
                    n >= 0 ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500/40' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <PoolThumb item={item} order={n >= 0 ? n + 1 : null} size="md" />
                  <span className="w-full truncate text-[10px] text-slate-600" title={item.name}>{item.angle || item.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          {chosen.length === 0
            ? 'Nothing picked: the ad set keeps its automatic creatives.'
            : filled
              ? `${chosen.length} picked — repeated in order to fill ${k} ads.`
              : `${chosen.length} picked.`}
        </p>
        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSave(null);
              onOpenChange(false);
            }}
            disabled={!adset?.overridden}
          >
            <RotateCcw /> Back to automatic
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="button"
              size="sm"
              className="bg-teal-600 text-white hover:bg-teal-700"
              onClick={() => {
                onSave(chosen.length ? chosen : null);
                onOpenChange(false);
              }}
            >
              Use these
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
