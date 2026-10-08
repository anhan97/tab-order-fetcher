/**
 * Ads Launcher — 4-step wizard (§3.2): Setup → Creatives → Structure → Review.
 *
 * One reducer holds the state; ONE plan (planStructure, via
 * useLauncherModel) feeds the diagram, the review and the launch requests.
 * Title, ad account and steps stick to the top; Back / Next stick to the
 * bottom and sit in the flow, so they never cover a field.
 *
 * Deep link: /ads-launcher?creatives=a,b&posts=123_456&preset=<id>&account=<id>
 * — read once, then removed from the URL.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Lock, Rocket, RotateCcw, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { needsPixel, type CreativeDto, type PostRow } from '@contract/ads-launcher';
import { ActiveConfirmDialog } from '../components/ActiveConfirmDialog';
import { StepCreatives } from '../components/StepCreatives';
import { StepReview } from '../components/StepReview';
import { StepSetup } from '../components/StepSetup';
import { StepStructure } from '../components/StepStructure';
import { WizardStepper } from '../components/WizardStepper';
import { AdAccountSelect } from '../components/setup-fields';
import { useActiveConfirm } from '../hooks/use-active-confirm';
import { useLauncherModel } from '../hooks/use-launcher-model';
import { lookupPosts, usePoolSources } from '../hooks/use-pool-sources';
import { usePresetActions } from '../hooks/use-preset-actions';
import { useCreativesByIds, launcherKeys, useStoreKey } from '../hooks/queries';
import { useRunLaunch } from '../hooks/use-run-launch';
import { useSetupHandlers } from '../hooks/use-setup-handlers';
import { hasLauncherParams, parseLauncherLink } from '../lib/deep-link';
import { adsManagerUrl, plural } from '../lib/format';
import { creativeToPoolItem, postToPoolItem } from '../lib/pool';
import { readSetupMemory, useSetupMemory } from '../lib/setup-memory';
import { STEP, WIZARD_STEPS, initialWizardState, memoryOf, wizardReducer } from '../lib/wizard-state';

const STEP_HINTS = ['Pixel, page, landing page', 'Pick creatives or posts', 'Preset, campaigns, ad sets', 'Check and launch'];
const STEPS = WIZARD_STEPS.map((label, i) => ({ label, hint: STEP_HINTS[i] }));
const LAUNCHER_PARAMS = ['creatives', 'posts', 'preset', 'account'];

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <Store className="mx-auto mb-3 h-8 w-8 text-teal-600" />
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{children}</p>
    </div>
  );
}

export function AdsLauncherPage() {
  const { user, activeStore, canInStore } = useAuth();
  if (!user) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!activeStore) return <Notice title="Pick a store first">The launcher works on the active store: choose one in the sidebar.</Notice>;
  if (!canInStore('manage')) {
    return <Notice title="You cannot launch ads in this store">Launching needs manage access to the active store. Ask its owner, or switch store in the sidebar.</Notice>;
  }
  // A new store (or user) starts a fresh wizard: pools and options are store-scoped.
  return <AdsLauncherWizard key={`${user.id}:${activeStore.storeDomain}`} userId={user.id} />;
}

function AdsLauncherWizard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const storeKey = useStoreKey();
  const topRef = useRef<HTMLDivElement>(null);

  // ─── Deep link (read once, then removed from the URL) ──────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const [deep] = useState(() => parseLauncherLink(searchParams));
  const deepCount = deep.creativeIds.length + deep.postIds.length;

  const [state, dispatch] = useReducer(wizardReducer, undefined, () => {
    const memory = readSetupMemory(userId);
    const adAccountId = deep.accountId ?? memory.adAccountId ?? '';
    return initialWizardState(
      { ...memory, adAccountId, presetId: deep.presetId ?? memory.presetId },
      { step: deepCount > 0 && adAccountId ? STEP.structure : STEP.setup }
    );
  });

  useEffect(() => {
    if (!hasLauncherParams(searchParams)) return;
    const next = new URLSearchParams(searchParams);
    LAUNCHER_PARAMS.forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const deepCreativesQ = useCreativesByIds(deep.creativeIds);
  const deepPostsQ = useQuery({
    queryKey: [...launcherKeys.all, storeKey, 'deep-posts', deep.postIds.join(',')],
    queryFn: () => lookupPosts(deep.postIds),
    enabled: deep.postIds.length > 0,
    staleTime: Infinity,
    retry: 1
  });
  const [deepLoaded, setDeepLoaded] = useState(deepCount === 0);
  useEffect(() => {
    if (deepLoaded) return;
    const creativesReady = deep.creativeIds.length === 0 || deepCreativesQ.isSuccess || deepCreativesQ.isError;
    const postsReady = deep.postIds.length === 0 || deepPostsQ.isSuccess || deepPostsQ.isError;
    if (!creativesReady || !postsReady) return;
    const byId = new Map<string, CreativeDto>((deepCreativesQ.data ?? []).map(c => [c.id, c]));
    const found = deep.creativeIds.map(id => byId.get(id)).filter((c): c is CreativeDto => !!c);
    const active = found.filter(c => c.status === 'active');
    const posts = deepPostsQ.data?.items ?? [];
    dispatch({ type: 'pool/add', items: [...active.map(creativeToPoolItem), ...posts] });
    const missing = deep.creativeIds.length - found.length;
    const archived = found.length - active.length;
    if (missing || archived || deepPostsQ.isError) {
      toast({
        title: 'Some items were left out',
        description: [
          missing ? `${plural(missing, 'creative')} not found` : '',
          archived ? `${plural(archived, 'archived creative')} (restore in the library to launch)` : '',
          deepPostsQ.isError ? 'posts could not be loaded' : ''
        ].filter(Boolean).join(' · ')
      });
    }
    setDeepLoaded(true);
  }, [deepLoaded, deep, deepCreativesQ.isSuccess, deepCreativesQ.isError, deepCreativesQ.data, deepPostsQ.isSuccess, deepPostsQ.isError, deepPostsQ.data, toast]);

  // ─── Model ────────────────────────────────────────────────────────────────
  const model = useLauncherModel(state, dispatch);
  const handlers = useSetupHandlers(state, dispatch, model.landingGroups);
  const sources = usePoolSources(model.product?.id ?? null);
  const presetActions = usePresetActions(state, dispatch, model.preset);
  const active = useActiveConfirm(state, dispatch);
  const runner = useRunLaunch();
  useSetupMemory(userId, memoryOf(state));

  const run = runner.state;
  const locked = run.phase !== 'idle';
  const running = run.phase === 'running';
  const { config, pool, setup } = state;
  const page = model.options?.pages.find(p => p.externalId === setup.pageId) ?? null;
  const existingAdset = state.target.mode === 'existing' && !!state.target.adsetId;
  const pixelRequired = !!config && needsPixel(config.adset.optimizationGoal) && !existingAdset;
  const postsOnly = pool.length > 0 && pool.every(i => i.kind === 'post');
  const structureIssues = [...model.issues.plan, ...model.issues.target];
  const nothingCreated = !!run.totals && run.totals.ok === 0 && run.totals.campaignsCreated === 0 && run.totals.adsetsCreated === 0;

  // ─── Steps ────────────────────────────────────────────────────────────────
  const gates = [model.issues.setup.length === 0, pool.length > 0, structureIssues.length === 0 && !!model.plan];
  let reach = 0;
  while (reach < gates.length && gates[reach]) reach++;
  const maxReachable = Math.max(reach, state.step);
  const step = state.step;
  const blocker = step < 3 ? (step === STEP.setup ? model.issues.setup[0] : step === STEP.creatives ? (pool.length ? null : 'Pick at least one creative or post') : structureIssues[0]) : model.issues.all[0];
  const canNext = step < 3 && gates[step];

  const go = (s: number) => {
    dispatch({ type: 'step', step: s });
    topRef.current?.scrollIntoView?.({ block: 'start' });
  };

  const launch = () =>
    active.guardLaunch(() => {
      topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      void runner.run(model.requests);
    });

  const launchMore = () => {
    runner.reset();
    dispatch({ type: 'launchMore' });
    topRef.current?.scrollIntoView?.({ block: 'start' });
  };

  const toggleCreative = (c: CreativeDto) => dispatch({ type: 'pool/toggle', item: creativeToPoolItem(c) });
  const togglePost = (p: PostRow) => dispatch({ type: 'pool/toggle', item: postToPoolItem(p) });
  const addPostIds = async (postIds: string[]) => {
    const { items, found } = await sources.lookup(postIds);
    dispatch({ type: 'pool/add', items });
    return { added: items.length, unknown: postIds.length - found.length };
  };

  const counts = model.plan?.counts;

  return (
    <div ref={topRef} className="-m-4 flex min-h-[calc(100%+2rem)] flex-col sm:-m-8 sm:min-h-[calc(100%+4rem)]">
      {/* Top: title, ad account, steps */}
      <header className="sticky -top-4 z-20 sm:-top-8 space-y-2.5 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
              <Rocket className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">New launch</p>
              <p className="truncate text-[11px] text-slate-500">
                Step {step + 1} of {STEPS.length} · {STEPS[step].hint}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:w-80">
            <AdAccountSelect
              accounts={model.accounts}
              value={setup.adAccountId}
              onChange={handlers.onAccount}
              loading={model.accountsLoading}
              disabled={locked}
              className="w-full"
            />
          </div>
        </div>
        {model.accountsError && <p className="text-xs text-rose-600">Could not load ad accounts: {model.accountsError}</p>}
        {!model.accountsLoading && !model.accountsError && model.accounts.length === 0 && (
          <p className="text-xs text-amber-700">No ad account you can launch into. Connect Facebook or ask an admin for access.</p>
        )}
        <WizardStepper steps={STEPS} current={step} maxReachable={maxReachable} onStep={go} disabled={locked} />
      </header>

      {/* Body */}
      <div className="flex-1 px-4 py-5 sm:px-8">
        {!deepLoaded && (
          <p className="mx-auto mb-4 flex max-w-6xl items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the creatives from the link…
          </p>
        )}

        {step === STEP.setup && (
          <StepSetup
            setup={setup}
            landingId={state.landingId}
            product={model.product}
            productInferred={model.productInferred}
            products={model.products}
            productsLoading={model.productsLoading}
            onProduct={handlers.onProduct}
            options={model.options}
            optionsLoading={model.optionsLoading}
            optionsError={model.optionsError}
            pixelRequired={pixelRequired}
            groups={model.landingGroups}
            landingLoading={model.landingLoading}
            landingError={model.landingError}
            postsOnly={postsOnly}
            issues={model.issues.setup}
            onSetup={handlers.onSetup}
            onLanding={handlers.onLanding}
            onLandingUrl={handlers.onLandingUrl}
            disabled={locked}
          />
        )}

        {step === STEP.creatives && (
          <StepCreatives
            pool={pool}
            onRemove={key => dispatch({ type: 'pool/remove', key })}
            onClear={() => dispatch({ type: 'pool/set', items: [] })}
            needsProduct={!model.product}
            products={model.products}
            productsLoading={model.productsLoading}
            onProduct={handlers.onProduct}
            creatives={{
              ...sources.creatives,
              onToggle: toggleCreative,
              onSelectMany: cs => dispatch({ type: 'pool/add', items: cs.map(creativeToPoolItem) }),
              onDeselectMany: cs => {
                const drop = new Set(cs.map(c => c.id));
                dispatch({ type: 'pool/set', items: pool.filter(i => !drop.has(i.key)) });
              },
              page: page ? { name: page.name, pictureUrl: page.pictureUrl } : null,
              callToAction: config?.ad.callToAction ?? null
            }}
            posts={{ ...sources.posts, onToggle: togglePost, productTitle: model.product?.title ?? null }}
            onAddPostIds={addPostIds}
            disabled={locked}
          />
        )}

        {step === STEP.structure && (
          <StepStructure
            presets={model.presets}
            presetsLoading={model.presetsLoading}
            presetsFallback={model.presetsFallback}
            selectedPresetId={state.presetId}
            presetName={model.preset?.name ?? null}
            dirty={state.dirty}
            onSelectPreset={presetActions.select}
            onDeletePreset={p => void presetActions.remove(p)}
            onRestoreStarters={() => void presetActions.restoreStarters()}
            restoring={presetActions.restoring}
            config={config}
            onConfig={c => dispatch({ type: 'config', config: c })}
            onStatus={active.requestStatus}
            canUpdate={!!model.preset && !model.presetsFallback}
            saving={presetActions.saving}
            onSaveToPreset={() => void presetActions.saveToPreset()}
            onSaveAsNew={name => void presetActions.saveAsNew(name)}
            target={state.target}
            onTarget={target => dispatch({ type: 'target', target })}
            campaigns={model.options?.campaigns ?? []}
            campaignsLoading={model.optionsLoading}
            noAccount={!setup.adAccountId}
            existingCampaign={model.existingCampaign}
            currency={model.currency}
            plan={model.plan}
            pool={pool}
            onOverride={(key, itemKeys) => dispatch({ type: 'override', key, itemKeys })}
            issues={structureIssues}
            disabled={locked}
          />
        )}

        {step === STEP.review && (
          <StepReview
            summary={
              model.plan && config
                ? {
                    account: model.account,
                    options: model.options,
                    setup,
                    pool,
                    plan: model.plan,
                    config,
                    target: state.target,
                    existingCampaign: model.existingCampaign,
                    currency: model.currency,
                    onEdit: go
                  }
                : null
            }
            copy={{
              items: pool,
              copy: state.copy,
              onCopy: (creativeId, patch) => dispatch({ type: 'copy', creativeId, patch }),
              onReset: creativeId => dispatch({ type: 'copy/reset', creativeId }),
              page: page ? { name: page.name, pictureUrl: page.pictureUrl } : null,
              displayLink: setup.displayLink,
              callToAction: config?.ad.callToAction ?? 'SHOP_NOW'
            }}
            startTime={state.startTime}
            onStartTime={value => dispatch({ type: 'startTime', value })}
            status={config?.status ?? 'PAUSED'}
            onStatus={active.requestStatus}
            issues={model.issues.all}
            run={run}
            adAccountId={setup.adAccountId}
            locked={locked}
          />
        )}
      </div>

      {/* Bottom: Back / Next — sticky, in flow, never over a field */}
      <footer className="sticky -bottom-4 z-20 sm:-bottom-8 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => go(step - 1)} disabled={step === 0 || locked}>
            <ArrowLeft /> <span className="hidden sm:inline">Back</span>
          </Button>

          <div className="min-w-0 flex-1 text-xs text-slate-600">
            {running ? (
              <span className="flex items-center gap-1.5 truncate"><Lock className="h-3.5 w-3.5 shrink-0" /> Sending {run.completed}/{run.total} campaigns…</span>
            ) : blocker && !locked ? (
              <span className="line-clamp-2 text-amber-700 sm:line-clamp-1" title={blocker}>{blocker}</span>
            ) : counts && pool.length > 0 ? (
              <span className="truncate">
                {plural(counts.items, 'item')} → <b>{plural(counts.campaigns, 'campaign')}</b> · {plural(counts.adsets, 'ad set')} · {plural(counts.ads, 'ad')}
              </span>
            ) : null}
          </div>

          {step < STEP.review && (
            <Button type="button" size="sm" className="h-9 shrink-0 bg-teal-600 text-white hover:bg-teal-700" onClick={() => go(step + 1)} disabled={!canNext || locked}>
              Next <ArrowRight />
            </Button>
          )}

          {step === STEP.review && run.phase === 'idle' && (
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 bg-teal-600 text-white hover:bg-teal-700"
              onClick={launch}
              disabled={model.issues.all.length > 0 || model.requests.length === 0}
            >
              <Rocket /> Launch {counts ? plural(counts.ads, 'ad') : ''}
            </Button>
          )}

          {step === STEP.review && running && (
            <Button type="button" size="sm" className="h-9 shrink-0 bg-teal-600 text-white" disabled>
              <Loader2 className="animate-spin" /> Launching…
            </Button>
          )}

          {step === STEP.review && run.phase === 'done' && (
            <div className="flex shrink-0 items-center gap-2">
              {nothingCreated && (
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={runner.reset} title="Nothing was created: fix and launch again">
                  <RotateCcw /> <span className="hidden sm:inline">Edit & retry</span>
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="hidden h-9 sm:inline-flex" asChild>
                <a href={adsManagerUrl(setup.adAccountId)} target="_blank" rel="noreferrer">
                  Open in Ads Manager <ExternalLink />
                </a>
              </Button>
              <Button type="button" size="sm" className="h-9 bg-teal-600 text-white hover:bg-teal-700" onClick={launchMore}>
                <Rocket /> Launch more
              </Button>
            </div>
          )}
        </div>
      </footer>

      <ActiveConfirmDialog {...active.dialog} ads={counts?.ads} />
    </div>
  );
}
