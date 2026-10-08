/**
 * Quick launch (§3.3): preset → ad account → pixel → page → landing page →
 * plan → Launch, without leaving the library. Setup comes from the user's
 * memory; one product per launch. "Customise in Ads Launcher" opens the full
 * wizard with the same pool, preset and account.
 */
import { useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2, Rocket, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { needsPixel, normalizePresetConfig, type CreativeDto, type PostRow } from '@contract/ads-launcher';
import { useActiveConfirm } from '../hooks/use-active-confirm';
import { useLauncherModel } from '../hooks/use-launcher-model';
import { useRunLaunch } from '../hooks/use-run-launch';
import { useSetupHandlers } from '../hooks/use-setup-handlers';
import { launcherLink } from '../lib/deep-link';
import { adsManagerUrl, budgetSummary, plural } from '../lib/format';
import { CUSTOM_LANDING } from '../lib/landing';
import { creativeToPoolItem, mergePool, postToPoolItem } from '../lib/pool';
import { readSetupMemory, useSetupMemory, writeSetupMemory } from '../lib/setup-memory';
import { structureLabel } from '../lib/structure';
import { initialWizardState, memoryOf, wizardReducer } from '../lib/wizard-state';
import { ActiveConfirmDialog } from './ActiveConfirmDialog';
import { IssuesList } from './IssuesList';
import { LaunchResults } from './LaunchResults';
import { PoolThumb } from './PoolThumb';
import { StructureDiagram } from './StructureDiagram';
import { AdAccountSelect, Field, LandingSelect, PageField, PixelField } from './setup-fields';

export interface QuickLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creatives?: CreativeDto[];
  posts?: PostRow[];
  productId?: string | null;
}

