import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IssuesListProps {
  issues: string[];
  /** Text shown when there is nothing blocking; omit to render nothing. */
  okText?: string;
  title?: string;
  className?: string;
}

/** Blocking problems (§5.5) under the diagram / in review. */
export function IssuesList({ issues, okText, title = 'Fix before launching', className }: IssuesListProps) {
  if (issues.length === 0) {
    if (!okText) return null;
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800', className)}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {okText}
      </div>
    );
  }
  return (
    <div role="alert" className={cn('rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900', className)}>
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        {title}
      </p>
      <ul className="list-disc space-y-0.5 pl-6">
        {issues.map(i => (
          <li key={i} className="break-words">{i}</li>
        ))}
      </ul>
    </div>
  );
}
