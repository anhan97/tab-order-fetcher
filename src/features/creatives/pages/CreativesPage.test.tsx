import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreativeDto, PostRow, ProductOption } from '@contract/ads-launcher';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const launchProps = vi.fn();
vi.mock('@/features/ads-launcher/components/QuickLaunchDialog', () => ({
  QuickLaunchDialog: (props: { open: boolean; creatives?: CreativeDto[]; posts?: PostRow[]; productId?: string | null }) => {
    launchProps(props);
    return props.open ? <div data-testid="quick-launch">{(props.creatives ?? props.posts ?? []).length} items</div> : null;
  }
}));

const auth = {
  user: { id: 'u1', email: 'an@example.com', firstName: 'An', lastName: 'Le', isVerified: true },
  activeStore: { id: 's1', storeDomain: 'shop.myshopify.com', capabilities: undefined },
  canInStore: (_capability: string) => true as boolean
};
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));

const products: ProductOption[] = [
  { id: 'p1', title: 'Comb', handle: 'comb', code: 'COMB01', imageUrl: null, status: 'active', creatives: 2 },
  { id: 'p2', title: 'Brush', handle: 'brush', code: 'BR02', imageUrl: null, status: 'active', creatives: 1 }
];

const creative = (id: string, productId: string, over: Partial<CreativeDto> = {}): CreativeDto => ({
  id,
  storeId: 's1',
  productId,
  productTitle: productId === 'p1' ? 'Comb' : 'Brush',
  productCode: productId === 'p1' ? 'COMB01' : 'BR02',
  productHandle: null,
  name: `An Le | Angle ${id} | CODE - 07/10/2026`,
  angle: `Angle ${id}`,
  primaryText: null,
  headline: null,
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
  adsCount: 0,
  ...over
});

const creatives = [creative('a', 'p1'), creative('b', 'p1', { mediaType: 'video', adsCount: 3 }), creative('c', 'p2')];

const post = (postId: string, productId: string | null): PostRow => ({
  postId,
  pageId: postId.split('_')[0],
  pageName: 'My Page',
  permalink: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
  thumbnailUrl: null,
  isVideo: false,
  headline: null,
  primaryText: null,
  link: null,
  creative: null,
  product: productId ? { id: productId, title: productId, code: 'X', imageUrl: null } : null,
  ads: 2,
  activeAds: 1,
  adAccounts: ['123'],
  lastAd: null,
  firstUsedAt: '2026-10-01T00:00:00Z',
  lastUsedAt: '2026-10-06T00:00:00Z',
  currency: 'USD',
  metrics: { spend: '12.5', impressions: 100, clicks: 3, purchases: 1, revenue: '30', roas: 2.4, cpa: '12.5' }
});

const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
vi.mock('@/features/ads-launcher/hooks/queries', () => ({
  useStoreKey: () => 'shop.myshopify.com',
  useProducts: () => ({ data: products, isLoading: false }),
  useCreatives: () => ({
    data: { items: creatives, total: creatives.length, notLaunched: 2 },
    isLoading: false, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn()
  }),
  useCreativeMutations: () => ({ upload: mutation(), update: mutation(), archive: mutation(), restore: mutation(), remove: mutation() }),
  usePosts: () => ({
    data: { items: [post('111_222', 'p1'), post('333_444', null)], total: 2, hasMore: false, range: { from: '2026-09-08', to: '2026-10-07' }, missingPostIds: 4 },
    isLoading: false, isError: false, isFetching: false, isPlaceholderData: false, refetch: vi.fn()
  }),
  useRefreshPosts: () => mutation(),
  useLauncherAccounts: () => ({ data: [{ id: '123', name: 'Shop US', currency: 'USD', accountStatus: 1, isDemo: false }] })
}));

// QuickLaunchDialog is built in parallel (features/ads-launcher); Vite refuses
// to transform an import of a file that does not exist yet, even when it is
// mocked, so only load the page once it is there. CREATIVES_SMOKE=1 forces the
// run with a config that aliases the dialog to a stub.
const hasQuickLaunch =
  Object.keys(import.meta.glob('/src/features/ads-launcher/components/QuickLaunchDialog.tsx')).length > 0 ||
  process.env.CREATIVES_SMOKE === '1';
const { CreativesPage } = hasQuickLaunch ? await import('./CreativesPage') : { CreativesPage: () => null };

const renderPage = (url = '/creatives') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <CreativesPage />
    </MemoryRouter>
  );

// ─── Tests ──────────────────────────────────────────────────────────────────

describe.skipIf(!hasQuickLaunch)('CreativesPage', () => {
  beforeEach(() => {
    launchProps.mockClear();
    auth.canInStore = () => true;
  });

  it('selects creatives in click order and launches them', () => {
    renderPage();
    expect(screen.getByText('Not launched (2)')).toBeInTheDocument();
    const cardB = screen.getByRole('checkbox', { name: creatives[1].name });
    const cardA = screen.getByRole('checkbox', { name: creatives[0].name });
    fireEvent.click(cardB);
    fireEvent.click(cardA);
    expect(within(cardB).getByText('1')).toBeInTheDocument();
    expect(within(cardA).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/creatives selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Launch ads/ }));
    expect(screen.getByTestId('quick-launch')).toHaveTextContent('2 items');
    const last = launchProps.mock.calls.at(-1)![0];
    expect(last.creatives.map((c: CreativeDto) => c.id)).toEqual(['b', 'a']);
    expect(last.productId).toBe('p1');
  });

  it('blocks launching creatives of two products', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: creatives[0].name }));
    fireEvent.click(screen.getByRole('checkbox', { name: creatives[2].name }));
    expect(screen.getByText(/covers 2 products/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Launch ads/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Keep only “Comb”/ }));
    expect(screen.getByRole('button', { name: /Launch ads/ })).toBeEnabled();
  });

  it('"Select all shown" appends in display order', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: creatives[2].name }));
    fireEvent.click(screen.getByRole('button', { name: /Select all shown/ }));
    expect(within(screen.getByRole('checkbox', { name: creatives[2].name })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('checkbox', { name: creatives[0].name })).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByRole('checkbox', { name: creatives[1].name })).getByText('3')).toBeInTheDocument();
  });

  it('read-only users cannot upload or select', () => {
    auth.canInStore = (c: string) => c !== 'manage';
    renderPage();
    expect(screen.getByRole('button', { name: /Upload creatives/ })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: creatives[0].name })).toBeNull();
    expect(screen.getByRole('button', { name: creatives[0].name })).toBeInTheDocument();
  });

  it('upload dialog shows the generated name live', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Upload creatives/ }));
    fireEvent.change(screen.getByLabelText(/^Angle/), { target: { value: 'Dead | corner' } });
    // No product picked → empty code; the default normaliser collapses the double space.
    expect(screen.getByText(/^An Le \| Dead \/ corner \| +- \d{2}\/\d{2}\/\d{4}$/)).toBeInTheDocument();
  });

  it('posts tab lists posts, selects them and launches with the product', () => {
    renderPage('/creatives?tab=posts');
    expect(screen.getByText(/Refresh post IDs \(4 missing\)/)).toBeInTheDocument();
    expect(screen.getAllByText('111_222').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select post 333_444' })[0]);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select post 111_222' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Launch ads/ }));
    const last = launchProps.mock.calls.filter(c => c[0].posts).at(-1)![0];
    expect(last.posts.map((p: PostRow) => p.postId)).toEqual(['333_444', '111_222']);
    expect(last.productId).toBe('p1');
  });
});
