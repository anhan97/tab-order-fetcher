import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStep {
  label: string;
  hint?: string;
}

interface WizardStepperProps {
  steps: readonly WizardStep[];
  current: number;
  /** Highest step the user may jump to (earlier steps are complete). */
  maxReachable: number;
  onStep: (index: number) => void;
  disabled?: boolean;
}

/** Numbered steps; reachable ones are clickable. Labels hide on narrow screens except the current one. */
export function WizardStepper({ steps, current, maxReachable, onStep, disabled }: WizardStepperProps) {
  return (
    <ol className="flex w-full items-center gap-1 sm:gap-2" aria-label="Launch steps">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReachable && !disabled;
        return (
          <li key={s.label} className={cn('flex min-w-0 items-center gap-1 sm:gap-2', i < steps.length - 1 && 'flex-1')}>
            <button
              type="button"
              onClick={() => reachable && onStep(i)}
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-left text-xs transition-colors sm:pr-3',
                active && 'bg-teal-50 text-teal-800',
                !active && reachable && 'text-slate-600 hover:bg-slate-100',
                !reachable && !active && 'cursor-default text-slate-400'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  active ? 'bg-teal-600 text-white' : done ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('min-w-0', !active && 'hidden md:block')}>
                <span className="block truncate font-semibold">{s.label}</span>
                {s.hint && <span className="hidden truncate text-[10px] font-normal text-slate-500 lg:block">{s.hint}</span>}
              </span>
            </button>
            {i < steps.length - 1 && <span className={cn('h-px min-w-2 flex-1', done ? 'bg-teal-300' : 'bg-slate-200')} />}
          </li>
        );
      })}
    </ol>
  );
}
