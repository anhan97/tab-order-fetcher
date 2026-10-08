/**
 * Shared by the COGS matrix and the combo grid: a price is entered as two
 * parts and the total is always derived, never typed.
 */

/** p = product cost, s = shipping cost. */
export type CostPart = 'p' | 's';

/** Parse a typed money string; '' → null (empty), junk → null. */
export const money = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** "12.5" for product + shipping, or '' when both parts are empty. */
export const totalOf = (p: string | undefined, s: string | undefined): string => {
  const a = money(p), b = money(s);
  if (a === null && b === null) return '';
  return (Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100).toString();
};

/** Server decimal → input string; 0 shows as '' so an empty part stays empty. */
export const fromServer = (v: string | null | undefined) =>
  v === null || v === undefined || Number(v) === 0 ? '' : String(Number(v));
