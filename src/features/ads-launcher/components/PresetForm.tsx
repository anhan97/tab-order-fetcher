/**
 * Edits the working copy of the preset (§6). The saved preset only changes on
 * "Save to preset"; "Save as new" creates another one.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, Save, SaveAll } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  BID_STRATEGIES,
  CALLS_TO_ACTION,
  CONVERSION_EVENTS,
  LIMITS,
  OBJECTIVES,
  OPTIMIZATION_GOALS,
  bidStrategyLabel,
  needsBidAmount,
  needsRoasGoal,
  type BidStrategy,
  type CallToAction,
  type ConversionEvent,
  type LaunchPresetConfig,
  type NodeStatus,
  type Objective,
  type OptimizationGoal
} from '@contract/ads-launcher';
import { CTA_LABELS, EVENT_LABELS, OBJECTIVE_LABELS } from '../lib/format';
import { optimizationGoalLabel } from '../lib/structure';
import { AudiencesEditor } from './AudiencesEditor';
import { StructureFields } from './StructureFields';
import { Field } from './setup-fields';

export interface PresetFormProps {
  config: LaunchPresetConfig;
  onChange: (config: LaunchPresetConfig) => void;
  presetName: string | null;
  dirty: boolean;
  /** A saved preset is selected (not a fallback starter). */
  canUpdate: boolean;
  saving: boolean;
  onSaveToPreset: () => void;
  onSaveAsNew: (name: string) => void;
  /** ACTIVE goes through a confirmation in the parent. */
  onStatus: (status: NodeStatus) => void;
  currency?: string | null;
  disabled?: boolean;
  defaultOpen?: boolean;
}

function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-3', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {children}
    </div>
  );
}

const TOKENS_CAMPAIGN = '{product} {code} {preset} {structure} {date} {n} {angle}';
const TOKENS_ADSET = '{campaign} {n} {audience} {country} {age} {gender} {angle}';

