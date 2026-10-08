/**
 * The one date range for the dashboard — Overview, Daily P&L and Orders all
 * read AppContext.dateRange, and this is the only control that writes it.
 *
 * Each tab used to carry its own picker, so switching tabs could silently
 * show a different period than the one you had just picked.
 *
 * Days are calendar days in the STORE timezone (AppContext.timezone), not the
 * browser's: "Today" for a US store viewed from Vietnam is the store's today.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppContext } from '@/context/AppContext';
import { addDaysToDateString, formatInTz, todayInTz, tzDayBoundsUtc } from '@/utils/dateUtils';
import { cn } from '@/lib/utils';

export type QuickRange = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'mtd' | 'ytd';

export const QUICK_RANGES: Array<{ key: QuickRange; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' }
];

/** Calendar-day bounds (YYYY-MM-DD, store tz) for a quick range. */
export function quickRangeDays(key: QuickRange, tz: string): { from: string; to: string } {
  const today = todayInTz(tz);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDaysToDateString(today, -1); return { from: y, to: y }; }
    case '7d': return { from: addDaysToDateString(today, -6), to: today };
    case '30d': return { from: addDaysToDateString(today, -29), to: today };
    case '90d': return { from: addDaysToDateString(today, -89), to: today };
    case 'mtd': return { from: today.slice(0, 7) + '-01', to: today };
    case 'ytd': return { from: today.slice(0, 4) + '-01-01', to: today };
  }
}

/** UTC instants spanning whole store-tz days. */
export function daysToRange(fromDay: string, toDay: string, tz: string): { from: Date; to: Date } {
  return { from: tzDayBoundsUtc(fromDay, tz).from, to: tzDayBoundsUtc(toDay, tz).to };
}

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

  const fromDay = formatInTz(from, timezone, 'yyyy-MM-dd');
  const toDay = formatInTz(to, timezone, 'yyyy-MM-dd');
  const today = todayInTz(timezone);
  const label = fromDay === toDay
    ? (fromDay === today ? `Today · ${formatInTz(from, timezone, 'MMM d, yyyy')}` : formatInTz(from, timezone, 'MMM d, yyyy'))
    : `${formatInTz(from, timezone, 'MMM d')} – ${formatInTz(to, timezone, 'MMM d, yyyy')}`;

  const pickQuick = (key: QuickRange) => {
    const d = quickRangeDays(key, timezone);
    onChange(daysToRange(d.from, d.to, timezone), key);
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
        <Button variant="outline" className={cn('justify-start font-normal min-w-[220px]', className)}>
          <CalendarIcon className="h-4 w-4 mr-2 text-slate-500" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 space-y-3" align={align}>
        <div className="flex flex-wrap gap-1">
          {QUICK_RANGES.map(r => (
            <Button key={r.key} size="sm" variant="ghost" onClick={() => pickQuick(r.key)}>{r.label}</Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={temp.from ? { from: temp.from, to: temp.to } : undefined}
          onSelect={r => setTemp({ from: r?.from, to: r?.to })}
          numberOfMonths={2}
          defaultMonth={new Date(`${fromDay}T12:00:00`)}
          className="rounded-md border"
        />
        <div className="flex items-center justify-between gap-3">
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

/** Bound to the shared dashboard range. */
export const GlobalDateRange = ({ className }: { className?: string }) => {
  const { dateRange, setDateRange, setSelectedDatePreset, timezone } = useAppContext();
  return (
    <DateRangeControl
      from={dateRange.from}
      to={dateRange.to}
      timezone={timezone}
      className={className}
      onChange={(range, quick) => {
        setDateRange(range);
        // AppContext re-anchors "today" at midnight / on tz change only while
        // the preset says today; anything else is a fixed range.
        setSelectedDatePreset(quick === 'today' ? 'today' : 'custom');
      }}
    />
  );
};
