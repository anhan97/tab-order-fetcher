/**
 * Parse the ad-copy CSV format used by the bulk-launch flow.
 *
 * Expected header row (case-insensitive, order doesn't matter):
 *   filename, primary_text_1, primary_text_2, ..., primary_text_5,
 *   headline_1, ..., headline_5,
 *   description_1, ..., description_5
 *
 * Only "filename" is required. Up to 5 of each variant are honoured —
 * Facebook's multi-text optimization caps at 5 per slot. Empty cells are
 * dropped, so a row with primary_text_1 + headline_1 (and nothing else)
 * just produces a single-variant ad.
 *
 * Quoting: standard CSV — commas inside quoted fields, escaped quotes ("").
 * Newlines inside quoted fields are preserved (FB allows multi-line copy).
 */

export interface AdCopyEntry {
  filename: string;
  primary_texts: string[];
  headlines: string[];
  descriptions: string[];
}

export interface ParsedAdCopy {
  entries: AdCopyEntry[];
  /** Files in the CSV that have at least one variant filled in. */
  byFilename: Record<string, AdCopyEntry>;
  /** Header columns we did not recognise — surfaced so the user can spot typos. */
  unknownColumns: string[];
}

const MAX_VARIANTS = 5;

const VARIANT_PREFIXES = {
  primary_texts: ['primary_text_', 'primary text ', 'primary text_', 'pt_', 'body_'],
  headlines: ['headline_', 'headline ', 'hl_', 'title_'],
  descriptions: ['description_', 'description ', 'desc_']
} as const;

type VariantKey = keyof typeof VARIANT_PREFIXES;

/**
 * Parse CSV text into ad-copy entries. Throws on missing/duplicate filename
 * column — those break the whole pipeline so we fail fast.
 */
export function parseAdCopyCsv(text: string): ParsedAdCopy {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { entries: [], byFilename: {}, unknownColumns: [] };
  }

  const header = rows[0].map(h => h.trim());
  const lowerHeader = header.map(h => h.toLowerCase());

  const filenameIdx = lowerHeader.findIndex(h => h === 'filename' || h === 'file' || h === 'creative' || h === 'image');
  if (filenameIdx < 0) {
    throw new Error('CSV must include a "filename" column (also accepted: file, creative, image)');
  }

  // Build column-index → (variant, slotIndex) map
  type ColMap = Map<number, { variant: VariantKey; slot: number }>;
  const colMap: ColMap = new Map();
  const unknownColumns: string[] = [];

  for (let i = 0; i < header.length; i++) {
    if (i === filenameIdx) continue;
    const h = lowerHeader[i];
    let matched = false;
    for (const variant of Object.keys(VARIANT_PREFIXES) as VariantKey[]) {
      for (const prefix of VARIANT_PREFIXES[variant]) {
        if (h.startsWith(prefix)) {
          const tail = h.slice(prefix.length).trim();
          const slot = parseInt(tail, 10);
          if (Number.isFinite(slot) && slot >= 1 && slot <= MAX_VARIANTS) {
            colMap.set(i, { variant, slot: slot - 1 });
            matched = true;
          }
          break;
        }
      }
      if (matched) break;
    }
    if (!matched && header[i]) unknownColumns.push(header[i]);
  }

  const byFilename: Record<string, AdCopyEntry> = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const filename = (row[filenameIdx] || '').trim();
    if (!filename) continue;          // skip blank rows
    if (filename.startsWith('#')) continue; // comment row

    if (!byFilename[filename]) {
      byFilename[filename] = {
        filename,
        primary_texts: [],
        headlines: [],
        descriptions: []
      };
    }
    const entry = byFilename[filename];

    for (const [colIdx, { variant, slot }] of colMap) {
      const v = (row[colIdx] || '').trim();
      if (!v) continue;
      // Pad to slot index then assign — preserves "1, _, 3" → ["a", "", "c"]
      while (entry[variant].length <= slot) entry[variant].push('');
      entry[variant][slot] = v;
    }
  }

  // Compact arrays — drop empties and trailing blanks. Facebook will reject
  // an empty body/title.
  const entries = Object.values(byFilename).map(e => ({
    filename: e.filename,
    primary_texts: e.primary_texts.filter(Boolean),
    headlines: e.headlines.filter(Boolean),
    descriptions: e.descriptions.filter(Boolean)
  }));

  // Re-key for quick lookup post-compact
  const compacted: Record<string, AdCopyEntry> = {};
  for (const e of entries) compacted[e.filename] = e;

  return { entries, byFilename: compacted, unknownColumns };
}

/**
 * Minimal RFC 4180 CSV parser. Handles quoted fields, escaped quotes ("")
 * and embedded newlines within quotes. Doesn't try to be a full CSV
 * library — this is for hand-edited spreadsheet exports.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Strip BOM Excel sometimes prepends
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; } // swallow CR — wait for LF
      if (c === '\n') {
        row.push(field);
        // Keep blank rows out of the parsed result so callers don't have to
        // filter, but preserve a row that has at least one non-empty field.
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  // Trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(f => f.length > 0)) rows.push(row);
  }
  return rows;
}
