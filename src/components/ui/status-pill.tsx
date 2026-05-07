import { cn } from '@/lib/utils';

/**
 * Meta Ads Manager-style status pill: colored dot + label.
 * Matches Meta's color palette and dot-then-label pattern from the real
 * delivery column.
 */
const STATUS_STYLES: Record<string, { dot: string; text: string; label?: string }> = {
  ACTIVE:              { dot: 'bg-emerald-500',  text: 'text-emerald-700', label: 'Active' },
  PAUSED:              { dot: 'bg-slate-400',    text: 'text-slate-600',   label: 'Paused' },
  DELETED:             { dot: 'bg-red-400',      text: 'text-red-700',     label: 'Deleted' },
  ARCHIVED:            { dot: 'bg-slate-300',    text: 'text-slate-500',   label: 'Archived' },
  PENDING_REVIEW:      { dot: 'bg-amber-400',    text: 'text-amber-700',   label: 'In Review' },
  IN_REVIEW:           { dot: 'bg-amber-400',    text: 'text-amber-700',   label: 'In Review' },
  DISAPPROVED:         { dot: 'bg-red-500',      text: 'text-red-700',     label: 'Rejected' },
  REJECTED:            { dot: 'bg-red-500',      text: 'text-red-700',     label: 'Rejected' },
  PREAPPROVED:         { dot: 'bg-blue-500',     text: 'text-blue-700',    label: 'Approved' },
  PENDING_BILLING_INFO:{ dot: 'bg-orange-400',   text: 'text-orange-700',  label: 'Billing Issue' },
  CAMPAIGN_PAUSED:     { dot: 'bg-slate-400',    text: 'text-slate-600',   label: 'Campaign Off' },
  ADSET_PAUSED:        { dot: 'bg-slate-400',    text: 'text-slate-600',   label: 'Ad Set Off' },
  WITH_ISSUES:         { dot: 'bg-orange-500',   text: 'text-orange-700',  label: 'Issue' },
  COMPLETED:           { dot: 'bg-slate-300',    text: 'text-slate-500',   label: 'Completed' },
  SCHEDULED:           { dot: 'bg-blue-400',     text: 'text-blue-700',    label: 'Scheduled' }
};

interface StatusPillProps {
  status: string;
  effectiveStatus?: string;
  className?: string;
}

export function StatusPill({ status, effectiveStatus, className }: StatusPillProps) {
  // effective_status is more accurate ("CAMPAIGN_PAUSED" tells us why an ad isn't running)
  const key = (effectiveStatus || status || '').toUpperCase();
  const style = STATUS_STYLES[key] || { dot: 'bg-slate-300', text: 'text-slate-500', label: key || 'Unknown' };

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', style.text, className)}>
      <span className={cn('h-2 w-2 rounded-full', style.dot)} />
      {style.label}
    </span>
  );
}
