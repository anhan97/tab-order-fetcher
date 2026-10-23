/**
 * The one date range for the dashboard — Overview, Daily P&L and Orders all
 * read AppContext.dateRange, and this is the only control that writes it.
 *
 * Each tab used to carry its own picker, so switching tabs could silently
 * show a different period than the one you had just picked.
 *
 * Days are calendar days in the STORE timezone (AppContext.timezone), not the
 * browser's: "Today" for a US store viewed from Vietnam is the store's today.
 *
 * The common ranges are one tap (chips, not hidden in the popover), and the
 * last one picked is remembered — looking at several days used to mean
 * opening a two-month calendar that did not even fit on a phone.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppContext } from '@/context/AppContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatInTz, todayInTz } from '@/utils/dateUtils';
import { daysToRange, matchQuickRange, QUICK_RANGES, quickRangeBounds, type QuickRange } from '@/lib/quick-ranges';
import { cn } from '@/lib/utils';

export { daysToRange, quickRangeDays, QUICK_RANGES, type QuickRange } from '@/lib/quick-ranges';

interface Props {
  from: Date;
  to: Date;
  timezone: string;
  onChange: (range: { from: Date; to: Date }, quick: QuickRange | null) => void;
  className?: string;
  align?: 'start' | 'end';
}

/** Presentational picker — the Fulfillment page reuses it with its own state. */
export const DateRangeControl = ({ from, to, timezone, onChange, className, align = 'end' }: Props) => {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<{ from?: Date; to?: Date }>({});
  const isMobile = useIsMobile();

  const fromDay = formatInTz(from, timezone, 'yyyy-MM-dd');
  const toDay = formatInTz(to, timezone, 'yyyy-MM-dd');
  const today = todayInTz(timezone);
  const label = fromDay === toDay
    ? (fromDay === today ? `Today · ${formatInTz(from, timezone, 'MMM d, yyyy')}` : formatInTz(from, timezone, 'MMM d, yyyy'))
    : `${formatInTz(from, timezone, 'MMM d')} – ${formatInTz(to, timezone, 'MMM d, yyyy')}`;

  const pickQuick = (key: QuickRange) => {
    onChange(quickRangeBounds(key, timezone), key);
    setOpen(false);
  };

  const apply = () => {
    if (!temp.from) return;
    // The calendar hands back browser-local dates; only their Y-M-D matters.
    const f = format(temp.from, 'yyyy-MM-dd');
    const t = format(temp.to ?? temp.from, 'yyyy-MM-dd');
    onChange(daysToRange(f <= t ? f : t, f <= t ? t : f, timezone), null);
    setTemp({});
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setTemp({}); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start font-normal sm:min-w-[220px]', className)}>
          <CalendarIcon className="h-4 w-4 mr-2 shrink-0 text-slate-500" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] p-3 space-y-3" align={align}>
        <div className="flex flex-wrap gap-1">
          {QUICK_RANGES.map(r => (
            <Button key={r.key} size="sm" variant="ghost" onClick={() => pickQuick(r.key)}>{r.label}</Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={temp.from ? { from: temp.from, to: temp.to } : undefined}
          onSelect={r => setTemp({ from: r?.from, to: r?.to })}
          numberOfMonths={isMobile ? 1 : 2}
          defaultMonth={new Date(`${fromDay}T12:00:00`)}
          className="rounded-md border"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {temp.from
              ? <>From <b>{format(temp.from, 'MMM dd')}</b>{temp.to ? <> to <b>{format(temp.to, 'MMM dd')}</b></> : ' (single day)'}</>
              : `Days are in the store timezone (${timezone}).`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setTemp({}); setOpen(false); }}>Cancel</Button>
            <Button size="sm" onClick={apply} disabled={!temp.from}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** One tap away on the dashboard; the rest are in the picker. */
const CHIPS: QuickRange[] = ['today', 'yesterday', '7d', '30d', 'mtd'];

/** Bound to the shared dashboard range. */
export const GlobalDateRange = ({ className }: { className?: string }) => {
  const { dateRange, setDateRange, setSelectedDatePreset, setQuickRange, timezone } = useAppContext();
  const active = matchQuickRange(dateRange, timezone);
  const pick = (range: { from: Date; to: Date }, quick: QuickRange | null) => {
    setDateRange(range);
    setQuickRange(quick);
    // AppContext re-anchors a relative range when the timezone changes;
    // anything else is a fixed range.
    setSelectedDatePreset(quick === 'today' ? 'today' : 'custom');
  };
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
        {CHIPS.map(key => (
          <button
            key={key}
            type="button"
            aria-pressed={active === key}
            onClick={() => pick(quickRangeBounds(key, timezone), key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              active === key ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {QUICK_RANGES.find(r => r.key === key)!.label}
          </button>
        ))}
      </div>
      <DateRangeControl from={dateRange.from} to={dateRange.to} timezone={timezone} onChange={pick} className="h-9 min-w-0 max-w-full" />
    </div>
  );
};
