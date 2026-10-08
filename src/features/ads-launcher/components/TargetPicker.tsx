/**
 * Where the ads go: a new campaign, or an existing one (optionally into one
 * of its existing ad sets) — §3.2 step 3, §8.4.
 */
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { bidStrategyLabel, type ExistingCampaign } from '@contract/ads-launcher';
import { campaignBudgetText } from '../lib/format';
import type { LaunchTarget } from '../lib/structure';
import { Field } from './setup-fields';

const NEW_ADSETS = '__new__';

export interface TargetPickerProps {
  target: LaunchTarget;
  onChange: (t: LaunchTarget) => void;
  campaigns: ExistingCampaign[];
  loading?: boolean;
  /** No ad account yet. */
  noAccount?: boolean;
  currency?: string | null;
  disabled?: boolean;
}

export function TargetPicker(props: TargetPickerProps) {
  const { target, campaigns, disabled } = props;
  const existing = target.mode === 'existing' ? target : null;
  const campaign = existing ? campaigns.find(c => c.externalId === existing.campaignId) ?? null : null;

  return (
    <div className="space-y-3">
      <RadioGroup
        value={target.mode}
        onValueChange={v => props.onChange(v === 'existing' ? { mode: 'existing', campaignId: null, adsetId: null } : { mode: 'new' })}
        className="flex flex-wrap gap-4"
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="new" id="al-target-new" />
          <Label htmlFor="al-target-new" className="text-sm">New campaign</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="existing" id="al-target-existing" disabled={props.noAccount} />
          <Label htmlFor="al-target-existing" className="text-sm">Existing campaign</Label>
        </div>
      </RadioGroup>

      {existing && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Campaign" aside={props.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}>
            <Select
              value={existing.campaignId ?? undefined}
              onValueChange={v => props.onChange({ mode: 'existing', campaignId: v, adsetId: null })}
              disabled={disabled || campaigns.length === 0}
            >
              <SelectTrigger className="h-9 w-full text-sm" aria-label="Existing campaign">
                <SelectValue placeholder={campaigns.length ? 'Pick a campaign' : props.loading ? 'Loading…' : 'No campaign in this ad account'} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {campaigns.map(c => (
                  <SelectItem key={c.externalId} value={c.externalId}>
                    <span className="flex min-w-0 flex-col">
                      <span className="max-w-[min(70vw,26rem)] truncate">{c.name}</span>
                      <span className="text-[10px] text-slate-500">
                        {c.status} · {campaignBudgetText(c, props.currency)} · {c.bidStrategy ? bidStrategyLabel(c.bidStrategy) : 'bid strategy unknown'} · {c.adsets.length} ad sets
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Ad set" hint={existing.adsetId ? 'The ads go into this ad set; the structure must make one ad set.' : 'New ad sets from the structure.'}>
            <Select
              value={existing.adsetId ?? NEW_ADSETS}
              onValueChange={v => props.onChange({ mode: 'existing', campaignId: existing.campaignId, adsetId: v === NEW_ADSETS ? null : v })}
              disabled={disabled || !campaign}
            >
              <SelectTrigger className="h-9 w-full text-sm" aria-label="Existing ad set"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={NEW_ADSETS}>New ad sets (from the structure)</SelectItem>
                {campaign?.adsets.map(a => (
                  <SelectItem key={a.externalId} value={a.externalId}>
                    <span className="block max-w-[min(70vw,26rem)] truncate">{a.name} · {a.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {campaign && (
            <p className="text-[11px] text-slate-500 md:col-span-2">
              {campaign.dailyBudget || campaign.lifetimeBudget
                ? `CBO campaign: the budget stays on the campaign${campaign.bidStrategy ? `, ad sets bid with ${bidStrategyLabel(campaign.bidStrategy)}` : ''}.`
                : 'ABO campaign: each new ad set gets the preset budget and bid strategy.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
