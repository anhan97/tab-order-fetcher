/**
 * 1–10 audiences; ad set i takes audience i mod count (§5.1).
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LIMITS, type Audience, type Gender } from '@contract/ads-launcher';
import { CountriesInput, IntInput } from './form-inputs';

const NEW_AUDIENCE: Audience = { label: 'Broad', countries: ['US'], ageMin: 18, ageMax: 65, gender: 'all' };

export function AudiencesEditor({ audiences, onChange, disabled }: { audiences: Audience[]; onChange: (a: Audience[]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<Audience>) => onChange(audiences.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-2">
      {audiences.map((a, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_4rem_4rem_minmax(0,1fr)_auto]">
          <div className="col-span-2 space-y-1 sm:col-span-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Audience {i + 1}</p>
            <Input value={a.label} onChange={e => update(i, { label: e.target.value })} placeholder="Name" className="h-9" disabled={disabled} maxLength={80} aria-label={`Audience ${i + 1} name`} />
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Countries</p>
            <CountriesInput value={a.countries} onChange={countries => update(i, { countries })} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Min age</p>
            <IntInput value={a.ageMin} onChange={ageMin => update(i, { ageMin })} min={LIMITS.ageMin} max={LIMITS.ageMax} disabled={disabled} ariaLabel="Min age" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Max age</p>
            <IntInput value={a.ageMax} onChange={ageMax => update(i, { ageMax })} min={LIMITS.ageMin} max={LIMITS.ageMax} disabled={disabled} ariaLabel="Max age" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Gender</p>
            <Select value={a.gender} onValueChange={v => update(i, { gender: v as Gender })} disabled={disabled}>
              <SelectTrigger className="h-9 w-full text-sm" aria-label="Gender"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="men">Men</SelectItem>
                <SelectItem value="women">Women</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-slate-400 hover:text-rose-600"
              onClick={() => onChange(audiences.filter((_, j) => j !== i))}
              disabled={disabled || audiences.length <= 1}
              aria-label={`Remove audience ${i + 1}`}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => onChange([...audiences, { ...NEW_AUDIENCE, label: `Audience ${audiences.length + 1}` }])}
        disabled={disabled || audiences.length >= LIMITS.audiencesPerPreset}
      >
        <Plus /> Add audience
      </Button>
      {audiences.length > 1 && <p className="text-[11px] text-slate-500">Ad sets take the audiences in turn: ad set 1 → audience 1, ad set 2 → audience 2…</p>}
    </div>
  );
}
