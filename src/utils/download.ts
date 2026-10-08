import { buildHeaders } from '@/utils/apiClient';

/**
 * Fetch a file from our API (JWT + active store attached) and save it.
 *
 * Firefox/Safari ignore the `download` attribute unless the anchor is in the
 * DOM, and revoking the object URL synchronously can cancel the download —
 * hence append, click, remove, revoke later.
 */
export async function downloadFromApi(
  path: string,
  filename: string,
  init: RequestInit = {}
): Promise<void> {
  const isJson = typeof init.body === 'string';
  const headers = buildHeaders({
    ...(isJson ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string>) || {})
  });
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
