/**
 * Step 2 — Creatives: build the pool from library creatives, existing posts
 * or post IDs. The pool keeps selection order (it decides how the structure
 * deals items, §5).
 */
import { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ProductOption } from '@contract/ads-launcher';
import type { PoolItem } from '../lib/pool';
import { CreativePoolPicker, type CreativePoolPickerProps } from './CreativePoolPicker';
import { AddByPostId, PostPoolPicker, type PostPoolPickerProps } from './PostPoolPicker';
import { PoolThumb } from './PoolThumb';
import { ProductSelect } from './setup-fields';

export interface StepCreativesProps {
  pool: PoolItem[];
  onRemove: (key: string) => void;
  onClear: () => void;
  /** No product yet: creatives need one. */
  needsProduct: boolean;
  products: ProductOption[];
  productsLoading: boolean;
  onProduct: (id: string) => void;
  creatives: Omit<CreativePoolPickerProps, 'selectedKeys' | 'disabled'>;
  posts: Omit<PostPoolPickerProps, 'selectedKeys' | 'disabled'>;
  onAddPostIds: (postIds: string[]) => Promise<{ added: number; unknown: number }>;
  disabled?: boolean;
}

export function PoolStrip({ pool, onRemove, onClear, disabled }: { pool: PoolItem[]; onRemove: (key: string) => void; onClear: () => void; disabled?: boolean }) {
  const creatives = pool.filter(i => i.kind === 'creative').length;
  const posts = pool.length - creatives;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Layers className="h-3.5 w-3.5 text-teal-600" />
          Pool · {pool.length} selected
          {pool.length > 0 && (
            <span className="font-normal text-slate-500">
              ({creatives} creative{creatives === 1 ? '' : 's'}{posts ? `, ${posts} post${posts === 1 ? '' : 's'}` : ''})
            </span>
          )}
        </p>
        {pool.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClear} disabled={disabled}>
            Clear
          </Button>
        )}
      </div>
      {pool.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing yet. The order you pick in is the order the structure deals them.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 pr-1.5 pt-1.5">
          {pool.map((item, i) => (
            <div key={item.key} className="group relative shrink-0">
              <PoolThumb item={item} order={i + 1} size="md" />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onRemove(item.key)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow sm:hidden sm:group-hover:flex sm:group-focus-within:flex"
                  aria-label={`Remove ${item.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <p className="mt-0.5 w-16 truncate text-[10px] text-slate-500" title={item.name}>{item.angle || item.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StepCreatives(props: StepCreativesProps) {
  const [tab, setTab] = useState(props.pool.some(i => i.kind === 'post') && !props.pool.some(i => i.kind === 'creative') ? 'posts' : 'creatives');
  const keys = props.pool.map(i => i.key);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PoolStrip pool={props.pool} onRemove={props.onRemove} onClear={props.onClear} disabled={props.disabled} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="creatives" className="text-xs">Creatives</TabsTrigger>
          <TabsTrigger value="posts" className="text-xs">Posts</TabsTrigger>
          <TabsTrigger value="ids" className="text-xs">Add by post ID</TabsTrigger>
        </TabsList>
        <TabsContent value="creatives" className="mt-3">
          {props.needsProduct ? (
            <div className="max-w-md space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">Pick the product first</p>
              <p className="text-xs text-slate-500">The library lists the creatives of one product per launch.</p>
              <ProductSelect products={props.products} value={null} onChange={props.onProduct} loading={props.productsLoading} disabled={props.disabled} />
            </div>
          ) : (
            <CreativePoolPicker {...props.creatives} selectedKeys={keys} disabled={props.disabled} />
          )}
        </TabsContent>
        <TabsContent value="posts" className="mt-3">
          <PostPoolPicker {...props.posts} selectedKeys={keys} disabled={props.disabled} />
        </TabsContent>
        <TabsContent value="ids" className="mt-3">
          <AddByPostId onAdd={props.onAddPostIds} disabled={props.disabled} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
