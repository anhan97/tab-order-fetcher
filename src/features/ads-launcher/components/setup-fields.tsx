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
import type { LauncherAdAccount, LauncherOptions, ProductOption } from '@contract/ads-launcher';
import { CUSTOM_LANDING, type LandingGroup } from '../lib/landing';
import { actId } from '../lib/format';

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

export function AdAccountSelect({
  accounts,
  value,
  onChange,
  loading,
  disabled,
  className
}: {
  accounts: LauncherAdAccount[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled || loading}>
      <SelectTrigger className={cn('h-9 w-full text-sm', className)} aria-label="Ad account">
        <SelectValue placeholder={loading ? 'Loading ad accounts…' : accounts.length ? 'Pick an ad account' : 'No ad account available'} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map(a => (
          <SelectItem key={a.id} value={a.id}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-400">{actId(a.id)}</span>
              {a.isDemo && <DemoBadge />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  disabled
}: {
  options: LauncherOptions | null;
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const pages = options?.pages ?? [];
  const manual = !!options && pages.length === 0;
  return (
    <Field
      label={<>Facebook page<span className="text-rose-500"> *</span></>}
      aside={loading ? <Spinner /> : null}
      hint={manual ? 'No page found for this account — type its ID.' : undefined}
    >
      {manual ? (
        <Input value={value} onChange={e => onChange(e.target.value.trim())} placeholder="Page ID" inputMode="numeric" disabled={disabled} className="h-9" />
      ) : (
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled || !options}>
          <SelectTrigger className="h-9 w-full text-sm" aria-label="Facebook page">
            <SelectValue placeholder={options ? 'Pick a page' : 'Pick an ad account first'} />
          </SelectTrigger>
          <SelectContent>
            {pages.map(p => (
              <SelectItem key={p.externalId} value={p.externalId}>
                <span className="flex min-w-0 items-center gap-2">
                  <PageAvatar name={p.name} pictureUrl={p.pictureUrl} />
                  <span className="truncate">{p.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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