export function QuickLaunchDialog(props: QuickLaunchDialogProps) {
  const [busy, setBusy] = useState(false);
  const close = () => props.onOpenChange(false);
  return (
    <Dialog
      open={props.open}
      onOpenChange={open => {
        if (!open && busy) return; // never close while campaigns are being sent
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onInteractOutside={e => busy && e.preventDefault()}
        onEscapeKeyDown={e => busy && e.preventDefault()}
      >
        {props.open && <QuickLaunchBody {...props} onBusy={setBusy} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickLaunchBody({
  creatives,
  posts,
  productId,
  onBusy,
  onClose
}: QuickLaunchDialogProps & { onBusy: (busy: boolean) => void; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id ?? null;

  // The selection when the dialog opened; archived creatives cannot launch (§8.2).
  const [initial] = useState(() => {
    const active = (creatives ?? []).filter(c => c.status !== 'archived');
    return {
      pool: mergePool([], [...active.map(creativeToPoolItem), ...(posts ?? []).map(postToPoolItem)]),
      archived: (creatives ?? []).length - active.length
    };
  });
  const [state, dispatch] = useReducer(wizardReducer, undefined, () =>
    initialWizardState(readSetupMemory(userId), { pool: initial.pool, productId: productId ?? null })
  );

  const model = useLauncherModel(state, dispatch);
  const handlers = useSetupHandlers(state, dispatch, model.landingGroups);
  const active = useActiveConfirm(state, dispatch);
  const runner = useRunLaunch();
  useSetupMemory(userId, memoryOf(state));

  const run = runner.state;
  const locked = run.phase !== 'idle';
  const { config, pool, setup } = state;
  const postsOnly = pool.length > 0 && pool.every(i => i.kind === 'post');
  const pixelRequired = !!config && needsPixel(config.adset.optimizationGoal);

  // One product per launch (§3.3).
  const products = useMemo(() => [...new Set(pool.map(i => i.productId).filter(Boolean))], [pool]);
  const issues = [
    ...(products.length > 1 ? [`Quick launch takes one product at a time: ${products.length} products are selected`] : []),
    ...model.issues.all
  ];

  const launch = () =>
    active.guardLaunch(() => {
      onBusy(true);
      void runner.run(model.requests).finally(() => onBusy(false));
    });

  const customise = () => {
    if (userId) writeSetupMemory(userId, memoryOf(state)); // the wizard reads it on mount
    navigate(
      launcherLink({
        creativeIds: pool.filter(i => i.kind === 'creative').map(i => i.creativeId!),
        postIds: pool.filter(i => i.kind === 'post').map(i => i.postId!),
        presetId: state.presetId,
        accountId: setup.adAccountId || null
      })
    );
    onClose();
  };

  const creativesCount = pool.filter(i => i.kind === 'creative').length;
  const postsCount = pool.length - creativesCount;

  return (
    <>
      <DialogHeader className="space-y-1 border-b border-slate-200 px-4 py-3 pr-10 text-left sm:px-6">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4 text-teal-600" /> Quick launch
        </DialogTitle>
        <DialogDescription className="text-xs">
          {[creativesCount ? plural(creativesCount, 'creative') : '', postsCount ? plural(postsCount, 'post') : ''].filter(Boolean).join(' · ') || 'Nothing selected'}
          {model.product?.title ? ` · ${model.product.title}` : ''}
          {initial.archived ? ` · ${plural(initial.archived, 'archived creative')} left out` : ''}
        </DialogDescription>
        {pool.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pt-1">
            {pool.slice(0, 20).map((item, i) => <PoolThumb key={item.key} item={item} order={i + 1} size="xs" />)}
            {pool.length > 20 && <span className="self-center text-[11px] text-slate-500">+{pool.length - 20}</span>}
          </div>
        )}
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        <LaunchResults run={run} adAccountId={setup.adAccountId} compact />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preset" className="sm:col-span-2" hint={config ? `${structureLabel(config.structure)} · ${budgetSummary(config, model.currency)} · ${config.status === 'ACTIVE' ? 'Active' : 'Paused'}` : undefined}>
            <Select
              value={state.presetId ?? undefined}
              onValueChange={id => {
                const p = model.presets.find(x => x.id === id);
                const c = p ? normalizePresetConfig(p.config) : null;
                if (p && c) dispatch({ type: 'preset', presetId: p.id, config: c });
              }}
              disabled={locked || model.presets.length === 0}
            >
              <SelectTrigger className="h-9 w-full text-sm" aria-label="Preset">
                <SelectValue placeholder={model.presetsLoading ? 'Loading presets…' : 'Pick a preset'} />
              </SelectTrigger>
              <SelectContent>
                {model.presets.map(p => {
                  const c = normalizePresetConfig(p.config);
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={!c}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{p.name}</span>
                        {c && <span className="shrink-0 font-mono text-[10px] text-slate-400">{structureLabel(c.structure)}</span>}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>

          <Field label={<>Ad account<span className="text-rose-500"> *</span></>} className="sm:col-span-2">
            <AdAccountSelect accounts={model.accounts} value={setup.adAccountId} onChange={handlers.onAccount} loading={model.accountsLoading} disabled={locked} />
          </Field>
          {model.accountsError && <p className="text-xs text-rose-600 sm:col-span-2">Could not load ad accounts: {model.accountsError}</p>}
          {model.optionsError && <p className="text-xs text-rose-600 sm:col-span-2">Could not load this ad account: {model.optionsError}</p>}

          <PixelField options={model.options} value={setup.pixelId} onChange={pixelId => handlers.onSetup({ pixelId })} required={pixelRequired} loading={model.optionsLoading} disabled={locked} />
          <PageField options={model.options} value={setup.pageId} onChange={pageId => handlers.onSetup({ pageId })} loading={model.optionsLoading} disabled={locked} />

          {!postsOnly && (
            <Field
              label={<>Landing page<span className="text-rose-500"> *</span></>}
              className="sm:col-span-2"
              hint={setup.landingUrl && state.landingId !== CUSTOM_LANDING ? `${setup.landingUrl} · display link ${setup.displayLink || '—'}` : undefined}
              error={model.landingError ? `Could not load store pages: ${model.landingError}` : undefined}
            >
              <LandingSelect
                groups={model.landingGroups}
                value={state.landingId}
                onChange={handlers.onLanding}
                loading={model.landingLoading}
                noProduct={!model.product}
                disabled={locked}
              />
              {state.landingId === CUSTOM_LANDING && (
                <div className="grid gap-2 pt-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <Input value={setup.landingUrl} onChange={e => handlers.onLandingUrl(e.target.value)} placeholder="https://your-store.com/…" className="h-9" disabled={locked} aria-label="Landing URL" />
                  <Input value={setup.displayLink} onChange={e => handlers.onSetup({ displayLink: e.target.value })} placeholder="Display link" className="h-9" disabled={locked} aria-label="Display link" maxLength={255} />
                </div>
              )}
            </Field>
          )}
        </div>

        {config && model.plan && (
          <StructureDiagram plan={model.plan} config={config} target={state.target} existingCampaign={null} currency={model.currency} compact />
        )}
        {run.phase === 'idle' && <IssuesList issues={issues} okText="Ready to launch." />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="h-9 text-xs" onClick={customise} disabled={run.phase === 'running'}>
          <SlidersHorizontal /> Customise in Ads Launcher
        </Button>
        <div className="flex items-center gap-2">
          {run.phase === 'idle' && (
            <Button
              type="button"
              size="sm"
              className="h-9 bg-teal-600 text-white hover:bg-teal-700"
              onClick={launch}
              disabled={issues.length > 0 || model.requests.length === 0}
            >
              <Rocket /> Launch {model.plan ? plural(model.plan.counts.ads, 'ad') : ''}
            </Button>
          )}
          {run.phase === 'running' && (
            <Button type="button" size="sm" className="h-9 bg-teal-600 text-white" disabled>
              <Loader2 className="animate-spin" /> Launching {run.completed}/{run.total}…
            </Button>
          )}
          {run.phase === 'done' && (
            <>
              {setup.adAccountId && (
                <Button type="button" variant="outline" size="sm" className="h-9" asChild>
                  <a href={adsManagerUrl(setup.adAccountId)} target="_blank" rel="noreferrer">
                    Ads Manager <ExternalLink />
                  </a>
                </Button>
              )}
              <Button type="button" size="sm" className="h-9 bg-teal-600 text-white hover:bg-teal-700" onClick={onClose}>
                Done
              </Button>
            </>
          )}
        </div>
      </div>

      <ActiveConfirmDialog {...active.dialog} ads={model.plan?.counts.ads} />
    </>
  );
}
