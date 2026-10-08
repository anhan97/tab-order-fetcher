import { cn } from '@/lib/utils';
import type { Count, Structure } from '@contract/ads-launcher';

const MAX = 3;

function Level({ count, className, label }: { count: Count; className: string; label: string }) {
  const n = count === 'n' ? MAX : Math.min(count, MAX);
  const more = count === 'n' || count > MAX;
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${count} ${label}`}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={cn('block rounded-[2px]', className)} />
        ))}
        {more && <span className="text-[9px] font-bold leading-none text-slate-400">…</span>}
      </div>
      <span className="text-[9px] font-semibold leading-none text-slate-500">{count}</span>
    </div>
  );
}

/** Tiny C:S:A picture for preset cards. */
export function MiniStructure({ structure, className }: { structure: Pick<Structure, 'campaigns' | 'adsetsPerCampaign' | 'adsPerAdset'>; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)} aria-label={`${structure.campaigns} campaigns, ${structure.adsetsPerCampaign} ad sets each, ${structure.adsPerAdset} ads each`}>
      <Level count={structure.campaigns} className="h-3 w-3 bg-teal-600" label="campaigns" />
      <span className="mb-2.5 h-px w-2 bg-slate-300" />
      <Level count={structure.adsetsPerCampaign} className="h-2.5 w-2.5 bg-teal-400" label="ad sets per campaign" />
      <span className="mb-2.5 h-px w-2 bg-slate-300" />
      <Level count={structure.adsPerAdset} className="h-2 w-2 rounded-full bg-slate-400" label="ads per ad set" />
    </div>
  );
}
