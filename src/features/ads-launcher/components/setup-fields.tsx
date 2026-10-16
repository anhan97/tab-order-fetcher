/**
 * The setup selects shared by the wizard and the Quick launch dialog:
 * ad account, pixel, page, landing page, product.
 */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { LauncherAdAccount, LauncherInstagramAccount, LauncherOptions, ProductOption } from '@contract/ads-launcher';
import { CUSTOM_LANDING, type LandingGroup } from '../lib/landing';
import { actId } from '../lib/format';
import { IG_PAGE_ONLY } from '../lib/structure';
import { SearchPicker, type SearchPickerItem } from './SearchPicker';

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  aside
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  aside?: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-slate-700">{label}</Label>
        {aside}
      </div>
      {children}
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn('rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700', className)}>
      Demo
    </span>
  );
}

const Spinner = () => <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />;

// ─── Ad account ─────────────────────────────────────────────────────────────

/** Meta account_status values other than 1 (active), as a short label. */
const ACCOUNT_STATUS: Record<number, string> = {
  2: 'Disabled',
  3: 'Unsettled',
  7: 'Risk review',
  8: 'Pending settlement',
  9: 'Grace period',
  100: 'Closing',
  101: 'Closed'
};

/**
 * Searchable: a Business Manager can hold dozens of ad accounts with long
 * names. The list keeps the trigger's width and scrolls; search matches the
 * name or the id.
 */
