/**
 * C:S:A inputs + "Repeat to fill" (§5.1). `n` may sit at one level only:
 * picking it at one level turns another `n` back into 1.
 */
import { Repeat } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { Count, Structure } from '@contract/ads-launcher';
import { CountInput } from './form-inputs';

type Level = 'campaigns' | 'adsetsPerCampaign' | 'adsPerAdset';
const LEVELS: Array<{ key: Level; label: string }> = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'adsetsPerCampaign', label: 'Ad sets / campaign' },
  { key: 'adsPerAdset', label: 'Ads / ad set' }
];

export function StructureFields({ structure, onChange, disabled }: { structure: Structure; onChange: (s: Structure) => void; disabled?: boolean }) {
  const set = (key: Level, v: Count) => {
    const next: Structure = { ...structure, [key]: v };
    if (v === 'n') for (const l of LEVELS) if (l.key !== key && next[l.key] === 'n') next[l.key] = 1;
    onChange(next);
  };
  const repeatOn = structure.repeatToFill !== false;
  const repeatMatters = structure.adsPerAdset !== 'n';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
        {LEVELS.map((l, i) => (
          <div key={l.key} className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="block text-[11px] font-medium text-slate-600">{l.label}</Label>
              <CountInput value={structure[l.key]} onChange={v => set(l.key, v)} disabled={disabled} label={l.label} />
            </div>
            {i < LEVELS.length - 1 && <span className="pb-2 font-mono text-lg text-slate-300">:</span>}
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2.5">
        <Switch
          id="al-repeat"
          checked={repeatOn}
          onCheckedChange={v => onChange({ ...structure, repeatToFill: v })}
          disabled={disabled || !repeatMatters}
          className="mt-0.5 data-[state=checked]:bg-teal-600"
        />
        <div>
          <Label htmlFor="al-repeat" className="flex items-center gap-1 text-xs font-medium text-slate-700">
            <Repeat className="h-3.5 w-3.5 text-slate-400" /> Repeat to fill
          </Label>
          <p className="text-[11px] text-slate-500">
            {repeatMatters
              ? `Every ad set gets exactly ${structure.adsPerAdset} ad${structure.adsPerAdset === 1 ? '' : 's'}: a short ad set repeats its items in order. Off: an item never appears twice in an ad set.`
              : 'No effect while ads per ad set is "n".'}
          </p>
        </div>
      </div>
    </div>
  );
}
