import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TimezoneSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label'?: string;
}

// Named IANA zones — these honor DST automatically, so they're the right
// choice for matching a Shopify store's local "today" boundary.
const NAMED_ZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific)' },
  { value: 'America/Denver', label: 'Denver (Mountain)' },
  { value: 'America/Chicago', label: 'Chicago (Central)' },
  { value: 'America/New_York', label: 'New York (Eastern)' },
  { value: 'America/Toronto', label: 'Toronto' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris / Berlin / Madrid' },
  { value: 'Europe/Athens', label: 'Athens / Helsinki' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Asia/Bangkok', label: 'Bangkok / Hanoi / Jakarta' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh' },
  { value: 'Asia/Singapore', label: 'Singapore / Manila' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Tokyo', label: 'Tokyo / Seoul' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' }
];

// Fixed-offset fallback — preserved so older saved values like Etc/GMT+6
// still render gracefully and remain reachable from the picker.
const generateGMTOffsets = (): Array<{ value: string; label: string }> => {
  const offsets: Array<{ value: string; label: string }> = [];
  for (let i = -12; i <= 14; i++) {
    const sign = i >= 0 ? '+' : '';
    const value = `Etc/GMT${sign}${-i}`; // Note: Etc/GMT uses opposite sign
    const label = `GMT${sign}${i}:00 (no DST)`;
    offsets.push({ value, label });
  }
  return offsets;
};

const FIXED_OFFSETS = generateGMTOffsets();

export function TimezoneSelect({ value, onValueChange, 'aria-label': ariaLabel }: TimezoneSelectProps) {
  const [mounted, setMounted] = useState(false);

  // Only show timezone select after mounting to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      aria-label={ariaLabel || 'Select timezone'}
    >
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select timezone">
          {labelFor(value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[400px]">
        <SelectLabel>Region</SelectLabel>
        {NAMED_ZONES.map(tz => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectLabel>Fixed offset</SelectLabel>
        {FIXED_OFFSETS.map(tz => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function labelFor(tz: string): string {
  const named = NAMED_ZONES.find(z => z.value === tz);
  if (named) return named.label;
  const offset = FIXED_OFFSETS.find(z => z.value === tz);
  if (offset) return offset.label;
  return tz;
}
