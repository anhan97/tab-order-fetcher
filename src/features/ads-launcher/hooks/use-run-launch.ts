/**
 * The launch loop (§12.3): one request per campaign, sent one after another.
 * Each request gets a fresh `requestId` (idempotency key); all share one
 * `launchId` so the server reuses uploaded media / Meta creatives across them.
 * A failed request is recorded and the loop moves on.
 */
import { useCallback, useRef, useState } from 'react';
import type { LaunchRequest } from '@contract/ads-launcher';
import { useToast } from '@/hooks/use-toast';
import { launcherApi } from '../api/ads-launcher-api';
import { useInvalidateAfterLaunch } from './queries';
import { errorMessage } from '../lib/format';
import { newUuid, runToastTitle, summarizeRun, type LaunchRunEntry, type LaunchTotals } from '../lib/launch-run';
import type { LaunchRequestDraft } from '../lib/structure';

export type LaunchPhase = 'idle' | 'running' | 'done';

export interface LaunchRunState {
  phase: LaunchPhase;
  launchId: string | null;
  /** Requests in this run. */
  total: number;
  /** Requests answered so far. */
  completed: number;
  entries: LaunchRunEntry[];
  totals: LaunchTotals | null;
}

const IDLE: LaunchRunState = { phase: 'idle', launchId: null, total: 0, completed: 0, entries: [], totals: null };

export function useRunLaunch() {
  const [state, setState] = useState<LaunchRunState>(IDLE);
  const busy = useRef(false);
  const invalidate = useInvalidateAfterLaunch();
  const { toast } = useToast();

  const run = useCallback(
    async (drafts: LaunchRequestDraft[]): Promise<LaunchRunEntry[]> => {
      if (busy.current || drafts.length === 0) return [];
      busy.current = true;
      const launchId = newUuid();
      const entries: LaunchRunEntry[] = [];
      setState({ phase: 'running', launchId, total: drafts.length, completed: 0, entries: [], totals: null });
      try {
        for (let i = 0; i < drafts.length; i++) {
          const request: LaunchRequest = { ...drafts[i], requestId: newUuid(), launchId };
          try {
            entries.push({ index: i, request, result: await launcherApi.launch(request), error: null });
          } catch (err) {
            entries.push({ index: i, request, result: null, error: errorMessage(err) });
          }
          setState((s) => ({ ...s, completed: i + 1, entries: [...entries] }));
        }
      } finally {
        const totals = summarizeRun(entries);
        setState((s) => ({ ...s, phase: 'done', totals }));
        busy.current = false;
        void invalidate();
        toast({
          title: runToastTitle(totals),
          variant: totals.ok === 0 && totals.failed > 0 ? 'destructive' : 'default'
        });
      }
      return entries;
    },
    [invalidate, toast]
  );

  const reset = useCallback(() => {
    if (!busy.current) setState(IDLE);
  }, []);

  return { state, run, reset, running: state.phase === 'running' };
}
