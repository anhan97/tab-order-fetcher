/**
 * ACTIVE needs one more confirmation (§3.2 step 4) — when the user picks it,
 * or at launch time when the preset itself says ACTIVE.
 */
import { useState, type Dispatch } from 'react';
import type { NodeStatus } from '@contract/ads-launcher';
import type { WizardAction, WizardState } from '../lib/wizard-state';

type Pending = { kind: 'status' } | { kind: 'launch'; run: () => void } | null;

export function useActiveConfirm(state: WizardState, dispatch: Dispatch<WizardAction>) {
  const [pending, setPending] = useState<Pending>(null);

  const requestStatus = (status: NodeStatus) => {
    if (status === 'ACTIVE') setPending({ kind: 'status' });
    else dispatch({ type: 'status', status: 'PAUSED' });
  };

  /** Run now, or after the confirmation when launching ACTIVE unconfirmed. */
  const guardLaunch = (run: () => void) => {
    if (state.config?.status === 'ACTIVE' && !state.activeConfirmed) setPending({ kind: 'launch', run });
    else run();
  };

  const confirm = () => {
    const p = pending;
    setPending(null);
    dispatch({ type: 'status', status: 'ACTIVE', confirmed: true });
    if (p?.kind === 'launch') p.run();
  };

  return {
    requestStatus,
    guardLaunch,
    dialog: {
      open: pending !== null,
      onOpenChange: (open: boolean) => {
        if (!open) setPending(null);
      },
      onConfirm: confirm,
      action: pending?.kind === 'launch' ? 'Launch as Active' : 'Use Active'
    }
  };
}