export function AdAccountSelect({
  accounts,
  value,
  onChange,
  loading,
  disabled,
  className,
  modal,
  align
}: {
  accounts: LauncherAdAccount[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  /** Inside a Dialog. */
  modal?: boolean;
  align?: 'start' | 'end';
}) {
  const items: SearchPickerItem[] = accounts.map(a => {
    const status = a.accountStatus != null ? ACCOUNT_STATUS[a.accountStatus] : undefined;
    return {
      value: a.id,
      label: a.name,
      keywords: [a.id, actId(a.id)],
      sub: (
        <>
          <span className="font-mono">{actId(a.id)}</span>
          {a.currency && <> · {a.currency}</>}
          {status && <span className="text-amber-600"> · {status}</span>}
        </>
      ),
      trailing: a.isDemo ? <DemoBadge /> : undefined
    };
  });
  return (
    <SearchPicker
      items={items}
      value={value}
      onChange={onChange}
      ariaLabel="Ad account"
      placeholder={loading ? 'Loading ad accounts…' : accounts.length ? 'Pick an ad account' : 'No ad account available'}
      searchPlaceholder="Search name or account ID…"
      emptyText="No ad account matches."
      disabled={disabled || loading}
      modal={modal}
      align={align}
      className={className}
      renderValue={item => (
        <>
          <span className="truncate">{item.label}</span>
          {item.trailing}
        </>
      )}
    />
  );
}

// ─── Pixel / page ───────────────────────────────────────────────────────────

const NONE = '__none__';

export function PixelField({
  options,
  value,
  onChange,
  required,
  loading,
  disabled,
  label = 'Pixel'
}: {
  options: LauncherOptions | null;
  value: string;
  onChange: (id: string) => void;
  required: boolean;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const pixels = options?.pixels ?? [];
  const manual = !!options && pixels.length === 0;
  return (
    <Field
      label={<>{label}{required && <span className="text-rose-500"> *</span>}</>}
      aside={loading ? <Spinner /> : null}
      hint={manual ? 'No pixel found for this account — type its ID.' : required ? 'Conversions need a pixel.' : 'Optional for this optimisation goal.'}
    >
      {manual ? (
        <Input value={value} onChange={e => onChange(e.target.value.trim())} placeholder="Pixel ID" inputMode="numeric" disabled={disabled} className="h-9" />
      ) : (
        <Select value={value || (required ? undefined : NONE)} onValueChange={v => onChange(v === NONE ? '' : v)} disabled={disabled || !options}>
          <SelectTrigger className="h-9 w-full text-sm" aria-label="Pixel">
            <SelectValue placeholder={options ? 'Pick a pixel' : 'Pick an ad account first'} />
          </SelectTrigger>
          <SelectContent>
            {!required && <SelectItem value={NONE}>No pixel</SelectItem>}
            {pixels.map(p => (
              <SelectItem key={p.externalId} value={p.externalId}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{p.name || 'Pixel'}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">{p.externalId}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export function PageAvatar({ name, pictureUrl, className }: { name?: string | null; pictureUrl?: string | null; className?: string }) {
  return pictureUrl ? (
    <img src={pictureUrl} alt="" className={cn('h-5 w-5 shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white', className)}>
      {(name || 'P').trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function PageField({
  options,
  value,
  onChange,
  loading,
  disabled,
  modal
}: {
  options: LauncherOptions | null;
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Inside a Dialog. */
  modal?: boolean;
}) {
  const pages = options?.pages ?? [];
  const manual = !!options && pages.length === 0;
  const items: SearchPickerItem[] = pages.map(p => ({
    value: p.externalId,
    label: p.name,
    keywords: [p.externalId],
    leading: <PageAvatar name={p.name} pictureUrl={p.pictureUrl} />,
    sub: <>{p.linked ? 'In this ad account · ' : ''}<span className="font-mono">{p.externalId}</span></>
  }));
  return (
    <Field
      label={<>Facebook page<span className="text-rose-500"> *</span></>}
      aside={loading ? <Spinner /> : null}
      hint={manual ? 'No page found for this account — type its ID.' : undefined}
    >
      {manual ? (
        <Input value={value} onChange={e => onChange(e.target.value.trim())} placeholder="Page ID" inputMode="numeric" disabled={disabled} className="h-9" />
      ) : (
        <SearchPicker
          items={items}
          value={value}
          onChange={onChange}
          ariaLabel="Facebook page"
          placeholder={options ? 'Pick a page' : 'Pick an ad account first'}
          searchPlaceholder="Search page name or ID…"
          emptyText="No page matches."
          disabled={disabled || !options}
          modal={modal}
        />
      )}
    </Field>
  );
}

// ─── Instagram account ──────────────────────────────────────────────────────

/**
 * Who the ads show as on Instagram: an account connected to the ad account
 * (Business Manager) or linked to a page, or none — then Instagram shows the
 * Facebook page. The page's own account comes first and is the default.
 */
export function InstagramField({
  options,
  pageId,
  value,
  onChange,
  loading,
  disabled
}: {
  options: LauncherOptions | null;
  pageId: string;
  /** Setup value: '' = the page's linked account, IG_PAGE_ONLY = none, else an id. */
  value: string;
  onChange: (instagramUserId: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const page = options?.pages?.find(p => p.externalId === pageId) ?? null;
  const linkedId = page?.instagramUserId ?? null;
  const accounts: LauncherInstagramAccount[] = [...(options?.instagramAccounts ?? [])];
  // Options cached before the account list existed still carry the page's link.
  if (linkedId && !accounts.some(a => a.externalId === linkedId)) {
    accounts.unshift({ externalId: linkedId, username: null, pictureUrl: null, pageIds: [pageId] });
  }
  const ofPage = (a: LauncherInstagramAccount) => a.externalId === linkedId || (!!pageId && a.pageIds.includes(pageId));
  const sorted = [...accounts].sort((a, b) => Number(ofPage(b)) - Number(ofPage(a)));
  const selected = value === IG_PAGE_ONLY ? IG_PAGE_ONLY : value || linkedId || IG_PAGE_ONLY;
  // Why the list is empty, when Meta said (missing permission, a failed read).
  const metaSays = (options?.warnings ?? []).filter(w => /instagram/i.test(w));
  const hint = !options
    ? undefined
    : accounts.length === 0
      ? metaSays.length
        ? <span className="text-amber-700">{metaSays.join(' · ')}</span>
        : 'No Instagram account is connected to this ad account or its pages: ads on Instagram show as the Facebook page. Connect one in Meta Business Settings, then reload.'
      : selected === IG_PAGE_ONLY
        ? 'Ads on Instagram show as the Facebook page.'
        : undefined;
  return (
    <Field label="Instagram account" aside={loading ? <Spinner /> : null} hint={hint}>
      <Select value={selected} onValueChange={onChange} disabled={disabled || !options}>
        <SelectTrigger className="h-9 w-full text-sm" aria-label="Instagram account">
          <SelectValue placeholder="Pick an ad account first" />
        </SelectTrigger>
        <SelectContent>
          {sorted.map(a => (
            <SelectItem key={a.externalId} value={a.externalId}>
              <span className="flex min-w-0 items-center gap-2">
                <PageAvatar name={a.username ?? 'I'} pictureUrl={a.pictureUrl} className="bg-pink-600" />
                <span className="truncate">{a.username ? `@${a.username}` : `Instagram ${a.externalId}`}</span>
                {ofPage(a) && <span className="shrink-0 text-[10px] text-slate-400">this page</span>}
              </span>
            </SelectItem>
          ))}
          {sorted.length > 0 && <SelectSeparator />}
          <SelectItem value={IG_PAGE_ONLY}>No Instagram account (use the Facebook page)</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

// ─── Landing page ───────────────────────────────────────────────────────────

export function LandingSelect({
  groups,
  value,
  onChange,
  loading,
  disabled,
  noProduct
}: {
  groups: LandingGroup[];
  /** Landing item id, `custom`, or ''. */
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  noProduct?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-full text-sm" aria-label="Landing page">
        <SelectValue
          placeholder={loading ? 'Loading landing pages…' : noProduct ? 'Pick a product, or use a custom URL' : groups.length ? 'Pick a landing page' : 'No store page found — use a custom URL'}
        />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {groups.map(g => (
          <SelectGroup key={g.hostname}>
            <SelectLabel className="flex items-center gap-2 text-xs text-slate-500">
              <span className="truncate font-semibold text-slate-700">{g.hostname}</span>
              {g.note && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{g.note}</span>}
            </SelectLabel>
            {g.items.map(i => (
              <SelectItem key={i.id} value={i.id}>
                <span className="block max-w-[min(70vw,28rem)] truncate">{i.label}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {groups.length > 0 && <SelectSeparator />}
        <SelectItem value={CUSTOM_LANDING}>Custom URL…</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ─── Product ────────────────────────────────────────────────────────────────

export function ProductSelect({
  products,
  value,
  onChange,
  loading,
  disabled
}: {
  products: ProductOption[];
  value: string | null;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled || loading}>
      <SelectTrigger className="h-9 w-full text-sm" aria-label="Product">
        <SelectValue placeholder={loading ? 'Loading products…' : products.length ? 'Pick a product' : 'No product found'} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {products.map(p => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex min-w-0 items-center gap-2">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded bg-slate-200" />
              )}
              <span className="truncate">{p.title}</span>
              {p.code && <span className="shrink-0 font-mono text-[10px] text-slate-400">{p.code}</span>}
              <span className="shrink-0 text-[10px] text-slate-400">{p.creatives} creatives</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
