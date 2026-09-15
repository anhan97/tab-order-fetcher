/**
 * Renders the app mark to PNG at every size the browser asks for.
 *
 * Pure Node — zlib is the only dependency, so there is nothing to install and
 * nothing to keep in step. The mark is simple enough (a rounded tile plus four
 * rounded bars) to rasterise analytically, which also means it stays sharp at
 * 16px where a downscaled export would turn to mush.
 *
 *   node scripts/make-logo.cjs
 *
 * public/logo.svg is the source of truth for anything that can render vector;
 * this script exists because social scrapers and older browsers want raster.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Matches the app's existing teal→emerald accent (tailwind teal-500 → emerald-600).
const GRAD_FROM = [0x14, 0xb8, 0xa6];
const GRAD_TO = [0x05, 0x96, 0x69];
const BAR = [0xff, 0xff, 0xff];

const SS = 4; // supersampling factor per axis — 16 samples/pixel

/** Signed-distance helper: inside a rounded rectangle? */
function inRoundRect(x, y, rx0, ry0, rx1, ry1, r) {
  const cx = Math.min(Math.max(x, rx0 + r), rx1 - r);
  const cy = Math.min(Math.max(y, ry0 + r), ry1 - r);
  const dx = x - cx;
  const dy = y - cy;
  if (x >= rx0 + r && x <= rx1 - r) return y >= ry0 && y <= ry1;
  if (y >= ry0 + r && y <= ry1 - r) return x >= rx0 && x <= rx1;
  return dx * dx + dy * dy <= r * r;
}

/**
 * The mark, in a 32×32 design space:
 *   • rounded tile, full bleed
 *   • four bars climbing left→right, the last one tallest
 * Four bars rather than three: three reads as a generic analytics glyph, four
 * with an even rhythm reads as a ledger. All coordinates are multiples of
 * 0.25 so they land on pixel boundaries at 16/32/64/128/512.
 */
const BARS = [
  { x: 7.0, y: 19.0, w: 3.5, h: 6.0 },
  { x: 12.0, y: 16.0, w: 3.5, h: 9.0 },
  { x: 17.0, y: 12.5, w: 3.5, h: 12.5 },
  { x: 22.0, y: 7.0, w: 3.5, h: 18.0 }
];

function renderRGBA(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 32 / size; // design units per output pixel
  const tileR = 7.25; // corner radius in design units

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let aTile = 0;
      let aBar = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (pxi + (sx + 0.5) / SS) * S;
          const uy = (py + (sy + 0.5) / SS) * S;
          if (!inRoundRect(ux, uy, 0, 0, 32, 32, tileR)) continue;
          aTile++;
          for (const b of BARS) {
            if (inRoundRect(ux, uy, b.x, b.y, b.x + b.w, b.y + b.h, b.w / 2)) {
              aBar++;
              break;
            }
          }
        }
      }
      const N = SS * SS;
      const i = (py * size + pxi) * 4;
      if (aTile === 0) continue;

      // Diagonal gradient across the tile.
      const t = Math.min(1, Math.max(0, (pxi / size + py / size) / 2));
      const base = [0, 1, 2].map(c => Math.round(GRAD_FROM[c] + (GRAD_TO[c] - GRAD_FROM[c]) * t));

      // Bars composited over the gradient, both coverages anti-aliased.
      const barCov = aBar / N;
      const tileCov = aTile / N;
      for (let c = 0; c < 3; c++) {
        const mixed = base[c] * (1 - barCov / Math.max(tileCov, 1e-6)) +
                      BAR[c] * (barCov / Math.max(tileCov, 1e-6));
        px[i + c] = Math.round(Math.min(255, Math.max(0, mixed)));
      }
      px[i + 3] = Math.round(tileCov * 255);
    }
  }
  return px;
}

function encodePNG(size, rgba) {
  // One filter byte (0 = None) per scanline, then deflate.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** ICO may embed PNG payloads verbatim, which keeps this to a 22-byte header. */
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[4] = 1;   // colour planes
    d[6] = 32;  // bits per pixel
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(d);
  }
  return Buffer.concat([header, ...dir, ...entries.map(e => e.png)]);
}

const outDir = path.join(__dirname, '..', 'public');
const sizes = [16, 32, 64, 180, 512];
const pngs = {};
for (const s of sizes) {
  pngs[s] = encodePNG(s, renderRGBA(s));
}

fs.writeFileSync(path.join(outDir, 'logo.png'), pngs[512]);
fs.writeFileSync(path.join(outDir, 'favicon.png'), pngs[64]);
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), pngs[180]);
fs.writeFileSync(
  path.join(outDir, 'favicon.ico'),
  encodeICO([{ size: 16, png: pngs[16] }, { size: 32, png: pngs[32] }])
);

for (const f of ['logo.png', 'favicon.png', 'apple-touch-icon.png', 'favicon.ico']) {
  const p = path.join(outDir, f);
  console.log(String(fs.statSync(p).size).padStart(7), 'bytes  ', f);
}
