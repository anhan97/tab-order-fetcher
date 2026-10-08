/**
 * Preset cards: name, mini C:S:A diagram, budget, bid strategy (§3.2 step 3).
 */
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { bidStrategyLabel, normalizePresetConfig, type LaunchPreset } from '@contract/ads-launcher';
import { formatMoney } from '../lib/format';
import { structureLabel } from '../lib/structure';
import { MiniStructure } from './MiniStructure';

export interface PresetPickerProps {
  presets: LaunchPreset[];
  selectedId: string | null;
  dirty: boolean;
  loading?: boolean;
  /** Presets could not be loaded: starters shown, saving creates a new preset. */
  fallback?: boolean;
  currency?: string | null;
  onSelect: (preset: LaunchPreset) => void;
  onDelete?: (preset: LaunchPreset) => void;
  onRestoreStarters?: () => void;
  restoring?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

export function PresetPicker(props: PresetPickerProps) {
  const { presets, selectedId, dirty, disabled, compact } = props;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Presets {props.loading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
        </p>
        {props.onRestoreStarters && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={props.onRestoreStarters} disabled={disabled || props.restoring}>
            {props.restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Restore starters
          </Button>
        )}
      </div>
      {props.fallback && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          Your presets could not be loaded — showing the starters. Changes can be saved as a new preset.
        </p>
      )}
      <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4')}>
        {presets.map(p => {
          const config = normalizePresetConfig(p.config);
          const selected = p.id === selectedId;
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-pressed={selected}
              onClick={() => !disabled && config && props.onSelect(p)}
              onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ' ') && !disabled && config) {
                  e.preventDefault();
                  props.onSelect(p);
                }
              }}
              className={cn(
                'group relative min-w-0 rounded-xl border bg-white p-3 text-left transition',
                selected ? 'border-teal-500 ring-2 ring-teal-500/30' : 'border-slate-200 hover:border-slate-300',
                (disabled || !config) && 'cursor-not-allowed opacity-70',
                !disabled && config && 'cursor-pointer'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                    <span className="truncate">{p.name}</span>
                    {selected && dirty && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Modified</span>}
                  </p>
                  {!compact && p.description && <p className="line-clamp-1 text-[11px] text-slate-500">{p.description}</p>}
                </div>
                {config && <MiniStructure structure={config.structure} className="shrink-0" />}
              </div>
              {config ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{structureLabel(config.structure)}</span>
                  <span>
                    {config.campaign.budgetMode} {formatMoney(config.campaign.dailyBudget, props.currency)}/day
                  </span>
                  <span className="text-slate-400">·</span>
                  <span>{bidStrategyLabel(config.campaign.bidStrategy, config.adset.optimizationGoal)}</span>
                  {config.status === 'ACTIVE' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">ACTIVE</span>}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-rose-600">This preset is no longer valid.</p>
              )}
              {props.onDelete && !p.id.startsWith('starter:') && (
                <button
                  type="button"
                  className="absolute bottom-2 right-2 hidden rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 group-hover:block"
                  onClick={e => {
                    e.stopPropagation();
                    if (!disabled) props.onDelete!(p);
                  }}
                  aria-label={`Delete preset ${p.name}`}
                  title="Delete preset"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {!props.loading && presets.length === 0 && <p className="text-xs text-slate-500">No preset yet. Restore the starters to begin.</p>}
      </div>
    </div>
  );
}
