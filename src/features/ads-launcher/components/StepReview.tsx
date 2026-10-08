/**
 * Step 4 — Review & launch (§3.2): what will be launched, copy edits with a
 * live preview, start time, status. Everything is locked while sending.
 */
import { CalendarClock, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { NodeStatus } from '@contract/ads-launcher';
import type { LaunchRunState } from '../hooks/use-run-launch';
import { CopyEditor, type CopyEditorProps } from './CopyEditor';
import { IssuesList } from './IssuesList';
import { LaunchResults } from './LaunchResults';
import { LaunchSummary, type LaunchSummaryProps } from './LaunchSummary';
import { StatusSelect } from './PresetForm';
import { Field } from './setup-fields';

export interface StepReviewProps {
  summary: Omit<LaunchSummaryProps, 'disabled'> | null;
  copy: Omit<CopyEditorProps, 'disabled'>;
  startTime: string;
  onStartTime: (value: string) => void;
  status: NodeStatus;
  onStatus: (status: NodeStatus) => void;
  issues: string[];
  run: LaunchRunState;
  adAccountId: string;
  /** Sending: everything read-only. */
  locked: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function StepReview(props: StepReviewProps) {
  const { locked } = props;
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  })();
  const past = !!props.startTime && new Date(props.startTime).getTime() < Date.now();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <LaunchResults run={props.run} adAccountId={props.adAccountId} />
      {locked && (
        <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {props.run.phase === 'running'
            ? 'Editing is locked while the campaigns are being sent.'
            : 'This launch is done. "Launch more" starts a new one with the same setup.'}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">{props.summary && <LaunchSummary {...props.summary} disabled={locked} />}</div>
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
            <Field
              label={<span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Start time</span>}
              hint={past ? undefined : `Blank = start now.${tz ? ` Your time zone: ${tz}.` : ''}`}
              error={past ? 'This time has passed — leave it blank to start now.' : undefined}
              htmlFor="al-start"
            >
              <Input
                id="al-start"
                type="datetime-local"
                value={props.startTime}
                min={localNow()}
                onChange={e => props.onStartTime(e.target.value)}
                disabled={locked}
                className="h-9"
              />
            </Field>
            <Field label="Status" hint={props.status === 'ACTIVE' ? 'Delivery starts once Meta approves the ads.' : 'Created paused: turn them on in Ads Manager.'}>
              <StatusSelect value={props.status} onChange={props.onStatus} disabled={locked} />
            </Field>
          </div>
          <IssuesList issues={props.issues} okText="Ready to launch." />
        </div>
      </div>
      <CopyEditor {...props.copy} disabled={locked} />
    </div>
  );
}
