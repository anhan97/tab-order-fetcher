import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TimezoneSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label'?: string;
}

// Generate all possible GMT offsets from -12 to +14
const generateGMTOffsets = () => {
  const offsets = [];
  for (let i = -12; i <= 14; i++) {
    const sign = i >= 0 ? '+' : '';
    const value = `Etc/GMT${sign}${-i}`; // Note: Etc/GMT uses opposite sign
    const label = `GMT${sign}${i}:00`;
    offsets.push({ value, label });
  }
  return offsets;
};

const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC (GMT+0)' },
  ...generateGMTOffsets()
];

export function TimezoneSelect({ value, onValueChange, 'aria-label': ariaLabel }: TimezoneSelectProps) {
  const [mounted, setMounted] = useState(false);

  // Only show timezone select after mounting to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Convert value to display format if it's a GMT offset
  const getDisplayValue = (tz: string) => {
    if (tz.startsWith('Etc/GMT')) {
      const offset = parseInt(tz.replace('Etc/GMT', ''));
      const sign = offset >= 0 ? '+' : '';
      return `GMT${sign}${-offset}:00`; // Convert back to standard GMT format
    }
    return tz;
  };

  // Convert display format to IANA format for storage
  const handleChange = (newValue: string) => {
    if (newValue.startsWith('GMT')) {
      const offset = parseInt(newValue.replace('GMT', ''));
      const sign = offset >= 0 ? '+' : '';
      onValueChange(`Etc/GMT${sign}${-offset}`); // Convert to IANA format
    } else {
      onValueChange(newValue);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <Select 
      value={getDisplayValue(value)} 
      onValueChange={handleChange}
      aria-label={ariaLabel || "Select timezone"}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select timezone" />
      </SelectTrigger>
      <SelectContent>
        {TIMEZONE_OPTIONS.map((timezone) => (
          <SelectItem 
            key={timezone.value} 
            value={timezone.label}
            aria-label={timezone.label}
          >
            {timezone.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
} 