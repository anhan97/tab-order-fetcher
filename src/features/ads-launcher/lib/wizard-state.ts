/**
 * The launcher's single state + reducer (§12.2). Shared by the wizard page
 * and the Quick launch dialog. Pure.
 */
import { DEFAULT_URL_TAGS, type LaunchPresetConfig, type NodeStatus } from '@contract/ads-launcher';
import { mergePool, type PoolItem } from './pool';
import { EMPTY_SETUP, type CopyOverride, type LaunchSetup, type LaunchTarget } from './structure';
import type { SetupMemory } from './setup-memory';

export const WIZARD_STEPS = ['Setup', 'Creatives', 'Structure', 'Review'] as const;
export const STEP = { setup: 0, creatives: 1, structure: 2, review: 3 } as const;

export interface WizardState {
  step: number;
  setup: LaunchSetup;
  /** Landing item id (`<storeId>|<optionId>`), `custom`, or '' (none yet). */
  landingId: string;
  /** Product picked by hand when the pool does not tell (§3.2). */
  productId: string | null;
  pool: PoolItem[];
  presetId: string | null;
  /** Working copy of the preset; edits never touch the saved preset until "Save". */
  config: LaunchPresetConfig | null;
  dirty: boolean;
  target: LaunchTarget;
  /** Hand-edited ad sets, `"c:s"` → item keys. */
  overrides: Record<string, string[]>;
  /** Copy edits by creative id. */
  copy: Record<string, CopyOverride>;
  /** `<input type="datetime-local">` value; '' = start now. */
  startTime: string;
  /** The user confirmed launching ACTIVE. */
  activeConfirmed: boolean;
}

export type WizardAction =
  | { type: 'step'; step: number }
  | { type: 'setup'; patch: Partial<LaunchSetup> }
  | { type: 'account'; adAccountId: string }
  | { type: 'landing'; landingId: string; url?: string; storeId?: string; displayLink?: string }
  | { type: 'product'; productId: string | null }
  | { type: 'pool/toggle'; item: PoolItem }
  | { type: 'pool/add'; items: PoolItem[] }
  | { type: 'pool/remove'; key: string }
  | { type: 'pool/set'; items: PoolItem[] }
  | { type: 'preset'; presetId: string | null; config: LaunchPresetConfig | null }
  | { type: 'config'; config: LaunchPresetConfig }
  | { type: 'saved'; presetId: string; config: LaunchPresetConfig }
  | { type: 'target'; target: LaunchTarget }
  | { type: 'override'; key: string; itemKeys: string[] | null }
  | { type: 'copy'; creativeId: string; patch: CopyOverride }
  | { type: 'copy/reset'; creativeId: string }
  | { type: 'startTime'; value: string }
  | { type: 'status'; status: NodeStatus; confirmed?: boolean }
  | { type: 'launchMore' };

export function initialWizardState(memory: SetupMemory = {}, extra: Partial<WizardState> = {}): WizardState {
  return {
    step: STEP.setup,
    setup: {
      ...EMPTY_SETUP,
      adAccountId: memory.adAccountId ?? '',
      pixelId: memory.pixelId ?? '',
      pageId: memory.pageId ?? '',
      storeId: memory.storeId ?? '',
      displayLink: memory.displayLink ?? '',
      urlTags: memory.urlTags ?? DEFAULT_URL_TAGS
    },
    landingId: '',
    productId: null,
    pool: [],
    presetId: memory.presetId ?? null,
    config: null,
    dirty: false,
    target: { mode: 'new' },
    overrides: {},
    copy: {},
    startTime: '',
    activeConfirmed: false,
    ...extra
  };
}

/** Overrides only keep items still in the pool; empty ones are dropped. */
function pruneOverrides(overrides: Record<string, string[]>, pool: PoolItem[]): Record<string, string[]> {
  const keys = new Set(pool.map(i => i.key));
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(overrides)) {
    const kept = v.filter(x => keys.has(x));
    if (kept.length) out[k] = kept;
  }
  return out;
}

