import { PrismaClient, Prisma } from '@prisma/client';
import { extractTrackingPrefix } from './shipping-company.service';

const prisma = new PrismaClient();

/**
 * Aliases for SKUs used in supplier CSVs but not present in our ProductVariant
 * table. Maps the alias → canonical SKU (lookup is case-insensitive).
 *
 * The Caryona supplier renames SKUs over time — these aliases let us match
 * older or fuzzier names to the actual variant in DB.
 */
const SKU_ALIASES: Record<string, string> = {
  // After the Shopify SKU rename, the regular (non-Valentine's) tote line
  // uses BAG-* SKUs. The disambiguation between Luxe ('LE-Black' lowercase)
  // and Signature ('LE-BLACK' uppercase) editions is handled at lookup time
  // by matching the CSV's STYLE column against ProductVariant.title.
  'bag-black': 'BAG-BLACK',
  'bag-wine red': 'BAG-WINE-RED',
  'bag-khaki': 'BAG-KHAKI',
  'bag-green': 'BAG-GREEN',
  'bag-brown white': 'BAG-BROWN-WHITE',
  'bag-white/black': 'BAG-WHITE-BLACK',
  'bag- white black': 'BAG-WHITE-BLACK',
  'le-black': 'LE-BLACK',
  'le-brown': 'LE-BROWN',
  'lunch box-beige': 'LUNCH-BOX-BEIGE',
  'lunch-box': 'LUNCH-BOX-BEIGE',
  'cross body bag-black': 'CRBD-BLACK',
  'crossbody bag': 'CRBD-BLACK',
  'crossbody bag-black': 'CRBD-BLACK',
  'backpack-white/green/black': 'White-Green-Black-BACKPACK',
  'backpack-black/grey': 'Black-Grey-BACKPACK',
  'backpack': 'Black-Beige-Brown-BACKPACK'
};

