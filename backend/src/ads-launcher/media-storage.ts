/**
 * Creative media on disk (§4.3).
 *
 *   MEDIA_DIR/creatives/<storeId>/<uuid>.<ext>          original file
 *   MEDIA_DIR/creatives/<storeId>/<uuid>.poster.jpg     thumbnail / video poster
 *
 * Served read-only at /api/media/creatives/… (unguessable uuids). Meta pulls
 * videos by URL when PUBLIC_ASSET_BASE_URL is an https origin that reaches
 * this backend; otherwise the launcher uploads the bytes itself.
 *
 * Images are stored as the browser prepared them: JPEG (EXIF-rotated, white
 * background) — see the upload dialog. Videos are stored untouched.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { MediaSource } from './launch-ads.use-case';

export const MEDIA_ROUTE = '/api/media';

export function mediaDir(): string {
  return path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), 'data', 'media'));
}

export function creativesDir(): string {
  return path.join(mediaDir(), 'creatives');
}

export function tmpUploadDir(): string {
  const dir = path.join(mediaDir(), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Relative paths are POSIX-style and never escape MEDIA_DIR. */
export function absolutePath(relPath: string): string {
  const abs = path.resolve(mediaDir(), relPath);
  if (!abs.startsWith(mediaDir() + path.sep)) throw new Error('Invalid media path');
  return abs;
}

export function publicPath(relPath: string): string {
  return `${MEDIA_ROUTE}/${relPath.split(path.sep).join('/')}`;
}

/** Absolute https URL of a stored file, or null when not publicly reachable. */
export function publicUrl(relPath: string): string | null {
  const base = (process.env.PUBLIC_ASSET_BASE_URL || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}${publicPath(relPath)}`;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v'
};

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif'];
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export function mediaTypeOf(mime: string): 'image' | 'video' | null {
  if (IMAGE_MIMES.includes(mime)) return 'image';
  if (VIDEO_MIMES.includes(mime)) return 'video';
  return null;
}

/** Move an uploaded temp file into the store's folder. Returns relative paths. */
export async function storeCreativeFiles(input: {
  storeId: string;
  tmpMediaPath: string;
  mime: string;
  tmpPosterPath?: string | null;
}): Promise<{ mediaPath: string; posterPath: string | null }> {
  const id = randomUUID();
  const dir = path.join(creativesDir(), input.storeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = EXT_BY_MIME[input.mime] ?? 'bin';
  const mediaRel = path.posix.join('creatives', input.storeId, `${id}.${ext}`);
  await moveFile(input.tmpMediaPath, absolutePath(mediaRel));
  let posterRel: string | null = null;
  if (input.tmpPosterPath) {
    posterRel = path.posix.join('creatives', input.storeId, `${id}.poster.jpg`);
    await moveFile(input.tmpPosterPath, absolutePath(posterRel));
  }
  return { mediaPath: mediaRel, posterPath: posterRel };
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (e: any) {
    if (e?.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from);
  }
}

export async function removeQuietly(...paths: Array<string | null | undefined>): Promise<void> {
  await Promise.all(paths.filter(Boolean).map(p => fs.promises.unlink(p!).catch(() => undefined)));
}

/** Read a few header bytes to check the file really is what its mime says. */
export async function sniffMatches(absPath: string, mime: string): Promise<boolean> {
  const fh = await fs.promises.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    switch (mime) {
      case 'image/jpeg': return buf[0] === 0xff && buf[1] === 0xd8;
      case 'image/png': return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case 'image/gif': return buf.subarray(0, 3).toString('ascii') === 'GIF';
      case 'video/webm': return buf.readUInt32BE(0) === 0x1a45dfa3;
      default: return buf.subarray(4, 8).toString('ascii') === 'ftyp'; // mp4 / mov / m4v
    }
  } finally {
    await fh.close();
  }
}

export const diskMediaSource: MediaSource = {
  readBytes: relPath => fs.promises.readFile(absolutePath(relPath)),
  publicUrl
};
