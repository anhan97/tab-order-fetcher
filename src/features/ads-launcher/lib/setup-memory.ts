/**
 * Per-user memory of the launch setup (§3.2): ad account, pixel, page, store,
 * display link, URL parameters and preset. NEVER the pool, copy edits, or an
 * existing campaign / ad set.
 *
 * localStorage can throw (private mode, quota, blocked storage) — every read
 * and write is wrapped so the launcher works without it.
 */
import { useEffect, useRef } from 'react';

export interface SetupMemory {
  adAccountId?: string;
  pixelId?: string;
  pageId?: string;
  storeId?: string;
  displayLink?: string;
  urlTags?: string;
  presetId?: string;
}

export const SETUP_MEMORY_FIELDS = ['adAccountId', 'pixelId', 'pageId', 'storeId', 'displayLink', 'urlTags', 'presetId'] as const;
export const SETUP_MEMORY_DEBOUNCE_MS = 300;

export const setupMemoryKey = (userId: string) => `ads-launcher:setup:${userId}`;

/** Keep only the remembered fields, and only strings. */
export function pickSetupMemory(value: unknown): SetupMemory {
  const out: SetupMemory = {};
  if (!value || typeof value !== 'object') return out;
  const src = value as Record<string, unknown>;
  for (const f of SETUP_MEMORY_FIELDS) {
    const v = src[f];
    if (typeof v === 'string') out[f] = v;
  }
  return out;
}

export function readSetupMemory(userId: string | null | undefined): SetupMemory {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(setupMemoryKey(userId));
    return raw ? pickSetupMemory(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeSetupMemory(userId: string | null | undefined, value: SetupMemory): void {
  if (!userId) return;
  try {
    localStorage.setItem(setupMemoryKey(userId), JSON.stringify(pickSetupMemory(value)));
  } catch {
    /* storage unavailable — memory is a convenience only */
  }
}

/**
 * Save `value` for the user, 300 ms after the last change. Pass
 * `enabled = false` until the form is initialised, so the restored values are
 * not overwritten by the empty first render.
 */
export function useSetupMemory(userId: string | null | undefined, value: SetupMemory, enabled = true): void {
  const serialized = JSON.stringify(pickSetupMemory(value));
  const latest = useRef(serialized);
  latest.current = serialized;
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled || !userId) return;
    pending.current = true;
    const timer = setTimeout(() => flushMemory(userId, latest, pending), SETUP_MEMORY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [userId, serialized, enabled]);

  // Closing (a dialog, a page) inside the debounce window still saves the last change.
  useEffect(() => {
    if (!userId) return;
    return () => {
      if (pending.current) flushMemory(userId, latest, pending);
    };
  }, [userId]);
}

function flushMemory(userId: string, latest: { current: string }, pending: { current: boolean }) {
  pending.current = false;
  try {
    writeSetupMemory(userId, JSON.parse(latest.current));
  } catch {
    /* ignore */
  }
}
