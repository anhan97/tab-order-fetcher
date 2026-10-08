/**
 * Step 1 — Setup: product · pixel · page · landing page · URL parameters (§3.2).
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Package, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { DEFAULT_URL_TAGS, LIMITS, type LauncherOptions, type ProductOption } from '@contract/ads-launcher';
import type { LandingGroup } from '../lib/landing';
import { CUSTOM_LANDING, displayLinkFor } from '../lib/landing';
import type { LaunchSetup } from '../lib/structure';
import type { LauncherProduct } from '../hooks/use-launcher-model';
import { Field, LandingSelect, PageField, PixelField, ProductSelect } from './setup-fields';
import { IssuesList } from './IssuesList';

export interface StepSetupProps {
  setup: LaunchSetup;
  landingId: string;
  product: LauncherProduct | null;
  productInferred: boolean;
  products: ProductOption[];
  productsLoading: boolean;
  onProduct: (id: string) => void;
  options: LauncherOptions | null;
  optionsLoading: boolean;
  optionsError: string | null;
  pixelRequired: boolean;
  groups: LandingGroup[];
  landingLoading: boolean;
  landingError: string | null;
  /** The pool is only existing posts: no landing page needed. */
  postsOnly: boolean;
  issues: string[];
  onSetup: (patch: Partial<LaunchSetup>) => void;
  onLanding: (landingId: string) => void;
  onLandingUrl: (url: string) => void;
  disabled?: boolean;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function StepSetup(props: StepSetupProps) {
  const { setup, disabled, options } = props;
  const urlHost = displayLinkFor(setup.landingUrl);
  const showHostHint = !!urlHost && setup.displayLink.trim() !== '' && setup.displayLink.trim() !== urlHost;
  const tagsTooLong = setup.urlTags.length > LIMITS.urlTagsLength;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Section title="Product" description="One product per launch. Creatives, posts and landing pages are listed for it.">
        {props.productInferred && props.product ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            {props.product.imageUrl ? (
              <img src={props.product.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded bg-slate-200 text-slate-500"><Package className="h-5 w-5" /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{props.product.title || 'Product'}</p>
              <p className="text-[11px] text-slate-500">
                {props.product.code && <span className="mr-2 font-mono">{props.product.code}</span>}
                From the first creative in the pool — clear the pool to change it.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-md">
            <ProductSelect
              products={props.products}
              value={props.product?.id ?? null}
              onChange={props.onProduct}
              loading={props.productsLoading}
              disabled={disabled}
            />
          </div>
        )}
      </Section>

      <Section title="Pixel & page">
        {props.optionsError && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Could not load this ad account: {props.optionsError}
          </p>
        )}
        {options?.warnings?.length ? (
          <ul className="mb-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            {options.warnings.map(w => <li key={w}>{w}</li>)}
          </ul>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <PixelField
            options={options}
            value={setup.pixelId}
            onChange={pixelId => props.onSetup({ pixelId })}
            required={props.pixelRequired}
            loading={props.optionsLoading}
            disabled={disabled}
          />
          <PageField
            options={options}
            value={setup.pageId}
            onChange={pageId => props.onSetup({ pageId })}
            loading={props.optionsLoading}
            disabled={disabled}
          />
        </div>
      </Section>

      <Section
        title="Landing page"
        description={props.postsOnly ? 'Not needed: every ad runs an existing post, which keeps its own link.' : 'Grouped by store domain. Picking a page fills the URL and the display link.'}
      >
        <div className="space-y-4">
          <Field label={<>Page{!props.postsOnly && <span className="text-rose-500"> *</span>}</>} error={props.landingError ? `Could not load store pages: ${props.landingError}` : undefined}>
            <LandingSelect
              groups={props.groups}
              value={props.landingId}
              onChange={props.onLanding}
              loading={props.landingLoading}
              noProduct={!props.product}
              disabled={disabled}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="URL" htmlFor="al-url" hint={props.landingId === CUSTOM_LANDING ? 'Custom URL' : undefined}>
              <Input
                id="al-url"
                value={setup.landingUrl}
                onChange={e => props.onLandingUrl(e.target.value)}
                placeholder="https://your-store.com/products/…"
                disabled={disabled}
                className="h-9"
              />
            </Field>
            <Field
              label="Display link"
              htmlFor="al-display"
              hint={
                showHostHint ? (
                  <button type="button" className="text-teal-700 hover:underline" onClick={() => props.onSetup({ displayLink: urlHost })} disabled={disabled}>
                    Use {urlHost}
                  </button>
                ) : undefined
              }
            >
              <Input
                id="al-display"
                value={setup.displayLink}
                onChange={e => props.onSetup({ displayLink: e.target.value })}
                placeholder="your-store.com"
                maxLength={255}
                disabled={disabled}
                className="h-9"
              />
            </Field>
          </div>
          <Field
            label="URL parameters"
            htmlFor="al-tags"
            error={tagsTooLong ? `Too long: ${setup.urlTags.length}/${LIMITS.urlTagsLength} characters` : undefined}
            hint="Meta fills {{campaign.name}}, {{adset.name}}, {{ad.name}} and {{ad.id}} when the ad runs."
            aside={
              setup.urlTags !== DEFAULT_URL_TAGS ? (
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => props.onSetup({ urlTags: DEFAULT_URL_TAGS })} disabled={disabled}>
                  <RotateCcw className="h-3 w-3" /> Default
                </Button>
              ) : null
            }
          >
            <Textarea
              id="al-tags"
              value={setup.urlTags}
              onChange={e => props.onSetup({ urlTags: e.target.value })}
              rows={2}
              disabled={disabled}
              className="min-h-0 break-all font-mono text-xs"
            />
          </Field>
        </div>
      </Section>

      <IssuesList issues={props.issues} title="Before you continue" />
    </div>
  );
}