/**
 * Map free-form country names from CSVs to ISO alpha-2 codes that match
 * Shopify's `shipping_address.country_code`.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  'United States': 'US',
  US: 'US',
  USA: 'US',
  'United Kingdom': 'GB',
  UK: 'GB',
  GB: 'GB',
  Australia: 'AU',
  AU: 'AU',
  Canada: 'CA',
  CA: 'CA'
};

export function normalizeCountry(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return COUNTRY_ALIASES[trimmed] || (trimmed.length === 2 ? trimmed.toUpperCase() : null);
}

/** Strip currency symbols, normalise European decimal commas, and parse. */
export function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  let cleaned = s.replace(/\$/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    // Both present → comma is thousand separator
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    // Only comma → check if it's a decimal separator (1-2 digits after the LAST comma)
    if (/,\d{1,2}$/.test(cleaned)) {
      cleaned = cleaned.replace(/,/g, '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface CsvRow {
  orderId: string;
  date: string;
  sku: string;
  productName: string;
  style: string;
  quantity: number;
  country: string | null;
  shippingCost: number | null;
  trackingNumber: string | null;
}

/**
 * Naive CSV parser: handles quoted fields with embedded commas.
 * Skips lines that aren't valid order rows (blank lines, section headers
 * like "4,22", lines whose first column isn't a numeric order ID).
 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 19) continue;
    const orderId = cols[0].trim().replace(/^["']|["']$/g, '').replace(/^#/, '');
    // The first column is order ID — must be a positive integer. Header rows
    // like "4,22" or "4æ30æ¥" or " " (blank ID) are filtered here.
    if (!/^\d+$/.test(orderId)) continue;
    const date = cols[1].trim();
    const sku = cols[2].trim();
    const productName = cols[3].trim();
    const style = cols[4].trim();
    const qty = parseInt(cols[5].trim(), 10);
    if (!Number.isFinite(qty)) continue;
    const country = normalizeCountry(cols[12]);
    const shippingCost = parseMoney(cols[14]);
    const trackingNumber = cols[18]?.trim().replace(/^["']|["']$/g, '') || null;
    if (!sku) continue;
    rows.push({ orderId, date, sku, productName, style, quantity: qty, country, shippingCost, trackingNumber });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export interface ImportResult {
  totalRows: number;
  singleItemOrders: number;
  uniqueSkus: number;
  uniqueCountries: number;
  uniqueCarriers: number;
  pricebooksTouched: number;
  variantOverridesWritten: number;
  variantsBaseCostUpdated: number;
  shippingTiersUpdated: number;
  unmappedSkus: string[];
}

/**
 * Strategy:
 *   1. Parse CSV.
 *   2. For each row, derive carrier from tracking-number prefix (first 2 chars,
 *      matching the existing 2-letter convention).
 *   3. Group into ORDERS (multi-line orders share an order ID; only the first
 *      line carries the shipping cost).
 *   4. From SINGLE-ITEM orders (1 line, qty=1) gather (sku, country, carrier)
 *      → cost samples. Take median per group.
 *   5. From SINGLE-LINE qty=N orders (1 line, qty>1) compute per-item shipping
 *      tiers per (country, carrier, qty).
 *   6. Map SKU → ProductVariant.variantId via existing DB rows.
 *   7. Upsert PricebookVariantCostOverride per (pricebook, variant).
 *   8. Update ProductVariant.baseCost to the cross-country median for that SKU.
 *   9. Update PricebookShippingTier rows for any (country, carrier, qty)
 *      sample we've observed — cost is already in the override, so set tier
 *      to 0 to avoid double-counting.
 */
export async function importCostCsv(
  userId: string,
  storeId: string,
  csvText: string,
  options: { supplier?: string } = {}
): Promise<ImportResult> {
  const supplier = options.supplier || 'Default';
  const rows = parseCsv(csvText);
  const result: ImportResult = {
    totalRows: rows.length,
    singleItemOrders: 0,
    uniqueSkus: 0,
    uniqueCountries: 0,
    uniqueCarriers: 0,
    pricebooksTouched: 0,
    variantOverridesWritten: 0,
    variantsBaseCostUpdated: 0,
    shippingTiersUpdated: 0,
    unmappedSkus: []
  };

  // Group by orderId
  const orders = new Map<string, CsvRow[]>();
  for (const r of rows) {
    if (!orders.has(r.orderId)) orders.set(r.orderId, []);
    orders.get(r.orderId)!.push(r);
  }

  // Per (sku, country, carrier) → cost samples (only for single-item orders)
  const skuKey = (sku: string, country: string, carrier: string) => `${sku}||${country}||${carrier}`;
  const samples = new Map<string, number[]>();
  // Track (productName, style) frequency per SKU so we can disambiguate
  // Shopify variants that share the same SKU prefix but live under different
  // products (e.g. "LE-Black" exists for both Luxe Edition and Signature Edition).
  const skuContext = new Map<string, Map<string, number>>(); // sku → "productName||style" → count
  // Per (country, carrier, totalQty) → cost samples (for tier table)
  const tierSamples = new Map<string, number[]>();

  for (const [, lines] of orders) {
    // Order-level fields come from the line that has shippingCost set (usually first line)
    const costLine = lines.find(l => l.shippingCost !== null);
    if (!costLine || costLine.shippingCost === null) continue;
    const country = costLine.country;
    if (!country) continue;
    const tracking = costLine.trackingNumber || lines.find(l => l.trackingNumber)?.trackingNumber || null;
    const prefix = tracking ? extractTrackingPrefix(tracking) : null;
    const carrier = prefix && prefix.length >= 2 ? prefix.slice(0, 2) : null;
    if (!carrier) continue;

    const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
    const tierKey = `${country}||${carrier}||${totalQty}`;
    if (!tierSamples.has(tierKey)) tierSamples.set(tierKey, []);
    tierSamples.get(tierKey)!.push(costLine.shippingCost);

    // Per-SKU cost: only from single-line, qty=1 orders (cost is unambiguous)
    if (lines.length === 1 && lines[0].quantity === 1) {
      const ln = lines[0];
      const k = skuKey(ln.sku, country, carrier);
      if (!samples.has(k)) samples.set(k, []);
      samples.get(k)!.push(costLine.shippingCost);
      result.singleItemOrders++;

      // Record (productName, style) seen for this SKU
      const ctxKey = `${(ln.productName || '').trim()}||${(ln.style || '').trim()}`;
      if (!skuContext.has(ln.sku)) skuContext.set(ln.sku, new Map());
      const ctx = skuContext.get(ln.sku)!;
      ctx.set(ctxKey, (ctx.get(ctxKey) || 0) + 1);
    }
  }

  // Lookup ProductVariants by SKU (case-insensitive). Many CSV SKUs map to
  // multiple Shopify variants — pick the one whose SKU exactly matches.
  const allSkus = new Set<string>();
  for (const k of samples.keys()) allSkus.add(k.split('||')[0]);
  result.uniqueSkus = allSkus.size;

  const variantsBySku = new Map<string, bigint>();
  for (const sku of allSkus) {
    // Build candidate SKU list: direct, alias.
    const candidates = [sku];
    const alias = SKU_ALIASES[sku.toLowerCase()];
    if (alias && alias !== sku) candidates.push(alias);

    // Identify the product context this SKU is most often associated with in the CSV.
    const ctx = skuContext.get(sku);
    let dominantContext = '';
    if (ctx && ctx.size > 0) {
      let max = 0;
      for (const [k, count] of ctx) {
        if (count > max) { max = count; dominantContext = k; }
      }
    }
    const [ctxProduct = '', ctxStyle = ''] = dominantContext.split('||');
    // Build keyword tokens from style (e.g. "Signature Edition - Black" → [signature, edition, black])
    const styleTokens = ctxStyle.toLowerCase().split(/[\s/-]+/).filter(t => t.length >= 3);
    // Some style words are common across many products and don't help disambiguate.
    const STOPWORDS = new Set(['edition', 'tote', 'with', 'lunch', 'compartment', 'bag', 'box']);

    let matchedId: bigint | null = null;
    for (const candidate of candidates) {
      // Fetch ALL variants matching this SKU (case-insensitive). When several
      // exist, we'll score them against the CSV's product/style context.
      const allMatches = await prisma.productVariant.findMany({
        where: { sku: { equals: candidate, mode: 'insensitive' } },
        select: { variantId: true, sku: true, title: true, userId: true }
      });
      if (allMatches.length === 0) continue;

      // Score each candidate variant: prefer tenant-owned, then prefer titles
      // that contain style tokens / product name words.
      const scored = allMatches.map(v => {
        const title = (v.title || '').toLowerCase();
        let score = 0;
        if (v.userId === userId) score += 10; // tenant ownership preferred
        // Exact case-sensitive SKU match outranks case-insensitive
        if (v.sku === candidate) score += 5;
        // Each style token found in title contributes
        for (const tok of styleTokens) {
          if (STOPWORDS.has(tok)) continue;
          if (title.includes(tok)) score += 3;
        }
        // Penalise titles that contain "Valentine" when CSV style doesn't say so
        if (title.includes("valentine") && !ctxStyle.toLowerCase().includes("valentine")) score -= 4;
        return { variantId: v.variantId, score };
      });
      scored.sort((a, b) => b.score - a.score);
      matchedId = scored[0].variantId;
      break;
    }

    if (matchedId !== null) variantsBySku.set(sku, matchedId);
  }

  // Resolve unmapped SKUs into a list for the UI
  for (const sku of allSkus) {
    if (!variantsBySku.has(sku)) result.unmappedSkus.push(sku);
  }

  // Per SKU → cross-country median (for ProductVariant.baseCost)
  const perSkuAll = new Map<string, number[]>();

  // Find or create pricebooks for every (country, carrier) combo we saw
  const pricebookKey = (c: string, carrier: string) => `${c}||${carrier}`;
  const pricebooks = new Map<string, string>(); // key → pricebookId

  const countriesSeen = new Set<string>();
  const carriersSeen = new Set<string>();

  for (const k of samples.keys()) {
    const [, country, carrier] = k.split('||');
    countriesSeen.add(country);
    carriersSeen.add(carrier);
    const pkey = pricebookKey(country, carrier);
    if (!pricebooks.has(pkey)) {
      const existing = await prisma.pricebook.findUnique({
        where: {
          userId_storeId_supplier_countryCode_shippingCompany: {
            userId, storeId, supplier, countryCode: country, shippingCompany: carrier
          }
        }
      });
      if (existing) {
        pricebooks.set(pkey, existing.pricebookId);
      } else {
        const created = await prisma.pricebook.create({
          data: { userId, storeId, supplier, countryCode: country, shippingCompany: carrier, currency: 'USD' }
        });
        pricebooks.set(pkey, created.pricebookId);
      }
      result.pricebooksTouched++;
    }
  }

  result.uniqueCountries = countriesSeen.size;
  result.uniqueCarriers = carriersSeen.size;

  // Write variant cost overrides
  for (const [k, costs] of samples) {
    const [sku, country, carrier] = k.split('||');
    const variantId = variantsBySku.get(sku);
    if (!variantId) continue;
    const pricebookId = pricebooks.get(pricebookKey(country, carrier))!;
    const cost = median(costs);

    if (!perSkuAll.has(sku)) perSkuAll.set(sku, []);
    perSkuAll.get(sku)!.push(...costs);

    await prisma.pricebookVariantCostOverride.upsert({
      where: { pricebookId_variantId: { pricebookId, variantId } },
      create: { pricebookId, variantId, overrideCost: new Prisma.Decimal(cost) },
      update: { overrideCost: new Prisma.Decimal(cost) }
    });
    result.variantOverridesWritten++;
  }

  // Update ProductVariant.basecost to cross-country median (= product + supplier shipping)
  for (const [sku, costs] of perSkuAll) {
    const variantId = variantsBySku.get(sku);
    if (!variantId) continue;
    const basecost = median(costs);
    await prisma.productVariant.update({
      where: { variantId },
      data: { basecost: new Prisma.Decimal(basecost) }
    });
    result.variantsBaseCostUpdated++;
  }

  // Update shipping-tier rows: since the override already includes shipping,
  // zero out tiers for the (supplier, country, carrier) pricebooks we touched.
  // This avoids double-counting variant-cost + tier-cost.
  for (const [, pricebookId] of pricebooks) {
    await prisma.pricebookShippingTier.deleteMany({ where: { pricebookId } });
    await prisma.pricebookShippingTier.create({
      data: {
        pricebookId,
        minItems: 1,
        maxItems: 999,
        shippingCost: new Prisma.Decimal(0)
      }
    });
    result.shippingTiersUpdated++;
  }

  return result;
}
