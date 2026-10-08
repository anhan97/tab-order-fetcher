/**
 * Browser-side preparation of creative files before upload (spec §4.3).
 *
 * - Images that are not JPEG/GIF (PNG, WebP, HEIC when the browser can decode
 *   it, …) become JPEG on a white background, quality 0.92.
 * - JPEGs are re-encoded through a canvas too, so EXIF rotation is baked in
 *   (Meta ignores the EXIF flag).
 * - GIFs go up untouched.
 * - Every image also gets a JPEG thumbnail (≤ 640 px, quality 0.85) sent as
 *   `poster`; videos get a poster frame grabbed at min(1 s, 10 % of duration).
 *
 * The top half is pure (unit-tested); the bottom half needs a DOM.
 */

// ─── Limits & types ─────────────────────────────────────────────────────────

export const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 30 * MB;
export const MAX_VIDEO_BYTES = 500 * MB;

export const IMAGE_QUALITY = 0.92;
export const THUMB_MAX_SIDE = 640;
export const THUMB_QUALITY = 0.85;
export const POSTER_MAX_SIDE = 1920;
export const POSTER_QUALITY = 0.9;
/** Largest canvas every mainstream browser can draw (iOS Safari: 4096²). */
export const MAX_CANVAS_PIXELS = 16_777_216;

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'] as const;
export type VideoMime = (typeof VIDEO_TYPES)[number];

/** Images the browser may decode and turn into JPEG. */
const CONVERTIBLE_IMAGE_TYPES = ['image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/bmp'];

/** Value for the file input's `accept`. Extensions too: Windows often has no MIME for .heic/.m4v. */
export const ACCEPT_ATTR = [
  'image/jpeg', 'image/gif', ...CONVERTIBLE_IMAGE_TYPES, ...VIDEO_TYPES,
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp', '.mp4', '.mov', '.webm', '.m4v'
].join(',');

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', jpe: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v'
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-ms-bmp': 'image/bmp',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
  'video/m4v': 'video/x-m4v'
};

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

// `error` sits on every branch: the app compiles without strictNullChecks,
// where `!plan.ok` does not narrow the union.
export type MediaPlan =
  | { ok: true; kind: 'image'; mime: string; action: 'reencode' | 'convert' | 'as-is'; error?: undefined }
  | { ok: true; kind: 'video'; mime: VideoMime; error?: undefined }
  | { ok: false; error: string; kind?: undefined };

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** The file's MIME type, normalised; guessed from the extension when the OS gave none. */
export function detectMime(f: Pick<FileLike, 'name' | 'type'>): string {
  const raw = (f.type || '').toLowerCase().trim();
  const t = MIME_ALIASES[raw] ?? raw;
  if (t && t !== 'application/octet-stream') return t;
  return EXT_MIME[fileExtension(f.name)] ?? '';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))} ${units[i]}`;
}

/** Decide what happens to a picked file, or why it cannot be uploaded. */
export function planFile(f: FileLike): MediaPlan {
  const mime = detectMime(f);
  const ext = fileExtension(f.name);
  if (f.size <= 0) return { ok: false, error: 'The file is empty.' };

  if ((VIDEO_TYPES as readonly string[]).includes(mime)) {
    if (f.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: `Video is ${formatBytes(f.size)} — the limit is ${formatBytes(MAX_VIDEO_BYTES)}.` };
    }
    return { ok: true, kind: 'video', mime: mime as VideoMime };
  }

  const isImage = mime === 'image/jpeg' || mime === 'image/gif' || CONVERTIBLE_IMAGE_TYPES.includes(mime);
  if (isImage) {
    if (f.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Image is ${formatBytes(f.size)} — the limit is ${formatBytes(MAX_IMAGE_BYTES)}.` };
    }
    const action = mime === 'image/gif' ? 'as-is' : mime === 'image/jpeg' ? 'reencode' : 'convert';
    return { ok: true, kind: 'image', mime, action };
  }

  const what = mime || (ext ? `.${ext}` : 'this file');
  return {
    ok: false,
    error: `Unsupported type (${what}). Use JPEG, PNG, GIF, WebP or HEIC images, or MP4, MOV, WebM or M4V videos.`
  };
}

/**
 * Scale (never up) so the longest side is ≤ `maxSide` and the area is ≤
 * `maxPixels`. Area-bound results round down so they never pass the budget.
 */
export function fitWithin(width: number, height: number, maxSide: number, maxPixels = Infinity): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const bySide = Math.min(1, maxSide / Math.max(width, height));
  const byArea = Number.isFinite(maxPixels) ? Math.min(1, Math.sqrt(maxPixels / (width * height))) : 1;
  const scale = Math.min(bySide, byArea);
  if (scale >= 1) return { width: Math.round(width), height: Math.round(height) };
  const round = byArea < bySide ? Math.floor : Math.round;
  return { width: Math.max(1, round(width * scale)), height: Math.max(1, round(height * scale)) };
}

/** Where to grab the video poster: min(1 s, 10 % of the duration). */
export function posterSeekTime(duration: number): number {
  if (Number.isNaN(duration) || duration <= 0) return 0;
  if (!Number.isFinite(duration)) return 1; // live/streamed webm reports Infinity
  return Math.min(1, duration * 0.1);
}

