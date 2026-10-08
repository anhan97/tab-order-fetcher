/**
 * Campaign → Ad sets → Ads, read from the ONE plan (§12.2). Scrolls
 * horizontally inside its own box on narrow screens.
 */
import { useState } from 'react';
import { ChevronDown, Folder, Layers, Pencil, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  bidStrategyLabel,
  needsBidAmount,
  needsRoasGoal,
  type ExistingCampaign,
  type LaunchPresetConfig
} from '@contract/ads-launcher';
import { audienceText, campaignBudgetText, formatMoney, objectiveLabel } from '../lib/format';
import { bidHolder, type LaunchTarget, type PlannedAdset, type StructurePlan } from '../lib/structure';
import { PoolThumb } from './PoolThumb';

export interface StructureDiagramProps {
  plan: StructurePlan;
  config: LaunchPresetConfig;
  target: LaunchTarget;
  existingCampaign: ExistingCampaign | null;
  currency?: string | null;
  onEditAdset?: (adset: PlannedAdset) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function StructureDiagram(props: StructureDiagramProps) {
  const { plan, config, target, existingCampaign, currency, compact } = props;
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [openCampaigns, setOpenCampaigns] = useState<Record<number, boolean>>({});

  const holder = bidHolder(config, target, existingCampaign);
  const strategy = config.campaign.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP';
  const goal = config.adset.optimizationGoal;
  const existing = target.mode === 'existing' ? target : null;
  const existingAdset = existing?.adsetId ? existingCampaign?.adsets.find(a => a.externalId === existing.adsetId) ?? null : null;

  const maxCampaigns = compact ? 3 : 8;
  const maxAdsets = compact ? 4 : 10;
  const maxAds = compact ? 8 : 14;
  const campaigns = showAllCampaigns ? plan.campaigns : plan.campaigns.slice(0, maxCampaigns);

  // Campaign line: budget + bid.
  const campaignBudget = existing
    ? existingCampaign ? campaignBudgetText(existingCampaign, currency) : 'Existing campaign'
    : config.campaign.budgetMode === 'CBO'
      ? `CBO ${formatMoney(config.campaign.dailyBudget, currency)}/day`
      : 'ABO · budget on ad sets';
  const campaignBid =
    holder.mode === 'CBO'
      ? holder.strategy
        ? bidStrategyLabel(holder.strategy, goal)
        : 'Bid strategy unknown'
      : null;

  // Ad set line: ABO budget, and the amount the bid strategy needs.
  const adsetStrategy = holder.mode === 'ABO' ? strategy : holder.strategy ?? strategy;
  const adsetBudget = holder.mode === 'ABO' ? `${formatMoney(config.campaign.dailyBudget, currency)}/day` : null;
  const adsetBid = needsBidAmount(adsetStrategy)
    ? `${bidStrategyLabel(adsetStrategy)} ${config.campaign.bidAmount ? formatMoney(config.campaign.bidAmount, currency) : '—'}`
    : needsRoasGoal(adsetStrategy)
      ? `ROAS goal ${config.campaign.roasGoal ?? '—'}`
      : holder.mode === 'ABO'
        ? bidStrategyLabel(adsetStrategy, goal)
        : null;

  if (plan.campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        The plan appears here once the pool has items.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-900">Plan</span>
        <span><b>{plan.counts.campaigns}</b> campaign{plan.counts.campaigns === 1 ? '' : 's'}</span>
        <span><b>{plan.counts.adsets}</b> ad set{plan.counts.adsets === 1 ? '' : 's'}</span>
        <span><b>{plan.counts.ads}</b> ad{plan.counts.ads === 1 ? '' : 's'}</span>
        <span className="text-slate-400">from {plan.counts.items} item{plan.counts.items === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <div className={cn('space-y-3 p-3', compact ? 'min-w-[520px]' : 'min-w-[680px]')}>
          <div className="grid grid-cols-[13rem_2.375rem_15rem_1.5rem_minmax(0,1fr)] text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Campaign</span><span /><span>Ad sets</span><span /><span>Ads</span>
          </div>
          {campaigns.map(c => {
            const open = openCampaigns[c.index] ?? false;
            const adsets = open ? c.adsets : c.adsets.slice(0, maxAdsets);
            return (
              <div key={c.index} className="grid grid-cols-[13rem_1.5rem_minmax(0,1fr)] items-start">
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-2.5">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                    <Folder className="h-3 w-3" /> {existing ? 'Existing' : 'New'} campaign
                  </p>
                  <p className="mt-0.5 break-words text-xs font-semibold leading-snug text-slate-900">{existing ? existingCampaign?.name ?? '—' : c.name}</p>
                  <p className="mt-1 text-[11px] text-slate-600">{existing ? objectiveLabel(existingCampaign?.objective) : objectiveLabel(config.campaign.objective)}</p>
                  <p className="text-[11px] text-slate-600">{campaignBudget}</p>
                  {campaignBid && <p className="text-[11px] text-slate-600">{campaignBid}</p>}
                  <p className="mt-1 text-[10px] text-slate-500">{c.adsets.length} ad sets · {c.adCount} ads</p>
                </div>
                <span className="mt-6 h-px w-full bg-slate-300" />
                <div className="space-y-2 border-l-2 border-slate-200 pl-0">
                  {adsets.map(a => (
                    <div key={a.key} className="grid grid-cols-[0.75rem_15rem_1.5rem_minmax(0,1fr)] items-center">
                      <span className="h-px w-full bg-slate-300" />
                      <div className={cn('rounded-lg border p-2', a.overridden ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-slate-50')}>
                        <div className="flex items-start justify-between gap-1">
                          <p className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            <Layers className="mr-1 inline h-3 w-3" />
                            {existingAdset ? 'Existing ad set' : `Ad set ${a.index + 1}`}
                            {a.overridden && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] text-violet-700">Edited</span>}
                          </p>
                          {props.onEditAdset && (
                            <button
                              type="button"
                              className="-m-1 shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-teal-700 disabled:opacity-40"
                              onClick={() => props.onEditAdset!(a)}
                              disabled={props.disabled}
                              title="Choose the creatives of this ad set"
                              aria-label={`Edit ${a.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="break-words text-[11px] font-medium leading-snug text-slate-900">{existingAdset ? existingAdset.name : a.name}</p>
                        {!existingAdset && (
                          <>
                            <p className="mt-0.5 flex items-start gap-1 text-[10px] text-slate-600"><Users className="mt-px h-3 w-3 shrink-0" /><span className="min-w-0 break-words">{audienceText(a.audience)}</span></p>
                            {(adsetBudget || adsetBid) && <p className="text-[10px] text-slate-600">{[adsetBudget, adsetBid].filter(Boolean).join(' · ')}</p>}
                          </>
                        )}
                      </div>
                      <span className="h-px w-full bg-slate-300" />
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {a.ads.slice(0, maxAds).map((ad, i) => (
                          <div key={`${ad.item.key}-${i}`} title={ad.name}>
                            <PoolThumb item={ad.item} size={compact ? 'xs' : 'sm'} />
                          </div>
                        ))}
                        {a.ads.length > maxAds && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">+{a.ads.length - maxAds}</span>}
                        <span className="ml-1 text-[10px] text-slate-400">{a.ads.length} ad{a.ads.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  ))}
                  {c.adsets.length > maxAdsets && (
                    <button
                      type="button"
                      className="ml-3 flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline"
                      onClick={() => setOpenCampaigns(s => ({ ...s, [c.index]: !open }))}
                    >
                      <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                      {open ? 'Show fewer ad sets' : `Show all ${c.adsets.length} ad sets`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {plan.campaigns.length > maxCampaigns && (
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline" onClick={() => setShowAllCampaigns(v => !v)}>
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAllCampaigns && 'rotate-180')} />
              {showAllCampaigns ? 'Show fewer campaigns' : `Show all ${plan.campaigns.length} campaigns`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
