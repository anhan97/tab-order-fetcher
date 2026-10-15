/**
 * Searchable single-select for lists that can run long (ad accounts and pages
 * of a whole Business Manager). Same pattern as the creatives' ProductPicker:
 * the list stays the trigger's width (names truncate, full name on hover),
 * scrolls inside a fixed height, and filters by name or id as you type.
 */
import { useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface SearchPickerItem {
  value: string;
  label: string;
  /** Second line: ids, currency, status… */
  sub?: ReactNode;
  /** Left of the label (avatar). */
  leading?: ReactNode;
  /** Right of the label (badge). */
  trailing?: ReactNode;
  /** Extra text the search matches (ids…). */
  keywords?: string[];
}

export function SearchPicker({
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder = 'Search…',
  emptyText = 'Nothing found.',
  ariaLabel,
  disabled,
  modal,
  align = 'start',
  className,
  renderValue
}: {
  items: SearchPickerItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Inside a Dialog: modal popover so the list scrolls with the wheel. */
  modal?: boolean;
  align?: 'start' | 'end';
  className?: string;
  /** Trigger content for the selected item (defaults to leading + label). */
  renderValue?: (item: SearchPickerItem) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full min-w-0 justify-between gap-2 px-3 text-sm font-normal', className)}
        >
          <span className="flex min-w-0 items-center gap-2" title={selected?.label}>
            {selected ? (
              renderValue ? renderValue(selected) : (
                <>
                  {selected.leading}
                  <span className="truncate">{selected.label}</span>
                </>
              )
            ) : (
              <span className="truncate text-slate-500">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(340px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          {items.length > 6 && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList className="max-h-[min(20rem,50vh)]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map(i => (
                <CommandItem
                  key={i.value}
                  value={i.value}
                  keywords={[i.label, ...(i.keywords ?? [])]}
                  onSelect={() => {
                    onChange(i.value);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === i.value ? 'opacity-100' : 'opacity-0')} />
                  {i.leading}
                  <span className="min-w-0 flex-1" title={i.label}>
                    {/* Two lines, not an ellipsis: long names often differ only at the end. */}
                    <span className="line-clamp-2 break-words">{i.label}</span>
                    {i.sub && <span className="block truncate text-[11px] text-slate-400">{i.sub}</span>}
                  </span>
                  {i.trailing}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
