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

// ─── Retry failed ads ───────────────────────────────────────────────────────

/** One request of a "Retry failed ads" round and where its results go back. */
export interface RetryJob {
  /** Position of the run entry this job retries. */
  pos: number;
  request: LaunchRequest;
  /**
   * replace — nothing of this entry exists on Meta (or we can't tell): the
   *           request goes again and its answer replaces the entry.
   * merge   — the campaign exists: only what failed goes again, into the
   *           existing campaign / ad sets, and the answers are merged back.
   */
  mode: 'replace' | 'merge';
  /** merge: per retried ad set, its index in the entry and the ad indexes sent (null = whole ad set). */
  targets: Array<{ adsetIndex: number; adIndexes: number[] | null }>;
}

/**
 * What to send to retry every failed or skipped ad of a run, never creating
 * anything twice:
 *   - request error (network, 5xx…): the SAME request, SAME requestId — if the
 *     server did finish it, it replays the stored result instead of launching
 *     again.
 *   - campaign not created: the same request with a new requestId.
 *   - campaign created: one request into that campaign — ad sets that were
 *     not created go again whole; created ad sets get only their failed ads,
 *     keeping each ad's name (no renumbering against the ads already there).
 * The caller keeps the run's launchId so the server reuses uploaded media
 * and Meta creatives (and re-polls videos that were still processing).
 */
export function retryJobs(entries: LaunchRunEntry[], newId: () => string = newUuid): RetryJob[] {
  const jobs: RetryJob[] = [];
  entries.forEach((e, pos) => {
    if (e.error || !e.result) {
      jobs.push({ pos, request: e.request, mode: 'replace', targets: [] });
      return;
    }
    const r = e.result;
    if (r.campaign.status !== 'ok' || !r.campaign.externalId) {
      jobs.push({ pos, request: { ...e.request, requestId: newId() }, mode: 'replace', targets: [] });
      return;
    }
    const adsets: LaunchRequest['adsets'] = [];
    const targets: RetryJob['targets'] = [];
    r.adsets.forEach((a, i) => {
      const spec = e.request.adsets[i];
      if (!spec) return;
      const ads = spec.ads ?? e.request.ads;
      if (a.status !== 'ok') {
        adsets.push({ ...spec, ads });
        targets.push({ adsetIndex: i, adIndexes: null });
        return;
      }
      if (!a.externalId) return;
      const failed = a.ads.map((ad, j) => (ad.status === 'ok' ? -1 : j)).filter(j => j >= 0 && ads[j]);
      if (failed.length === 0) return;
      adsets.push({ mode: 'existing', adsetId: a.externalId, ads: failed.map(j => ({ ...ads[j], name: a.ads[j].name })) });
      targets.push({ adsetIndex: i, adIndexes: failed });
    });
    if (adsets.length === 0) return;
    jobs.push({
      pos,
      mode: 'merge',
      targets,
      request: { ...e.request, requestId: newId(), campaign: { mode: 'existing', campaignId: r.campaign.externalId }, adsets, ads: [] }
    });
  });
  return jobs;
}

/** Fold a retry's answer back into the entry it retried. */
export function mergeRetry(
  original: LaunchRunEntry,
  job: RetryJob,
  retry: { result: LaunchResult | null; error: string | null }
): LaunchRunEntry {
  if (job.mode === 'replace') return { ...original, request: job.request, result: retry.result, error: retry.error };
  if (!original.result) return original;
  const result: LaunchResult = {
    ...original.result,
    adsets: original.result.adsets.map(a => ({ ...a, ads: [...a.ads] }))
  };
  job.targets.forEach((t, k) => {
    const got = retry.result?.adsets[k];
    const reason = retry.error ?? got?.error ?? null;
    if (t.adIndexes === null) {
      if (got) result.adsets[t.adsetIndex] = got;
      else if (reason) result.adsets[t.adsetIndex] = { ...result.adsets[t.adsetIndex], error: reason };
      return;
    }
    const target = result.adsets[t.adsetIndex];
    t.adIndexes.forEach((j, n) => {
      const ad = got?.ads[n];
      if (ad && ad.status === 'ok') target.ads[j] = ad;
      else target.ads[j] = { ...target.ads[j], status: 'failed', error: ad?.error ?? reason ?? target.ads[j].error };
    });
  });
  const allAds = result.adsets.flatMap(a => a.ads);
  result.summary = {
    ...original.result.summary,
    adsCreated: allAds.filter(a => a.status === 'ok').length,
    adsFailed: allAds.filter(a => a.status !== 'ok').length,
    adsetsCreated: original.result.summary.adsetsCreated + (retry.result?.summary.adsetsCreated ?? 0)
  };
  return { ...original, result };
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