const sameStructure = (a: LaunchPresetConfig | null, b: LaunchPresetConfig | null) =>
  JSON.stringify(a?.structure ?? null) === JSON.stringify(b?.structure ?? null);

function withPool(state: WizardState, pool: PoolItem[]): WizardState {
  return { ...state, pool, overrides: pruneOverrides(state.overrides, pool) };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'step':
      return { ...state, step: Math.max(0, Math.min(WIZARD_STEPS.length - 1, action.step)) };
    case 'setup':
      return { ...state, setup: { ...state.setup, ...action.patch } };
    case 'account':
      if (action.adAccountId === state.setup.adAccountId) return state;
      // Pixel / page are re-validated against the new account's options; an
      // existing campaign belongs to the old account, so it goes.
      return { ...state, setup: { ...state.setup, adAccountId: action.adAccountId }, target: { mode: 'new' } };
    case 'landing':
      return {
        ...state,
        landingId: action.landingId,
        setup: {
          ...state.setup,
          ...(action.url !== undefined ? { landingUrl: action.url } : {}),
          ...(action.storeId !== undefined ? { storeId: action.storeId } : {}),
          ...(action.displayLink !== undefined ? { displayLink: action.displayLink } : {})
        }
      };
    case 'product':
      if (action.productId === state.productId) return state;
      return { ...state, productId: action.productId, landingId: '', setup: { ...state.setup, landingUrl: '' } };
    case 'pool/toggle':
      return state.pool.some(i => i.key === action.item.key)
        ? withPool(state, state.pool.filter(i => i.key !== action.item.key))
        : withPool(state, [...state.pool, action.item]);
    case 'pool/add':
      return withPool(state, mergePool(state.pool, action.items));
    case 'pool/remove':
      return withPool(state, state.pool.filter(i => i.key !== action.key));
    case 'pool/set':
      return withPool(state, mergePool([], action.items));
    case 'preset':
      return {
        ...state,
        presetId: action.presetId,
        config: action.config,
        dirty: false,
        overrides: sameStructure(state.config, action.config) ? state.overrides : {},
        activeConfirmed: false
      };
    case 'config':
      return {
        ...state,
        config: action.config,
        dirty: true,
        overrides: sameStructure(state.config, action.config) ? state.overrides : {},
        activeConfirmed: action.config.status === 'ACTIVE' ? state.activeConfirmed : false
      };
    case 'saved':
      return { ...state, presetId: action.presetId, config: action.config, dirty: false };
    case 'target':
      return { ...state, target: action.target };
    case 'override': {
      const overrides = { ...state.overrides };
      if (action.itemKeys && action.itemKeys.length) overrides[action.key] = action.itemKeys;
      else delete overrides[action.key];
      return { ...state, overrides };
    }
    case 'copy':
      return { ...state, copy: { ...state.copy, [action.creativeId]: { ...state.copy[action.creativeId], ...action.patch } } };
    case 'copy/reset': {
      const copy = { ...state.copy };
      delete copy[action.creativeId];
      return { ...state, copy };
    }
    case 'startTime':
      return { ...state, startTime: action.value };
    case 'status':
      if (!state.config) return state;
      return {
        ...state,
        config: { ...state.config, status: action.status },
        dirty: state.dirty || state.config.status !== action.status,
        activeConfirmed: action.status === 'ACTIVE' ? !!action.confirmed : false
      };
    case 'launchMore':
      // Keep the setup and the preset; start a new pool.
      return {
        ...state,
        step: STEP.creatives,
        pool: [],
        overrides: {},
        copy: {},
        target: { mode: 'new' },
        startTime: '',
        activeConfirmed: false
      };
    default:
      return state;
  }
}

/** The fields setup memory keeps (§3.2). */
export function memoryOf(state: WizardState): SetupMemory {
  return {
    adAccountId: state.setup.adAccountId,
    pixelId: state.setup.pixelId,
    pageId: state.setup.pageId,
    storeId: state.setup.storeId,
    displayLink: state.setup.displayLink,
    urlTags: state.setup.urlTags,
    presetId: state.presetId ?? ''
  };
}
