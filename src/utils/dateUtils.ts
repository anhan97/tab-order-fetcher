import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, format, parseISO } from 'date-fns';

// Standardized date presets for the entire app
export type DatePreset = 'today' | 'yesterday' | '7days' | '30days' | '90days' | 'custom';

// Los Angeles timezone offset (UTC-8 in winter, UTC-7 in summer)
// For simplicity, we'll use UTC-8 (PST) - this can be enhanced later with proper timezone handling
const LA_OFFSET_HOURS = -8;

// Get current time adjusted for Los Angeles timezone
export function getLACurrentTime(): Date {
  const now = new Date();
  const laTime = new Date(now.getTime() + (LA_OFFSET_HOURS * 60 * 60 * 1000));
  return laTime;
}

// Convert a date to Los Angeles timezone
export function toLATime(date: Date): Date {
  return new Date(date.getTime() + (LA_OFFSET_HOURS * 60 * 60 * 1000));
}

// Convert a Los Angeles time to UTC
export function fromLATime(date: Date): Date {
  return new Date(date.getTime() - (LA_OFFSET_HOURS * 60 * 60 * 1000));
}

// Get standardized date range from preset using Los Angeles timezone
export function getDateRangeFromPreset(preset: DatePreset): { from: Date; to: Date } {
  const now = getLACurrentTime();
  const today = startOfDay(now);
  const endOfToday = endOfDay(now);

  switch (preset) {
    case 'today':
      return {
        from: today,
        to: endOfToday
      };
    case 'yesterday':
      const yesterday = subDays(now, 1);
      return {
        from: startOfDay(yesterday),
        to: endOfDay(yesterday)
      };
    case '7days':
      return {
        from: startOfDay(subDays(now, 6)),
        to: endOfToday
      };
    case '30days':
      return {
        from: startOfDay(subDays(now, 29)),
        to: endOfToday
      };
    case '90days':
      return {
        from: startOfDay(subDays(now, 89)),
        to: endOfToday
      };
    case 'custom':
    default:
      // Default to last 30 days
      return {
        from: startOfDay(subDays(now, 29)),
        to: endOfToday
      };
  }
}

// Format date range for display
export function formatDateRange(from: Date, to: Date): string {
  return `${format(from, "LLL dd, yyyy")} - ${format(to, "LLL dd, yyyy")}`;
}

// Format date range for display in Los Angeles timezone
export function formatLADateRange(from: Date, to: Date): string {
  const laFrom = toLATime(from);
  const laTo = toLATime(to);
  return `${format(laFrom, "LLL dd, yyyy")} - ${format(laTo, "LLL dd, yyyy")}`;
}

// Validate and normalize date range using Los Angeles timezone
export function validateDateRange(from: Date, to: Date): { from: Date; to: Date } {
  const now = getLACurrentTime();
  const endOfToday = endOfDay(now);
  
  // Ensure 'to' date is not in the future
  const validTo = to > endOfToday ? endOfToday : to;
  
  // Ensure 'from' date is not after 'to' date
  const validFrom = from > validTo ? startOfDay(validTo) : from;
  
  return {
    from: startOfDay(validFrom),
    to: endOfDay(validTo)
  };
}

// Get date preset options for UI
export function getDatePresetOptions(): { value: DatePreset; label: string }[] {
  return [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: '7days', label: 'Last 7 days' },
    { value: '30days', label: 'Last 30 days' },
    { value: '90days', label: 'Last 90 days' },
    { value: 'custom', label: 'Custom range' }
  ];
}

// Convert date range to Shopify API format (UTC)
export function getShopifyDateRange(from: Date, to: Date): { min: string; max: string } {
  // Convert LA time to UTC for Shopify API
  const utcFrom = fromLATime(from);
  const utcTo = fromLATime(to);
  
  return {
    min: utcFrom.toISOString(),
    max: utcTo.toISOString()
  };
}

// Convert date range to Facebook API format (UTC)
export function getFacebookDateRange(from: Date, to: Date): { since: string; until: string } {
  // Convert LA time to UTC for Facebook API
  const utcFrom = fromLATime(from);
  const utcTo = fromLATime(to);
  
  return {
    since: format(utcFrom, 'yyyy-MM-dd'),
    until: format(utcTo, 'yyyy-MM-dd')
  };
} 