/**
 * Combo pricing rules — pure functions, no database.
 *
 * A combo is a priced mix of DIFFERENT variants ("shirt + cap"). The matrix's
 * set columns already price N units of one variant, so a combo must contain
 * at least two distinct variants; anything less is just a set.
 *
 * Matching is exact on purpose: an order is costed from a combo only when its
 * line items are precisely the combo's items. Partial matching (finding a
 * combo inside a bigger basket) would need a pricing policy for the leftover
 * items and a rule for overlapping combos — neither of which the merchant has
 * asked for, and both of which silently change P&L when guessed wrong.
 */

export interface ComboItem {
  variantId: string;
  qty: number;
}

/** Merge duplicates, drop junk, sort by variant — the canonical form. */
export function normalizeComboItems(raw: unknown): ComboItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const merged = new Map<string, number>();
  for (const it of list) {
    const variantId = String((it as any)?.variantId ?? '').trim();
    const qty = parseInt(String((it as any)?.qty ?? ''), 10);
    if (!/^\d+$/.test(variantId) || !(qty >= 1 && qty <= 99)) continue;
    merged.set(variantId, (merged.get(variantId) ?? 0) + qty);
  }
  return [...merged.entries()]
    .map(([variantId, qty]) => ({ variantId, qty }))
    .sort((a, b) => compareIds(a.variantId, b.variantId));
}

/** Numeric-aware compare so "9" sorts before "10" and signatures are stable. */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Order-independent key: "111x1,222x2". Input must already be normalized. */
export function comboSignature(items: ComboItem[]): string {
  return items.map(i => `${i.variantId}x${i.qty}`).join(',');
}

/** Why a combo definition is unusable, or null when it is fine. */
export function validateCombo(items: ComboItem[]): string | null {
  if (items.length < 2) {
    return 'A combo needs at least two different products — use the Set columns for multiples of one product';
  }
  if (items.length > 20) return 'A combo can hold at most 20 different products';
  return null;
}

/**
 * Signature of an order's basket, or null when it cannot be a combo (a line
 * item without a variant, or fewer than two distinct variants).
 */
export function orderSignature(
  lineItems: Array<{ variantId: bigint | string | null; quantity: number }>
): string | null {
  if (lineItems.some(li => li.variantId === null || li.variantId === undefined)) return null;
  const items = normalizeComboItems(
    lineItems.map(li => ({ variantId: String(li.variantId), qty: li.quantity > 0 ? li.quantity : 1 }))
  );
  return items.length >= 2 ? comboSignature(items) : null;
}

/**
 * Split a combo's total cost across the order's line items and return the
 * per-UNIT cost for each.
 *
 * Weights are each item's own single-unit price × quantity when every item
 * has one, so an expensive product carries more of the combo cost than a
 * cheap add-on. If any item lacks a single-unit price, weights fall back to
 * unit count. Rounding drift is pushed onto the last item so the line
 * totals add back up to the combo cost exactly.
 */
export function allocateComboCost(
  total: number,
  lineItems: Array<{ key: string; qty: number; singleUnitPrice?: number }>
): Map<string, number> {
  const out = new Map<string, number>();
  if (lineItems.length === 0) return out;

  const usePrices = lineItems.every(li => (li.singleUnitPrice ?? 0) > 0);
  const weights = lineItems.map(li => (usePrices ? li.singleUnitPrice! * li.qty : li.qty));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  let allocated = 0;
  lineItems.forEach((li, i) => {
    const isLast = i === lineItems.length - 1;
    const lineTotal = isLast ? round2(total - allocated) : round2((total * weights[i]) / weightSum);
    allocated = round2(allocated + lineTotal);
    out.set(li.key, round2(lineTotal / li.qty));
  });
  return out;
}

/** Parse a money input; '' / null → null (meaning "clear"), junk → NaN. */
export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