/** `photo.final.png` → `photo.final.jpg`. */
export function jpegFileName(name: string): string {
  const base = name.trim().replace(/\.[a-z0-9]+$/i, '');
  return `${base || 'image'}.jpg`;
}

// ─── Browser helpers ────────────────────────────────────────────────────────

export interface PreparedMedia {
  kind: 'image' | 'video';
  file: Blob;
  fileName: string;
  /** JPEG thumbnail (image) or poster frame (video); null when it could not be made. */
  poster: Blob | null;
  width: number | null;
  height: number | null;
  /** Non-fatal remark shown next to the file. */
  note: string | null;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decode with EXIF orientation applied; falls back to an <img> element. */
async function decodeImage(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> — browsers apply EXIF orientation to images by default */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('decode failed');
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function renderJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images (no canvas).');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  // Release the backing store right away (Safari keeps canvases around).
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Could not encode the image as JPEG (too large for this browser?).');
  return blob;
}

function decodeError(mime: string): Error {
  if (mime === 'image/heic' || mime === 'image/heif') {
    return new Error('This browser cannot read HEIC photos. Export it as JPEG (or use Safari) and try again.');
  }
  return new Error('Could not read this image — the file may be damaged or in a format this browser cannot open.');
}

async function prepareImage(file: File, plan: Extract<MediaPlan, { kind: 'image' }>): Promise<PreparedMedia> {
  if (plan.action === 'as-is') {
    // GIF: upload the original; the thumbnail is its first frame (best effort).
    const original = file.type === plan.mime ? file : file.slice(0, file.size, plan.mime);
    try {
      const d = await decodeImage(file);
      try {
        const t = fitWithin(d.width, d.height, THUMB_MAX_SIDE, MAX_CANVAS_PIXELS);
        const poster = await renderJpeg(d.source, t.width, t.height, THUMB_QUALITY);
        return { kind: 'image', file: original, fileName: file.name, poster, width: d.width, height: d.height, note: null };
      } finally {
        d.close();
      }
    } catch {
      return { kind: 'image', file: original, fileName: file.name, poster: null, width: null, height: null, note: 'No thumbnail — the server will make one' };
    }
  }

  let d: Decoded;
  try {
    d = await decodeImage(file);
  } catch {
    throw decodeError(plan.mime);
  }
  try {
    const full = fitWithin(d.width, d.height, Infinity, MAX_CANVAS_PIXELS);
    const jpeg = await renderJpeg(d.source, full.width, full.height, IMAGE_QUALITY);
    if (jpeg.size > MAX_IMAGE_BYTES) {
      throw new Error(`As JPEG the image is ${formatBytes(jpeg.size)} — over the ${formatBytes(MAX_IMAGE_BYTES)} limit.`);
    }
    const t = fitWithin(full.width, full.height, THUMB_MAX_SIDE);
    const poster = await renderJpeg(d.source, t.width, t.height, THUMB_QUALITY);
    const resized = full.width !== d.width || full.height !== d.height;
    return {
      kind: 'image',
      file: jpeg,
      fileName: jpegFileName(file.name),
      poster,
      width: full.width,
      height: full.height,
      note: plan.action === 'convert'
        ? `Converted to JPEG${resized ? ` (${full.width}×${full.height})` : ''}`
        : resized ? `Resized to ${full.width}×${full.height}` : null
    };
  } finally {
    d.close();
  }
}

function waitForMedia(el: HTMLMediaElement, event: 'loadeddata' | 'seeked', ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('This browser cannot decode the video.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for the video (${event}).`)); }, ms);
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

/** Grab a JPEG poster frame from a local video file. Throws when the browser cannot decode it. */
export async function extractVideoPoster(file: Blob, timeoutMs = 20_000): Promise<{ poster: Blob; width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = waitForMedia(video, 'loadeddata', timeoutMs);
    video.src = url;
    video.load();
    await loaded;
    const { videoWidth: w, videoHeight: h, duration } = video;
    if (!w || !h) throw new Error('The video has no picture track this browser can read.');
    const t = posterSeekTime(duration);
    if (t > 0) {
      const seeked = waitForMedia(video, 'seeked', timeoutMs);
      video.currentTime = t;
      await seeked;
    }
    const dims = fitWithin(w, h, POSTER_MAX_SIDE, MAX_CANVAS_PIXELS);
    const poster = await renderJpeg(video, dims.width, dims.height, POSTER_QUALITY);
    return { poster, width: w, height: h, duration };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function prepareVideo(file: File, mime: VideoMime): Promise<PreparedMedia> {
  // Send the MIME the server allows even when the OS gave none (.m4v/.mov on Windows).
  const body = file.type === mime ? file : file.slice(0, file.size, mime);
  try {
    const { poster, width, height } = await extractVideoPoster(file);
    return { kind: 'video', file: body, fileName: file.name, poster, width, height, note: null };
  } catch {
    return { kind: 'video', file: body, fileName: file.name, poster: null, width: null, height: null, note: 'No preview frame — the server will make one' };
  }
}

/** Validate + convert one picked file. Throws an Error with a readable message. */
export async function prepareMedia(file: File): Promise<PreparedMedia> {
  const plan = planFile(file);
  if (!plan.ok) throw new Error(plan.error);
  return plan.kind === 'video' ? prepareVideo(file, plan.mime) : prepareImage(file, plan);
}
