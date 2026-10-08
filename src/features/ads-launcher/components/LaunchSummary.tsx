/**
 * "What will be launched" (§3.2 step 4): one row per decision, each with an
 * Edit button that jumps back to the step that owns it.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  bidStrategyLabel,
  needsPixel,
  type ExistingCampaign,
  type LaunchPresetConfig,
  type LauncherAdAccount,
  type LauncherOptions
} from '@contract/ads-launcher';
import {
  EVENT_LABELS,
  actId,
  audienceText,
  bidSummary,
  campaignBudgetText,
  ctaLabel,
  formatMoney,
  goalLabel,
  objectiveLabel
} from '../lib/format';
import type { PoolItem } from '../lib/pool';
import type { LaunchSetup, LaunchTarget, StructurePlan } from '../lib/structure';
import { STEP } from '../lib/wizard-state';
import { PoolThumb } from './PoolThumb';
import { DemoBadge, PageAvatar } from './setup-fields';

export interface LaunchSummaryProps {
  account: LauncherAdAccount | null;
  options: LauncherOptions | null;
  setup: LaunchSetup;
  pool: PoolItem[];
  plan: StructurePlan;
  config: LaunchPresetConfig;
  target: LaunchTarget;
  existingCampaign: ExistingCampaign | null;
  currency: string | null;
  onEdit: (step: number) => void;
  disabled?: boolean;
}

const LIST = 5;

function Row({ label, children, onEdit, disabled }: { label: string; children: ReactNode; onEdit?: () => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 border-b border-slate-100 px-3 py-2.5 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
      <p className="text-xs font-semibold text-slate-500 sm:pt-0.5">{label}</p>
      <div className="col-span-2 row-start-2 min-w-0 text-sm text-slate-800 sm:col-span-1 sm:row-start-1 sm:col-start-2">{children}</div>
      {onEdit && (
        <Button type="button" variant="ghost" size="sm" className="col-start-2 row-start-1 h-7 justify-self-end px-2 text-xs text-teal-700 sm:col-start-3" onClick={onEdit} disabled={disabled}>
          <Pencil className="!size-3" /> Edit
        </Button>
      )}
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-xs text-slate-500">{children}</span>;

export function LaunchSummary(props: LaunchSummaryProps) {
  const { account, options, setup, plan, config, target, existingCampaign, currency, onEdit, disabled } = props;
  const page = options?.pages.find(p => p.externalId === setup.pageId) ?? null;
  const pixel = options?.pixels.find(p => p.externalId === setup.pixelId) ?? null;
  const existing = target.mode === 'existing' ? target : null;
  const existingAdset = existing?.adsetId ? existingCampaign?.adsets.find(a => a.externalId === existing.adsetId) ?? null : null;
  const pixelMissing = needsPixel(config.adset.optimizationGoal) && !setup.pixelId && !existingAdset;
  const fromCreative = props.pool.some(i => i.kind === 'creative');
  const adsets = plan.campaigns.flatMap(c => c.adsets);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">What will be launched</p>

      <Row label="Ad account" onEdit={() => onEdit(STEP.setup)} disabled={disabled}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{account?.name ?? '—'}</span>
          {setup.adAccountId && <span className="font-mono text-xs text-slate-500">{actId(setup.adAccountId)}</span>}
          {account?.isDemo && <DemoBadge />}
          {account?.currency && <Muted>{account.currency}</Muted>}
        </span>
      </Row>

      <Row label="Facebook page" onEdit={() => onEdit(STEP.setup)} disabled={disabled}>
        <span className="flex items-center gap-2">
          <PageAvatar name={page?.name} pictureUrl={page?.pictureUrl} className="h-6 w-6" />
          <span className="truncate">{page?.name ?? (setup.pageId || '—')}</span>
        </span>
      </Row>

      <Row label="Pixel" onEdit={() => onEdit(STEP.setup)} disabled={disabled}>
        {setup.pixelId ? (
          <span>{pixel?.name ?? 'Pixel'} <span className="font-mono text-xs text-slate-500">{setup.pixelId}</span></span>
        ) : (
          <Muted>None</Muted>
        )}
        {pixelMissing && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {goalLabel(config.adset.optimizationGoal)} optimisation needs a pixel.
          </p>
        )}
      </Row>

      <Row label={`Pool · ${props.pool.length}`} onEdit={() => onEdit(STEP.creatives)} disabled={disabled}>
        <div className="flex flex-wrap gap-1.5">
          {props.pool.slice(0, 24).map((item, i) => <PoolThumb key={item.key} item={item} order={i + 1} size="sm" />)}
          {props.pool.length > 24 && <span className="self-center text-xs text-slate-500">+{props.pool.length - 24}</span>}
        </div>
      </Row>

      <Row label={`Campaign${plan.counts.campaigns === 1 ? '' : 's'} · ${plan.counts.campaigns}`} onEdit={() => onEdit(STEP.structure)} disabled={disabled}>
        {existing ? (
          <p>
            <span className="font-medium">{existingCampaign?.name ?? '—'}</span> <Muted>existing · {existingCampaign ? `${objectiveLabel(existingCampaign.objective)} · ${campaignBudgetText(existingCampaign, currency)}${existingCampaign.bidStrategy ? ` · ${bidStrategyLabel(existingCampaign.bidStrategy)}` : ''}` : ''}</Muted>
          </p>
        ) : (
          <ul className="space-y-0.5">
            {plan.campaigns.slice(0, LIST).map(c => (
              <li key={c.index} className="break-words">
                <span className="font-medium">{c.name}</span>{' '}
                <Muted>
                  {objectiveLabel(config.campaign.objective)} ·{' '}
                  {config.campaign.budgetMode === 'CBO' ? `CBO ${formatMoney(config.campaign.dailyBudget, currency)}/day · ${bidSummary(config, currency)}` : 'ABO'}
                </Muted>
              </li>
            ))}
            {plan.campaigns.length > LIST && <li><Muted>+{plan.campaigns.length - LIST} more</Muted></li>}
          </ul>
        )}
      </Row>

      <Row label={`Ad set${plan.counts.adsets === 1 ? '' : 's'} · ${plan.counts.adsets}`} onEdit={() => onEdit(STEP.structure)} disabled={disabled}>
        {existingAdset ? (
          <p><span className="font-medium">{existingAdset.name}</span> <Muted>existing ad set</Muted></p>
        ) : (
          <ul className="space-y-1">
            {adsets.slice(0, LIST).map(a => (
              <li key={a.key} className="break-words">
                <span className="font-medium">{a.name}</span>
                <span className="block text-xs text-slate-500">
                  {audienceText(a.audience)} · {config.adset.advantagePlacements ? 'Advantage+ placements' : 'Feeds, stories & reels'} · {goalLabel(config.adset.optimizationGoal)}
                  {config.adset.optimizationGoal === 'OFFSITE_CONVERSIONS' ? ` (${EVENT_LABELS[config.adset.conversionEvent]})` : ''}
                  {config.campaign.budgetMode === 'ABO' || (existing && !(existingCampaign?.dailyBudget || existingCampaign?.lifetimeBudget))
                    ? ` · ${formatMoney(config.campaign.dailyBudget, currency)}/day · ${bidSummary(config, currency)}`
                    : ''}
                </span>
              </li>
            ))}
            {adsets.length > LIST && <li><Muted>+{adsets.length - LIST} more</Muted></li>}
          </ul>
        )}
      </Row>

      <Row label={`Ads · ${plan.counts.ads}`} onEdit={() => onEdit(STEP.structure)} disabled={disabled}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{ctaLabel(config.ad.callToAction)}</span>
          <span className={config.status === 'ACTIVE' ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800' : 'rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700'}>
            {config.status}
          </span>
        </span>
      </Row>

      <Row label="Destination" onEdit={() => onEdit(STEP.setup)} disabled={disabled}>
        {fromCreative ? (
          <div className="min-w-0 space-y-0.5">
            <p className="break-all">{setup.landingUrl || '—'}</p>
            <p className="text-xs text-slate-500">Display link: {setup.displayLink || '—'}</p>
          </div>
        ) : (
          <Muted>Each post keeps its own link.</Muted>
        )}
        <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{setup.urlTags || 'No URL parameters'}</p>
      </Row>
    </div>
  );
}
