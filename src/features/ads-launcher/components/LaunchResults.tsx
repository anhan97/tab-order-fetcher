/**
 * Launch progress and the per campaign / ad set / ad results (§3.2 step 4,
 * §7.3 response). `ok` with a warning still counts as created.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, ExternalLink, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ItemStatus, LaunchAdsetResult } from '@contract/ads-launcher';
import { adsManagerUrl } from '../lib/format';
import type { LaunchRunEntry } from '../lib/launch-run';
import type { LaunchRunState } from '../hooks/use-run-launch';

export interface LaunchResultsProps {
  run: LaunchRunState;
  adAccountId: string;
  /** Campaign-level lines only (Quick launch). */
  compact?: boolean;
  /** Present when something failed and can be sent again. */
  onRetryFailed?: () => void;
}

function StatusIcon({ status, className }: { status: ItemStatus | 'error'; className?: string }) {
  if (status === 'ok') return <CheckCircle2 className={cn('h-4 w-4 shrink-0 text-emerald-600', className)} />;
  if (status === 'skipped') return <CircleSlash className={cn('h-4 w-4 shrink-0 text-slate-400', className)} />;
  return <XCircle className={cn('h-4 w-4 shrink-0 text-rose-600', className)} />;
}

function AdsetLine({ adset }: { adset: LaunchAdsetResult }) {
  const [open, setOpen] = useState(adset.ads.some(a => a.status !== 'ok' || a.warning));
  const ok = adset.ads.filter(a => a.status === 'ok').length;
  return (
    <li className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <StatusIcon status={adset.status} className="mt-0.5 h-3.5 w-3.5" />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-xs font-medium text-slate-800">{adset.name}</span>
          <span className="block text-[11px] text-slate-500">
            {ok}/{adset.ads.length} ads created{adset.externalId ? ` · ${adset.externalId}` : ''}
          </span>
          {adset.error && <span className="block break-words text-[11px] text-rose-600">{adset.error}</span>}
          {adset.warning && <span className="block break-words text-[11px] text-amber-700">{adset.warning}</span>}
        </span>
        {adset.ads.length > 0 && <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-5">
          {adset.ads.map((ad, i) => (
            <li key={`${ad.name}-${i}`} className="flex items-start gap-1.5 text-[11px]">
              <StatusIcon status={ad.status} className="mt-px h-3 w-3" />
              <span className="min-w-0 break-words">
                <span className="text-slate-700">{ad.name}</span>
                {ad.externalId && <span className="font-mono text-slate-400"> · {ad.externalId}</span>}
                {ad.error && <span className="block text-rose-600">{ad.error}</span>}
                {ad.warning && <span className="block text-amber-700">{ad.warning}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function EntryCard({ entry, compact }: { entry: LaunchRunEntry; compact?: boolean }) {
  const name = entry.result?.campaign.name || (entry.request.campaign.mode === 'new' ? entry.request.campaign.name : `Campaign ${entry.request.campaign.campaignId}`);
  const status: ItemStatus | 'error' = entry.error ? 'error' : entry.result?.campaign.status ?? 'failed';
  const s = entry.result?.summary;
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <StatusIcon status={status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-slate-900">{name}</p>
          {s && (
            <p className="text-[11px] text-slate-500">
              {s.campaignCreated ? 'Campaign created' : entry.result?.campaign.status === 'ok' ? 'Existing campaign' : 'Campaign not created'} · {s.adsetsCreated} ad sets · {s.adsCreated} ads
              {s.adsFailed ? <span className="text-rose-600"> · {s.adsFailed} failed</span> : null}
            </p>
          )}
          {entry.error && <p className="break-words text-xs text-rose-600">{entry.error}</p>}
          {entry.result?.campaign.error && <p className="break-words text-xs text-rose-600">{entry.result.campaign.error}</p>}
          {entry.result?.campaign.warning && <p className="break-words text-xs text-amber-700">{entry.result.campaign.warning}</p>}
        </div>
      </div>
      {!compact && entry.result && entry.result.adsets.length > 0 && (
        <ul className="mt-2 space-y-1 pl-6">
          {entry.result.adsets.map((a, i) => <AdsetLine key={`${a.name}-${i}`} adset={a} />)}
        </ul>
      )}
    </li>
  );
}

export function LaunchResults({ run, adAccountId, compact, onRetryFailed }: LaunchResultsProps) {
  if (run.phase === 'idle') return null;
  const pct = run.total ? Math.round((run.completed / run.total) * 100) : 0;
  const t = run.totals;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3" aria-live="polite">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            {run.phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-teal-600" /> : t && t.failed > 0 ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {run.phase === 'running'
              ? `Launching campaign ${Math.min(run.completed + 1, run.total)} of ${run.total}…`
              : t
                ? `${t.ok} ad${t.ok === 1 ? '' : 's'} launched${t.failed ? `, ${t.failed} failed` : ''}`
                : 'Done'}
          </p>
          {run.phase === 'done' && (
            <div className="flex flex-wrap items-center gap-3">
              {onRetryFailed && (
                <Button type="button" size="sm" variant="outline" className="h-7 gap-1 border-amber-300 text-xs text-amber-800 hover:bg-amber-50" onClick={onRetryFailed}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry failed ads
                </Button>
              )}
              {adAccountId && (
                <a href={adsManagerUrl(adAccountId)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
                  Open in Ads Manager <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
        <Progress value={pct} className="h-2 [&>div]:bg-teal-600" aria-label="Launch progress" />
        {run.phase === 'running' && <p className="text-[11px] text-slate-500">Keep this page open until every campaign is sent. Videos can take a few minutes while Meta processes them.</p>}
        {run.phase === 'done' && onRetryFailed && (
          <p className="text-[11px] text-slate-500">Retry sends only what failed, into the campaigns and ad sets already created — nothing is duplicated.</p>
        )}
      </div>
      {run.entries.length > 0 && (
        <ul className="space-y-2">
          {run.entries.map(e => <EntryCard key={e.index} entry={e} compact={compact} />)}
        </ul>
      )}
    </div>
  );
}
