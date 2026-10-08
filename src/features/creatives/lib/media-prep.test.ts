import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_PIXELS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MB,
  THUMB_MAX_SIDE,
  detectMime,
  fileExtension,
  fitWithin,
  formatBytes,
  jpegFileName,
  planFile,
  posterSeekTime
} from './media-prep';

const f = (name: string, type: string, size = 1 * MB) => ({ name, type, size });

describe('detectMime', () => {
  it('uses the browser type when present, normalising aliases', () => {
    expect(detectMime(f('a.jpg', 'image/jpeg'))).toBe('image/jpeg');
    expect(detectMime(f('a.jpg', 'image/jpg'))).toBe('image/jpeg');
    expect(detectMime(f('a.JPG', 'IMAGE/PJPEG'))).toBe('image/jpeg');
    expect(detectMime(f('clip.m4v', 'video/m4v'))).toBe('video/x-m4v');
  });

  it('falls back to the extension when the OS gave no type', () => {
    expect(detectMime(f('IMG_0001.HEIC', ''))).toBe('image/heic');
    expect(detectMime(f('clip.mov', ''))).toBe('video/quicktime');
    expect(detectMime(f('clip.m4v', 'application/octet-stream'))).toBe('video/x-m4v');
    expect(detectMime(f('noext', ''))).toBe('');
  });

  it('fileExtension is lower-case and ignores dots inside the name', () => {
    expect(fileExtension('my.photo.final.PNG')).toBe('png');
    expect(fileExtension('README')).toBe('');
  });
});

describe('planFile', () => {
  it('re-encodes JPEG, converts PNG/WebP/HEIC, keeps GIF as-is', () => {
    expect(planFile(f('a.jpg', 'image/jpeg'))).toMatchObject({ ok: true, kind: 'image', action: 'reencode' });
    expect(planFile(f('a.png', 'image/png'))).toMatchObject({ ok: true, kind: 'image', action: 'convert' });
    expect(planFile(f('a.webp', 'image/webp'))).toMatchObject({ ok: true, kind: 'image', action: 'convert' });
    expect(planFile(f('a.heic', ''))).toMatchObject({ ok: true, kind: 'image', action: 'convert', mime: 'image/heic' });
    expect(planFile(f('a.gif', 'image/gif'))).toMatchObject({ ok: true, kind: 'image', action: 'as-is' });
  });

  it('accepts the four video types', () => {
    for (const [name, type] of [['a.mp4', 'video/mp4'], ['a.mov', 'video/quicktime'], ['a.webm', 'video/webm'], ['a.m4v', '']]) {
      expect(planFile(f(name, type))).toMatchObject({ ok: true, kind: 'video' });
    }
  });

  it('enforces 30 MB for images and 500 MB for videos (inclusive)', () => {
    expect(planFile(f('a.jpg', 'image/jpeg', MAX_IMAGE_BYTES)).ok).toBe(true);
    const big = planFile(f('a.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1));
    expect(big.ok).toBe(false);
    expect(!big.ok && big.error).toMatch(/limit is 30 MB/);

    expect(planFile(f('a.gif', 'image/gif', MAX_IMAGE_BYTES + 1)).ok).toBe(false);
    expect(planFile(f('a.mp4', 'video/mp4', MAX_VIDEO_BYTES)).ok).toBe(true);
    const huge = planFile(f('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1));
    expect(!huge.ok && huge.error).toMatch(/limit is 500 MB/);
  });

  it('rejects empty and unsupported files with a readable reason', () => {
    expect(planFile(f('a.jpg', 'image/jpeg', 0))).toEqual({ ok: false, error: 'The file is empty.' });
    const pdf = planFile(f('brief.pdf', 'application/pdf'));
    expect(pdf.ok).toBe(false);
    expect(!pdf.ok && pdf.error).toMatch(/Unsupported type \(application\/pdf\)/);
    const mkv = planFile(f('a.mkv', ''));
    expect(!mkv.ok && mkv.error).toMatch(/\.mkv/);
  });
});

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(300, 200, THUMB_MAX_SIDE)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(640, 640, THUMB_MAX_SIDE)).toEqual({ width: 640, height: 640 });
  });

  it('bounds the longest side and keeps the aspect ratio', () => {
    expect(fitWithin(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
    expect(fitWithin(1080, 1350, 640)).toEqual({ width: 512, height: 640 });
    expect(fitWithin(4000, 3, 640)).toEqual({ width: 640, height: 1 });
  });

  it('bounds the area for the canvas budget, rounding down', () => {
    const r = fitWithin(8064, 6048, Infinity, MAX_CANVAS_PIXELS);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(r.width / r.height).toBeCloseTo(8064 / 6048, 2);
    expect(fitWithin(4096, 4096, Infinity, MAX_CANVAS_PIXELS)).toEqual({ width: 4096, height: 4096 });
  });

  it('applies whichever bound is tighter', () => {
    expect(fitWithin(10000, 10000, 640, MAX_CANVAS_PIXELS)).toEqual({ width: 640, height: 640 });
  });

  it('returns zero for unknown sizes', () => {
    expect(fitWithin(0, 100, 640)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100, 640)).toEqual({ width: 0, height: 0 });
  });
});

describe('posterSeekTime', () => {
  it('is min(1 s, 10 % of the duration)', () => {
    expect(posterSeekTime(30)).toBe(1);
    expect(posterSeekTime(10)).toBe(1);
    expect(posterSeekTime(4)).toBeCloseTo(0.4);
    expect(posterSeekTime(0.5)).toBeCloseTo(0.05);
  });

  it('handles unknown durations', () => {
    expect(posterSeekTime(NaN)).toBe(0);
    expect(posterSeekTime(0)).toBe(0);
    expect(posterSeekTime(Infinity)).toBe(1);
  });
});

describe('formatBytes / jpegFileName', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(30 * MB)).toBe('30 MB');
    expect(formatBytes(500 * MB)).toBe('500 MB');
    expect(formatBytes(1.25 * 1024 * MB)).toBe('1.3 GB');
  });

  it('swaps the extension for .jpg', () => {
    expect(jpegFileName('photo.final.png')).toBe('photo.final.jpg');
    expect(jpegFileName('IMG_1.HEIC')).toBe('IMG_1.jpg');
    expect(jpegFileName('noext')).toBe('noext.jpg');
    expect(jpegFileName('.png')).toBe('image.jpg');
  });
});
