/**
 * Launch run bookkeeping (§12.3). Pure — the hook in hooks/use-run-launch.ts
 * drives the loop; this file sums it up.
 */
import type { LaunchRequest, LaunchResult } from '@contract/ads-launcher';

export interface LaunchRunEntry {
  index: number;
  request: LaunchRequest;
  result: LaunchResult | null;
  /** Whole request failed (HTTP error / network). */
  error: string | null;
}

export interface LaunchTotals {
  /** Σ adsCreated. */
  ok: number;
  /** Σ adsFailed + requests that failed outright + campaigns that could not be created. */
  failed: number;
  campaignsCreated: number;
  adsetsCreated: number;
}

export function summarizeRun(entries: LaunchRunEntry[]): LaunchTotals {
  const t: LaunchTotals = { ok: 0, failed: 0, campaignsCreated: 0, adsetsCreated: 0 };
  for (const e of entries) {
    if (e.error || !e.result) {
      t.failed += 1;
      continue;
    }
    const s = e.result.summary;
    t.ok += s?.adsCreated ?? 0;
    t.failed += s?.adsFailed ?? 0;
    t.adsetsCreated += s?.adsetsCreated ?? 0;
    if (s?.campaignCreated) t.campaignsCreated += 1;
    if (e.result.campaign?.status === 'failed') t.failed += 1;
  }
  return t;
}

/** "3 ads launched" or "2 launched, 1 failed". */
export function runToastTitle(t: LaunchTotals): string {
  if (t.failed === 0) return `${t.ok} ${t.ok === 1 ? 'ad' : 'ads'} launched`;
  return `${t.ok} launched, ${t.failed} failed`;
}

/** Fallback for non-secure contexts where crypto.randomUUID is missing. */
export function newUuid(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
