/**
 * Sequential upload queue for the "Upload creatives" dialog.
 *
 * One file per request (the API takes one), each prepared in the browser
 * first (lib/media-prep). The queue lives in the page, not the dialog, so
 * closing the dialog never loses progress and the header can show it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreativeDto } from '@contract/ads-launcher';
import { useCreativeMutations } from '@/features/ads-launcher/hooks/queries';
import { planFile, prepareMedia } from '../lib/media-prep';
import { errorMessage } from '../lib/library';

export type UploadStatus = 'queued' | 'processing' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  file: File;
  kind: 'image' | 'video' | null;
  status: UploadStatus;
  error: string | null;
  /** false = can never upload as is (wrong type, too big) — remove it. */
  retryable: boolean;
  note: string | null;
  result: CreativeDto | null;
}

export interface UploadMeta {
  productId: string;
  productCode: string;
  angle: string;
  primaryText: string;
  headline: string;
  description: string;
}

export interface UploadRunSummary {
  ok: number;
  failed: number;
}

let seq = 0;
const nextId = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

export const isPending = (i: UploadItem) => i.status === 'queued' || (i.status === 'error' && i.retryable);
export const isBusy = (i: UploadItem) => i.status === 'processing' || i.status === 'uploading';

export function useUploadQueue() {
  const uploadAsync = useCreativeMutations().upload.mutateAsync;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef(items);
  const runningRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const update = useCallback((fn: (prev: UploadItem[]) => UploadItem[]) => {
    setItems(prev => {
      const next = fn(prev);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const patch = useCallback(
    (id: string, p: Partial<UploadItem>) => update(prev => prev.map(i => (i.id === id ? { ...i, ...p } : i))),
    [update]
  );

  const add = useCallback(
    (files: File[]) =>
      update(prev => [
        ...prev,
        ...files.map((file): UploadItem => {
          const plan = planFile(file);
          return {
            id: nextId(),
            file,
            kind: plan.ok ? plan.kind : null,
            status: plan.ok ? 'queued' : 'error',
            error: plan.ok ? null : plan.error,
            retryable: plan.ok,
            note: null,
            result: null
          };
        })
      ]),
    [update]
  );

  const remove = useCallback((id: string) => update(prev => prev.filter(i => i.id !== id || isBusy(i))), [update]);
  const clearFinished = useCallback(() => update(prev => prev.filter(i => i.status !== 'done')), [update]);
  const reset = useCallback(() => {
    if (!runningRef.current) update(() => []);
  }, [update]);

  /** Upload every pending file (or just `onlyIds`), one at a time. */
  const run = useCallback(
    async (meta: UploadMeta, onlyIds?: string[]): Promise<UploadRunSummary> => {
      if (runningRef.current) return { ok: 0, failed: 0 };
      runningRef.current = true;
      setRunning(true);
      let ok = 0;
      let failed = 0;
      try {
        const todo = itemsRef.current.filter(i => isPending(i) && (!onlyIds || onlyIds.includes(i.id))).map(i => i.id);
        for (const id of todo) {
          const item = itemsRef.current.find(i => i.id === id);
          if (!item || !isPending(item)) continue; // removed meanwhile
          patch(id, { status: 'processing', error: null, note: null });
          try {
            const prepared = await prepareMedia(item.file);
            patch(id, { status: 'uploading', note: prepared.note });
            const result = await uploadAsync({
              file: prepared.file,
              fileName: prepared.fileName,
              poster: prepared.poster,
              productId: meta.productId,
              productCode: meta.productCode.trim() || undefined,
              angle: meta.angle,
              primaryText: meta.primaryText.trim() ? meta.primaryText : undefined,
              headline: meta.headline.trim() || undefined,
              description: meta.description.trim() || undefined,
              width: prepared.width,
              height: prepared.height
            });
            patch(id, { status: 'done', result });
            ok++;
          } catch (e) {
            patch(id, { status: 'error', error: errorMessage(e) });
            failed++;
          }
        }
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
      return { ok, failed };
    },
    [patch, uploadAsync]
  );

  const counts = {
    total: items.length,
    done: items.filter(i => i.status === 'done').length,
    pending: items.filter(isPending).length,
    failed: items.filter(i => i.status === 'error').length,
    invalid: items.filter(i => i.status === 'error' && !i.retryable).length
  };

  return { items, running, counts, add, remove, clearFinished, reset, run };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
