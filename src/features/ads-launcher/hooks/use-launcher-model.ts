/**
 * Everything the wizard and the Quick launch dialog derive from their state:
 * the option lists, auto-selections (§3.2), ONE plan, the issues and the
 * launch requests. Both screens read the same model, so the diagram, the
 * review and the requests can never disagree.
 */
import { useEffect, useMemo, useRef, type Dispatch } from 'react';
import {
  STARTER_PRESETS,
  normalizePresetConfig,
  type ExistingCampaign,
  type LaunchPreset,
  type LauncherAdAccount,
  type LauncherOptions,
  type LauncherPage,
  type ProductOption
} from '@contract/ads-launcher';
import { useLanding, useLauncherAccounts, useLauncherOptions, usePresets, useProducts } from './queries';
import { errorMessage, localInputToIso } from '../lib/format';
import { defaultLanding, displayLinkFor, findLanding, landingById, landingGroups, CUSTOM_LANDING, type LandingGroup } from '../lib/landing';
import { initialPageId } from '../lib/pages';
import { poolProduct } from '../lib/pool';
import {
  audienceRefIssues,
  buildStructureRequests,
  planStructure,
  setupIssues,
  targetIssues,
  type LaunchRequestDraft,
  type StructurePlan
} from '../lib/structure';
import type { WizardAction, WizardState } from '../lib/wizard-state';

export interface LauncherProduct {
  id: string;
  title: string;
  code: string;
  imageUrl: string | null;
}

export interface LauncherModel {
  accounts: LauncherAdAccount[];
  accountsLoading: boolean;
  accountsError: string | null;
  account: LauncherAdAccount | null;
  options: LauncherOptions | null;
  /** The selected Facebook page, when it is in the options. */
  page: LauncherPage | null;
  optionsLoading: boolean;
  optionsError: string | null;
  presets: LaunchPreset[];
  presetsLoading: boolean;
  /** Presets could not be loaded; the starters are shown read-only. */
  presetsFallback: boolean;
  preset: LaunchPreset | null;
  products: ProductOption[];
  productsLoading: boolean;
  product: LauncherProduct | null;
  /** The product comes from the pool (first creative / post). */
  productInferred: boolean;
  landingGroups: LandingGroup[];
  landingLoading: boolean;
  landingError: string | null;
  existingCampaign: ExistingCampaign | null;
  currency: string | null;
  plan: StructurePlan | null;
  issues: { setup: string[]; plan: string[]; target: string[]; all: string[] };
  requests: LaunchRequestDraft[];
}

const STARTER_FALLBACK: LaunchPreset[] = STARTER_PRESETS.map((s, i) => ({
  id: `starter:${s.key}`,
  name: s.name,
  description: s.description,
  config: s.config,
  starterKey: s.key,
  position: i,
  updatedAt: ''
}));

