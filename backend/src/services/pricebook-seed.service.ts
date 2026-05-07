import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed shipping tiers per (country, supplier, carrier) tuple. The user's
 * standard rates as of May 2026:
 *
 *   US:  qty 1 = $22.00, qty 2 = $38.90
 *   UK:  qty 1 = $19.10, qty 2 = $34.40
 *   CA:  qty 1 = $21.10, qty 2 = $39.40
 *   AU:  qty 1 = $16.70, qty 2 = $29.30  (Zone1)
 *
 * For qty ≥ 3 we extrapolate linearly from the (1 → 2) gradient until the
 * user provides explicit rates. Cap the upper bracket at 999 so any large
 * combo still hits a tier.
 */
const COUNTRY_TIERS: Record<string, Array<{ qty: number; cost: number }>> = {
  US: [{ qty: 1, cost: 22.00 }, { qty: 2, cost: 38.90 }],
  UK: [{ qty: 1, cost: 19.10 }, { qty: 2, cost: 34.40 }],
  GB: [{ qty: 1, cost: 19.10 }, { qty: 2, cost: 34.40 }], // Shopify uses GB code
  CA: [{ qty: 1, cost: 21.10 }, { qty: 2, cost: 39.40 }],
  AU: [{ qty: 1, cost: 16.70 }, { qty: 2, cost: 29.30 }]
};

export interface SeedResult {
  pricebooksCreated: number;
  pricebooksUpdated: number;
  tiersWritten: number;
  details: Array<{ country: string; supplier: string; carrier: string; pricebookId: string; tierCount: number }>;
}

/**
 * Idempotent. Creates one pricebook per country for the given (supplier, carrier).
 * Re-running replaces shipping tiers in place.
 */
export async function seedDefaultPricebooks(
  userId: string,
  storeId: string,
  options: { supplier?: string; shippingCompany?: string; currency?: string } = {}
): Promise<SeedResult> {
  const supplier = options.supplier || 'Default';
  const shippingCompany = options.shippingCompany || 'Default';
  const currency = options.currency || 'USD';

  const result: SeedResult = { pricebooksCreated: 0, pricebooksUpdated: 0, tiersWritten: 0, details: [] };

  for (const [country, tiers] of Object.entries(COUNTRY_TIERS)) {
    const existing = await prisma.pricebook.findFirst({
      where: { userId, storeId, supplier, countryCode: country, shippingCompany }
    });

    let pricebookId: string;
    if (existing) {
      pricebookId = existing.pricebookId;
      result.pricebooksUpdated++;
      // Wipe tiers and re-create (idempotent re-seed)
      await prisma.pricebookShippingTier.deleteMany({ where: { pricebookId } });
    } else {
      const created = await prisma.pricebook.create({
        data: { userId, storeId, supplier, countryCode: country, shippingCompany, currency }
      });
      pricebookId = created.pricebookId;
      result.pricebooksCreated++;
    }

    // Build inclusive [min, max] tiers from the qty-anchored points + an
    // extrapolated 3..999 bracket using the (1→2) gradient.
    const sorted = [...tiers].sort((a, b) => a.qty - b.qty);
    const tierRows: Array<{ pricebookId: string; minItems: number; maxItems: number; shippingCost: Prisma.Decimal }> = [];

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      tierRows.push({
        pricebookId,
        minItems: t.qty,
        maxItems: t.qty,
        shippingCost: new Prisma.Decimal(t.cost)
      });
    }
    // Extrapolate qty 3-999
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      const delta = last.cost - prev.cost; // per extra item
      const startQty = last.qty + 1;
      // Single bracket [startQty, 999] uses extrapolated cost-per-item rule —
      // we encode the value at startQty as a placeholder so the user can
      // adjust. For a 3-item order: cost = last + (3 - last.qty) * delta.
      const extrapolatedCost = last.cost + delta;
      tierRows.push({
        pricebookId,
        minItems: startQty,
        maxItems: 999,
        shippingCost: new Prisma.Decimal(Math.round(extrapolatedCost * 100) / 100)
      });
    }

    if (tierRows.length) {
      await prisma.pricebookShippingTier.createMany({ data: tierRows, skipDuplicates: true });
      result.tiersWritten += tierRows.length;
    }
    result.details.push({ country, supplier, carrier: shippingCompany, pricebookId, tierCount: tierRows.length });
  }

  return result;
}
