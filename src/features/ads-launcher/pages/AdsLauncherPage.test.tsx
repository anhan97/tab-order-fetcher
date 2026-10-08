/**
 * Smoke test of the whole wizard against a mocked API: deep link → Structure
 * → Review → Launch, plus the Quick launch dialog. Guards against effect
 * loops and checks the request that reaches the API is valid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  STARTER_PRESETS,
  launchRequestSchema,
  type CreativeDto,
  type LandingStore,
  type LaunchPreset,
  type LaunchRequest,
  type LaunchResult,
  type LauncherOptions
} from '@contract/ads-launcher';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'an@example.com', firstName: 'An', lastName: 'Le', isVerified: true },
    activeStore: { id: 's1', storeDomain: 'shop.myshopify.com' },
    canInStore: () => true
  })
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

const ACCOUNT = '900000000000001';
const C1 = '00000000-0000-4000-8000-000000000001';
const C2 = '00000000-0000-4000-8000-000000000002';

const creative = (id: string, angle: string): CreativeDto => ({
  id,
  storeId: 's1',
  productId: '111',
  productTitle: 'Comb',
  productCode: 'COMB',
  productHandle: 'comb',
  name: `An Le | ${angle} | COMB - 07/10/2026`,
  angle,
  primaryText: `Primary ${angle}`,
  headline: `Headline ${angle}`,
  description: null,
  status: 'active',
  mediaType: 'image',
  mediaUrl: `https://cdn.test/${id}.jpg`,
  thumbUrl: null,
  width: 1080,
  height: 1080,
  createdBy: 'u1',
  creatorName: 'An Le',
  createdAt: '2026-10-07T03:00:00Z',
  adsCount: 0
});

const OPTIONS: LauncherOptions = {
  adAccount: { id: ACCOUNT, name: 'Demo account', currency: 'USD', accountStatus: 1, isDemo: true },
  pages: [{ externalId: '1000000001', name: 'My Page', pictureUrl: null, instagramUserId: null, linked: true }],
  pixels: [{ externalId: '2000000002', name: 'Main pixel' }],
  campaigns: [],
  audiences: [],
  warnings: []
};

const LANDING: LandingStore[] = [
  {
    storeId: 'st1',
    storeName: 'Shop A',
    hostname: 'shop-a.com',
    product: { productId: '111', handle: 'comb', title: 'Comb', url: 'https://shop-a.com/products/comb', listingStatus: 'active' },
    pages: []
  }
];

const PRESETS: LaunchPreset[] = STARTER_PRESETS.map((s, i) => ({
  id: `preset-${i}`,
  name: s.name,
  description: s.description,
  config: s.config,
  starterKey: s.key,
  position: i,
  updatedAt: '2026-10-07T00:00:00Z'
}));

const launched: LaunchRequest[] = [];
const resultFor = (r: LaunchRequest): LaunchResult => ({
  campaign: { status: 'ok', id: 'c-uuid', externalId: '1202000001', name: r.campaign.mode === 'new' ? r.campaign.name : 'Existing' },
  adsets: r.adsets.map((a, i) => ({
    status: 'ok',
    externalId: `13000000${i}`,
    name: a.mode === 'new' ? a.name : 'Existing ad set',
    ads: (a.ads ?? []).map((ad, j) => ({ status: 'ok' as const, externalId: `14000${i}${j}`, name: `Ad ${j + 1}`, creativeId: ad.creativeId }))
  })),
  summary: { adsCreated: r.adsets.reduce((n, a) => n + (a.ads?.length ?? 0), 0), adsFailed: 0, adsetsCreated: r.adsets.length, campaignCreated: true }
});

vi.mock('../api/ads-launcher-api', () => ({
  LauncherApiError: class extends Error {},
  launcherApi: {
    accounts: vi.fn(async () => ({ items: [OPTIONS.adAccount] })),
    options: vi.fn(async () => OPTIONS),
    landing: vi.fn(async () => ({ items: LANDING })),
    posts: vi.fn(async () => ({ items: [], total: 0, hasMore: false, range: { from: null, to: '' }, missingPostIds: 0 })),
    refreshPosts: vi.fn(),
    launch: vi.fn(async (r: LaunchRequest) => {
      launched.push(r);
      return resultFor(r);
    })
  },
  presetsApi: {
    list: vi.fn(async () => ({ items: PRESETS })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    restoreStarters: vi.fn()
  },
  creativesApi: {
    products: vi.fn(async () => ({ items: [{ id: '111', title: 'Comb', handle: 'comb', code: 'COMB', imageUrl: null, status: 'active', creatives: 2 }] })),
    list: vi.fn(async () => ({ items: [creative(C1, 'Dead corner'), creative(C2, 'Gift')], total: 2, notLaunched: 2 })),
    byIds: vi.fn(async (ids: string[]) => ({ items: [creative(C1, 'Dead corner'), creative(C2, 'Gift')].filter(c => ids.includes(c.id)) }))
  }
}));

import { AdsLauncherPage } from './AdsLauncherPage';
import { QuickLaunchDialog } from '../components/QuickLaunchDialog';

// ─── Helpers ────────────────────────────────────────────────────────────────

let currentUrl = '';
function LocationProbe() {
  const loc = useLocation();
  currentUrl = `${loc.pathname}${loc.search}`;
  return null;
}

function renderAt(url: string, ui = <AdsLauncherPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="*" element={<>{ui}<LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  launched.length = 0;
  toastSpy.mockClear();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  // Radix needs these in jsdom.
  Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
  Element.prototype.releasePointerCapture = vi.fn() as never;
});
afterEach(() => vi.useRealTimers());

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AdsLauncherPage', () => {
  it('opens a deep link on Structure, clears the URL, and launches a valid request', async () => {
    renderAt(`/ads-launcher?creatives=${C1},${C2}&account=${ACCOUNT}&preset=preset-1`);

    // Straight to Structure, with the parameters removed from the URL.
    expect(await screen.findByText('Where the ads go')).toBeInTheDocument();
    await waitFor(() => expect(currentUrl).toBe('/ads-launcher'));

    // CBO per creative (n:1:1) with 2 creatives → 2 campaigns.
    await waitFor(() => expect(screen.getByText('Ready: nothing blocks this plan.')).toBeInTheDocument());
    const bar = screen.getByRole('contentinfo');
    expect(within(bar).getByText(/2 campaigns/)).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: /next/i }));
    expect(await screen.findByText('What will be launched')).toBeInTheDocument();
    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0);

    // Copy edit reaches the request.
    fireEvent.change(screen.getByPlaceholderText('Headline Dead corner'), { target: { value: 'New headline' } });

    const launchButton = await within(bar).findByRole('button', { name: /launch 2 ads/i });
    await waitFor(() => expect(launchButton).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(launchButton);
    });

    await waitFor(() => expect(launched).toHaveLength(2));
    for (const r of launched) expect(launchRequestSchema.safeParse(r).success).toBe(true);
    expect(new Set(launched.map(r => r.requestId)).size).toBe(2);
    expect(new Set(launched.map(r => r.launchId)).size).toBe(1);
    expect(launched[0]).toMatchObject({
      adAccountId: ACCOUNT,
      pageId: '1000000001',
      pixelId: '2000000002',
      destination: { url: 'https://shop-a.com/products/comb', displayLink: 'shop-a.com' },
      campaign: { mode: 'new', dailyBudget: '30', bidStrategy: 'LOWEST_COST_WITHOUT_CAP', status: 'PAUSED' }
    });
    expect(launched[0].adsets[0].ads).toEqual([{ creativeId: C1, headline: 'New headline' }]);
    expect(launched[1].adsets[0].ads).toEqual([{ creativeId: C2 }]);

    expect(await within(bar).findByRole('button', { name: /launch more/i })).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: '2 ads launched' }));

    // Setup is remembered for the user.
    await waitFor(() => {
      const mem = JSON.parse(localStorage.getItem('ads-launcher:setup:u1') ?? '{}');
      expect(mem).toMatchObject({ adAccountId: ACCOUNT, pixelId: '2000000002', pageId: '1000000001', storeId: 'st1', presetId: 'preset-1' });
      expect(mem).not.toHaveProperty('pool');
    });

    // "Launch more" keeps the setup, empties the pool, goes to Creatives.
    fireEvent.click(within(bar).getByRole('button', { name: /launch more/i }));
    expect(await screen.findByText(/Pool · 0 selected/)).toBeInTheDocument();
  });

  it('starts on Setup without a deep link and builds the pool on the Creatives step', async () => {
    localStorage.setItem('ads-launcher:setup:u1', JSON.stringify({ adAccountId: ACCOUNT }));
    renderAt('/ads-launcher');
    expect(await screen.findByText('Pixel & page')).toBeInTheDocument();
    const bar = screen.getByRole('contentinfo');
    const next = within(bar).getByRole('button', { name: /next/i });
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);

    expect(await screen.findByText(/Not launched \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select all shown/i }));
    expect(await screen.findByText(/Pool · 2 selected/)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Where the ads go')).toBeInTheDocument();
  });
});

describe('QuickLaunchDialog', () => {
  it('launches the selection with the remembered setup', async () => {
    const onOpenChange = vi.fn();
    renderAt('/creatives', <QuickLaunchDialog open onOpenChange={onOpenChange} creatives={[creative(C1, 'Dead corner')]} productId="111" />);
    const dialog = await screen.findByRole('dialog');
    const launch = await within(dialog).findByRole('button', { name: /launch 1 ad$/i });
    await waitFor(() => expect(launch).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(launch);
    });
    await waitFor(() => expect(launched).toHaveLength(1));
    expect(launchRequestSchema.safeParse(launched[0]).success).toBe(true);
    expect(await within(dialog).findByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  it('"Customise in Ads Launcher" opens the wizard link', async () => {
    const onOpenChange = vi.fn();
    renderAt('/creatives', <QuickLaunchDialog open onOpenChange={onOpenChange} creatives={[creative(C1, 'Dead corner')]} productId="111" />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ready to launch.');
    fireEvent.click(within(dialog).getByRole('button', { name: /customise in ads launcher/i }));
    expect(currentUrl).toBe(`/ads-launcher?creatives=${C1}&preset=preset-0&account=${ACCOUNT}`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