export function useLauncherModel(state: WizardState, dispatch: Dispatch<WizardAction>): LauncherModel {
  const { setup } = state;

  // ─── Queries ──────────────────────────────────────────────────────────────
  const accountsQ = useLauncherAccounts();
  const optionsQ = useLauncherOptions(setup.adAccountId || null);
  const presetsQ = usePresets();
  const productsQ = useProducts();

  const inferred = poolProduct(state.pool);
  const productId = inferred?.id ?? state.productId ?? null;
  const landingQ = useLanding(productId);

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const presetsFallback = presetsQ.isError && !presetsQ.data;
  const presets = useMemo(
    () => presetsQ.data ?? (presetsFallback ? STARTER_FALLBACK : []),
    [presetsQ.data, presetsFallback]
  );
  const options = optionsQ.data && optionsQ.data.adAccount?.id === setup.adAccountId ? optionsQ.data : null;
  const groups = useMemo(() => landingGroups(landingQ.data ?? []), [landingQ.data]);

  const account = accounts.find(a => a.id === setup.adAccountId) ?? null;
  const preset = presets.find(p => p.id === state.presetId) ?? null;
  const productOption = products.find(p => p.id === productId) ?? null;
  const product: LauncherProduct | null = inferred
    ? {
        id: inferred.id,
        title: inferred.title || productOption?.title || '',
        code: inferred.code || productOption?.code || '',
        imageUrl: productOption?.imageUrl ?? null
      }
    : productOption
      ? { id: productOption.id, title: productOption.title, code: productOption.code, imageUrl: productOption.imageUrl }
      : null;

  // ─── Auto-selection (§3.2) ────────────────────────────────────────────────

  // Ad account: drop one the user can no longer reach; pick the only one.
  useEffect(() => {
    if (!accountsQ.isSuccess) return;
    const ok = accounts.some(a => a.id === setup.adAccountId);
    if (ok) return;
    const next = accounts.length === 1 ? accounts[0].id : '';
    if (next !== setup.adAccountId) dispatch({ type: 'account', adAccountId: next });
  }, [accountsQ.isSuccess, accounts, setup.adAccountId, dispatch]);

  // Pixel: exactly one → selected; one not offered by this account → cleared.
  // An empty list keeps a hand-typed id (the list may be hidden by permissions).
  useEffect(() => {
    if (!options) return;
    const pixels = options.pixels ?? [];
    if (pixels.length === 0 || pixels.some(x => x.externalId === setup.pixelId)) return;
    const pixelId = pixels.length === 1 ? pixels[0].externalId : '';
    if (pixelId !== setup.pixelId) dispatch({ type: 'setup', patch: { pixelId } });
  }, [options, setup.pixelId, dispatch]);

  // Page, once per account load: one page → it; one linked page → it; else
  // the remembered page if offered. Later the user's choice is left alone,
  // unless the page disappears from the list.
  const pagePickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!options) return;
    const pages = options.pages ?? [];
    if (pages.length === 0) return; // keep a hand-typed id
    let pageId = setup.pageId;
    if (pagePickedFor.current !== options.adAccount.id) {
      pagePickedFor.current = options.adAccount.id;
      pageId = initialPageId(pages, setup.pageId);
    } else if (pageId && !pages.some(p => p.externalId === pageId)) {
      pageId = '';
    }
    if (pageId !== setup.pageId) dispatch({ type: 'setup', patch: { pageId } });
  }, [options, setup.pageId, dispatch]);

  // Product: nothing in the pool tells and the store sells exactly one → that one.
  useEffect(() => {
    if (!inferred && !state.productId && products.length === 1) dispatch({ type: 'product', productId: products[0].id });
  }, [inferred, state.productId, products, dispatch]);

  // Existing campaign / ad set that is not in this account any more → back to "new".
  useEffect(() => {
    if (!options || state.target.mode !== 'existing' || !state.target.campaignId) return;
    if (!options.campaigns.some(c => c.externalId === (state.target.mode === 'existing' ? state.target.campaignId : ''))) {
      dispatch({ type: 'target', target: { mode: 'existing', campaignId: null, adsetId: null } });
    }
  }, [options, state.target, dispatch]);

  // Preset: the remembered / deep-linked one, else the first.
  const configMissing = !state.config;
  useEffect(() => {
    if (presets.length === 0) return;
    const current = presets.find(p => p.id === state.presetId);
    if (current && !configMissing) return;
    if (!configMissing && state.dirty) return; // never clobber edits
    for (const p of current ? [current, ...presets] : presets) {
      const config = normalizePresetConfig(p.config);
      if (config) {
        dispatch({ type: 'preset', presetId: p.id, config });
        return;
      }
    }
  }, [presets, state.presetId, configMissing, state.dirty, dispatch]);

  // Landing page: keep a valid choice; else the remembered store's page, else the only page.
  const landingReady = !!productId && landingQ.isSuccess;
  useEffect(() => {
    if (!landingReady) return;
    if (state.landingId === CUSTOM_LANDING) return;
    if (state.landingId && landingById(groups, state.landingId)) return;
    if (!state.landingId && setup.landingUrl) {
      const hit = findLanding(groups, setup.landingUrl, setup.storeId);
      dispatch({ type: 'landing', landingId: hit ? hit.id : CUSTOM_LANDING, ...(hit ? { storeId: hit.storeId } : {}) });
      return;
    }
    const pick = defaultLanding(groups, setup.storeId);
    if (pick) {
      const keepDisplay = pick.storeId === setup.storeId && setup.displayLink.trim() !== '';
      dispatch({
        type: 'landing',
        landingId: pick.id,
        url: pick.url,
        storeId: pick.storeId,
        displayLink: keepDisplay ? setup.displayLink : displayLinkFor(pick.url)
      });
    } else if (state.landingId) {
      dispatch({ type: 'landing', landingId: '', url: '' });
    }
  }, [landingReady, groups, state.landingId, setup.landingUrl, setup.storeId, setup.displayLink, dispatch]);

  // ─── Plan, issues, requests ───────────────────────────────────────────────
  const existingCampaign =
    state.target.mode === 'existing' && options
      ? options.campaigns.find(c => c.externalId === (state.target.mode === 'existing' ? state.target.campaignId : null)) ?? null
      : null;

  const presetName = preset?.name ?? '';
  const productTitle = product?.title ?? '';
  const productCode = product?.code ?? '';
  const plan = useMemo(
    () =>
      state.config
        ? planStructure({
            config: state.config,
            items: state.pool,
            overrides: state.overrides,
            product: { title: productTitle, code: productCode },
            presetName
          })
        : null,
    [state.config, state.pool, state.overrides, productTitle, productCode, presetName]
  );

  const setupProblems = useMemo(
    () => setupIssues(setup, { config: state.config, items: state.pool, target: state.target }),
    [setup, state.config, state.pool, state.target]
  );
  const audienceProblems = useMemo(
    () => audienceRefIssues(state.config, options ? options.audiences ?? [] : null, state.target),
    [state.config, options, state.target]
  );
  const planProblems = plan ? [...plan.issues, ...audienceProblems] : [presetsQ.isLoading ? 'Loading presets…' : 'Pick a preset'];
  const targetProblems = useMemo(
    () =>
      plan
        ? targetIssues(state.target, { plan, config: state.config, campaigns: options?.campaigns ?? [] })
        : [],
    [plan, state.target, state.config, options]
  );
  const all = [...setupProblems, ...planProblems, ...targetProblems];
  const blocked = all.length > 0;
  const page = options?.pages?.find(p => p.externalId === setup.pageId) ?? null;
  const instagramUserId = page?.instagramUserId ?? null;

  const requests = useMemo(
    () =>
      !blocked && plan && state.config
        ? buildStructureRequests({
            plan,
            config: state.config,
            setup,
            target: state.target,
            existingCampaign,
            copy: state.copy,
            startTime: localInputToIso(state.startTime),
            instagramUserId
          })
        : [],
    [blocked, plan, state.config, setup, state.target, existingCampaign, state.copy, state.startTime, instagramUserId]
  );

  return {
    accounts,
    accountsLoading: accountsQ.isLoading,
    accountsError: accountsQ.isError ? errorMessage(accountsQ.error) : null,
    account,
    options,
    page,
    optionsLoading: !!setup.adAccountId && optionsQ.isLoading,
    optionsError: optionsQ.isError ? errorMessage(optionsQ.error) : null,
    presets,
    presetsLoading: presetsQ.isLoading,
    presetsFallback,
    preset,
    products,
    productsLoading: productsQ.isLoading,
    product,
    productInferred: !!inferred,
    landingGroups: groups,
    landingLoading: !!productId && landingQ.isLoading,
    landingError: landingQ.isError ? errorMessage(landingQ.error) : null,
    existingCampaign,
    currency: options?.adAccount.currency ?? account?.currency ?? null,
    plan,
    issues: { setup: setupProblems, plan: planProblems, target: targetProblems, all },
    requests
  };
}
