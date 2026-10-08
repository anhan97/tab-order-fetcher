import { useState } from 'react';
import { Check, ChevronsUpDown, Package } from 'lucide-react';
import type { ProductOption } from '@contract/ads-launcher';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const ALL = '__all__';

interface ProductPickerProps {
  products: ProductOption[] | undefined;
  value: string | null;
  onChange: (productId: string | null) => void;
  /** Offer "All products" (value null). */
  allowAll?: boolean;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  /** Inside a Dialog: modal popover so the list scrolls with the wheel. */
  modal?: boolean;
  id?: string;
}

function ProductImage({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" loading="lazy" />
  ) : (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
      <Package className="h-3.5 w-3.5" />
    </span>
  );
}

/** Searchable product select (title, code or handle). */
export function ProductPicker({
  products, value, onChange, allowAll, placeholder = 'Select a product', loading, disabled, className, modal, id
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = products?.find(p => p.id === value) ?? null;

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full justify-between gap-2 px-3 font-normal', className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <ProductImage url={selected.imageUrl} />
                {/* Title first: the code only shows when there is room left over. */}
                <span className="truncate" title={selected.code ? `${selected.title} · ${selected.code}` : selected.title}>{selected.title}</span>
                {selected.code && <span className="hidden min-w-0 truncate font-mono text-[11px] text-slate-400 xl:inline">{selected.code}</span>}
              </>
            ) : (
              <span className="truncate text-slate-500">
                {loading ? 'Loading products…' : allowAll && value === null ? 'All products' : placeholder}
              </span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(320px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search title or code…" />
          <CommandList className="max-h-72">
            <CommandEmpty>{loading ? 'Loading…' : 'No product found.'}</CommandEmpty>
            <CommandGroup>
              {allowAll && (
                <CommandItem value={ALL} keywords={['all products']} onSelect={() => pick(null)}>
                  <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                  All products
                </CommandItem>
              )}
              {(products ?? []).map(p => (
                <CommandItem key={p.id} value={p.id} keywords={[p.title, p.code, p.handle].filter(Boolean)} onSelect={() => pick(p.id)} className="gap-2">
                  <Check className={cn('h-4 w-4 shrink-0', value === p.id ? 'opacity-100' : 'opacity-0')} />
                  <ProductImage url={p.imageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.title}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-400">{p.code || p.handle}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400" title="Creatives">{p.creatives}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