export function PresetForm(props: PresetFormProps) {
  const { config, disabled, currency } = props;
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [newName, setNewName] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const setCampaign = (patch: Partial<LaunchPresetConfig['campaign']>) => props.onChange({ ...config, campaign: { ...config.campaign, ...patch } });
  const setAdset = (patch: Partial<LaunchPresetConfig['adset']>) => props.onChange({ ...config, adset: { ...config.adset, ...patch } });

  const strategy = config.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
  const onStrategy = (s: BidStrategy) => {
    const campaign = { ...config.campaign, bidStrategy: s };
    if (!needsBidAmount(s)) delete campaign.bidAmount;
    if (!needsRoasGoal(s)) delete campaign.roasGoal;
    // ROAS goal only works with the Value goal (§6.1).
    const adset = needsRoasGoal(s) ? { ...config.adset, optimizationGoal: 'VALUE' as const } : config.adset;
    props.onChange({ ...config, campaign, adset });
  };
  const currencyHint = currency ? ` (${currency})` : '';

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex min-w-[14rem] flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform', !open && '-rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900">Settings{props.presetName ? ` · ${props.presetName}` : ''}</span>
            <span className="block text-[11px] text-slate-500">Structure, budget, bid, audiences, call to action and status</span>
          </span>
          {props.dirty && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Modified</span>}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {props.canUpdate && (
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={props.onSaveToPreset} disabled={disabled || props.saving || !props.dirty}>
              {props.saving ? <Loader2 className="animate-spin" /> : <Save />} Save to preset
            </Button>
          )}
          <Popover open={saveAsOpen} onOpenChange={setSaveAsOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={disabled || props.saving}>
                <SaveAll /> Save as new
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-2 p-3">
              <Label htmlFor="al-new-preset" className="text-xs">Preset name</Label>
              <Input
                id="al-new-preset"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                maxLength={80}
                placeholder="e.g. ABO 3 per concept"
                className="h-9"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) {
                    props.onSaveAsNew(newName.trim());
                    setNewName('');
                    setSaveAsOpen(false);
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                className="w-full bg-teal-600 text-white hover:bg-teal-700"
                disabled={!newName.trim() || props.saving}
                onClick={() => {
                  props.onSaveAsNew(newName.trim());
                  setNewName('');
                  setSaveAsOpen(false);
                }}
              >
                Save preset
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="border-t border-slate-200 p-3">
        <StructureFields structure={config.structure} onChange={structure => props.onChange({ ...config, structure })} disabled={disabled} />
      </div>

      {open && (
        <div className="grid gap-3 border-t border-slate-200 p-3 lg:grid-cols-2">
          <Block title="Campaign">
            <Field label="Name template" hint={`Tokens: ${TOKENS_CAMPAIGN}`}>
              <Input value={config.campaign.nameTemplate} onChange={e => setCampaign({ nameTemplate: e.target.value })} maxLength={LIMITS.nameLength} className="h-9 font-mono text-xs" disabled={disabled} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Objective">
                <Select value={config.campaign.objective} onValueChange={v => setCampaign({ objective: v as Objective })} disabled={disabled}>
                  <SelectTrigger className="h-9 w-full text-sm" aria-label="Objective"><SelectValue /></SelectTrigger>
                  <SelectContent>{OBJECTIVES.map(o => <SelectItem key={o} value={o}>{OBJECTIVE_LABELS[o]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Budget">
                <Select value={config.campaign.budgetMode} onValueChange={v => setCampaign({ budgetMode: v as 'CBO' | 'ABO' })} disabled={disabled}>
                  <SelectTrigger className="h-9 w-full text-sm" aria-label="Budget mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CBO">Campaign budget (CBO)</SelectItem>
                    <SelectItem value="ABO">Ad set budget (ABO)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={`Daily budget ${config.campaign.budgetMode === 'CBO' ? 'per campaign' : 'per ad set'}${currencyHint}`}>
                <Input value={config.campaign.dailyBudget} onChange={e => setCampaign({ dailyBudget: e.target.value.trim() })} inputMode="decimal" placeholder="50" className="h-9" disabled={disabled} />
              </Field>
              <Field label="Bid strategy">
                <Select value={strategy} onValueChange={v => onStrategy(v as BidStrategy)} disabled={disabled}>
                  <SelectTrigger className="h-9 w-full text-sm" aria-label="Bid strategy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BID_STRATEGIES.map(s => <SelectItem key={s} value={s}>{bidStrategyLabel(s, config.adset.optimizationGoal)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {needsBidAmount(strategy) && (
                <Field label={`${strategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'}${currencyHint}`} hint="Applied to every ad set.">
                  <Input value={config.campaign.bidAmount ?? ''} onChange={e => setCampaign({ bidAmount: e.target.value.trim() || undefined })} inputMode="decimal" placeholder="25" className="h-9" disabled={disabled} />
                </Field>
              )}
              {needsRoasGoal(strategy) && (
                <Field label="Minimum ROAS" hint="0.01 to 1000, e.g. 1.8">
                  <Input value={config.campaign.roasGoal ?? ''} onChange={e => setCampaign({ roasGoal: e.target.value.trim() || undefined })} inputMode="decimal" placeholder="1.5" className="h-9" disabled={disabled} />
                </Field>
              )}
            </div>
          </Block>

          <Block title="Ad sets">
            <Field label="Name template" hint={`Tokens: ${TOKENS_ADSET}`}>
              <Input value={config.adset.nameTemplate} onChange={e => setAdset({ nameTemplate: e.target.value })} maxLength={LIMITS.nameLength} className="h-9 font-mono text-xs" disabled={disabled} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Optimisation goal">
                <Select value={config.adset.optimizationGoal} onValueChange={v => setAdset({ optimizationGoal: v as OptimizationGoal })} disabled={disabled}>
                  <SelectTrigger className="h-9 w-full text-sm" aria-label="Optimisation goal"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPTIMIZATION_GOALS.map(g => <SelectItem key={g} value={g}>{optimizationGoalLabel(g)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {config.adset.optimizationGoal === 'OFFSITE_CONVERSIONS' && (
                <Field label="Conversion event">
                  <Select value={config.adset.conversionEvent} onValueChange={v => setAdset({ conversionEvent: v as ConversionEvent })} disabled={disabled}>
                    <SelectTrigger className="h-9 w-full text-sm" aria-label="Conversion event"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONVERSION_EVENTS.map(e => <SelectItem key={e} value={e}>{EVENT_LABELS[e]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <Switch
                id="al-placements"
                checked={config.adset.advantagePlacements}
                onCheckedChange={v => setAdset({ advantagePlacements: v })}
                disabled={disabled}
                className="data-[state=checked]:bg-teal-600"
              />
              <Label htmlFor="al-placements" className="text-xs text-slate-700">
                Advantage+ placements
                <span className="block text-[11px] font-normal text-slate-500">Off: Facebook & Instagram feed, stories and reels.</span>
              </Label>
            </div>
            <AudiencesEditor audiences={config.adset.audiences} onChange={audiences => setAdset({ audiences })} disabled={disabled} />
          </Block>

          <Block title="Ad & status" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Call to action">
                <Select value={config.ad.callToAction} onValueChange={v => props.onChange({ ...config, ad: { callToAction: v as CallToAction } })} disabled={disabled}>
                  <SelectTrigger className="h-9 w-full text-sm" aria-label="Call to action"><SelectValue /></SelectTrigger>
                  <SelectContent>{CALLS_TO_ACTION.map(c => <SelectItem key={c} value={c}>{CTA_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Status of everything created" hint={config.status === 'ACTIVE' ? 'Ads start spending as soon as Meta approves them.' : 'Review on Meta, then turn on.'}>
                <StatusSelect value={config.status} onChange={props.onStatus} disabled={disabled} />
              </Field>
            </div>
          </Block>
        </div>
      )}
    </div>
  );
}

export function StatusSelect({ value, onChange, disabled }: { value: NodeStatus; onChange: (s: NodeStatus) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as NodeStatus)} disabled={disabled}>
      <SelectTrigger className={cn('h-9 w-full text-sm', value === 'ACTIVE' && 'border-emerald-300 bg-emerald-50 text-emerald-800')} aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="PAUSED">Paused</SelectItem>
        <SelectItem value="ACTIVE">Active</SelectItem>
      </SelectContent>
    </Select>
  );
}
