/**
 * Combo pricing rules. These decide what an order's COGS is, so a quiet change
 * here moves every P&L number — pin them.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeComboItems, comboSignature, validateCombo, orderSignature,
  allocateComboCost, parseMoney
} from '../src/lib/cogs-combo';

describe('normalizeComboItems', () => {
  it('merges the same variant and sorts numerically', () => {
    expect(normalizeComboItems([
      { variantId: '10', qty: 1 }, { variantId: '9', qty: 2 }, { variantId: '10', qty: 1 }
    ])).toEqual([{ variantId: '9', qty: 2 }, { variantId: '10', qty: 2 }]);
  });

  it('drops junk ids and quantities', () => {
    expect(normalizeComboItems([
      { variantId: 'abc', qty: 1 }, { variantId: '5', qty: 0 }, { variantId: '6', qty: 100 },
      null, 'x', { variantId: '7', qty: '3' }
    ])).toEqual([{ variantId: '7', qty: 3 }]);
  });
});

describe('signatures', () => {
  it('are the same regardless of item order', () => {
    const a = comboSignature(normalizeComboItems([{ variantId: '222', qty: 1 }, { variantId: '111', qty: 2 }]));
    const b = comboSignature(normalizeComboItems([{ variantId: '111', qty: 2 }, { variantId: '222', qty: 1 }]));
    expect(a).toBe('111x2,222x1');
    expect(a).toBe(b);
  });

  it('an order signature matches its combo', () => {
    const combo = comboSignature(normalizeComboItems([{ variantId: '111', qty: 1 }, { variantId: '222', qty: 1 }]));
    expect(orderSignature([
      { variantId: BigInt(222), quantity: 1 },
      { variantId: BigInt(111), quantity: 1 }
    ])).toBe(combo);
  });

  it('a split line of the same variant still matches', () => {
    expect(orderSignature([
      { variantId: '111', quantity: 1 }, { variantId: '111', quantity: 1 }, { variantId: '222', quantity: 1 }
    ])).toBe('111x2,222x1');
  });

  it('an order with a custom item or a single product is never a combo', () => {
    expect(orderSignature([{ variantId: '111', quantity: 1 }, { variantId: null, quantity: 1 }])).toBeNull();
    expect(orderSignature([{ variantId: '111', quantity: 3 }])).toBeNull();
  });
});

describe('validateCombo', () => {
  it('needs two different products', () => {
    expect(validateCombo(normalizeComboItems([{ variantId: '1', qty: 2 }]))).toMatch(/two different/);
    expect(validateCombo(normalizeComboItems([{ variantId: '1', qty: 1 }, { variantId: '2', qty: 1 }]))).toBeNull();
  });
});

describe('allocateComboCost', () => {
  const sumBack = (m: Map<string, number>, qty: Record<string, number>) =>
    Math.round([...m.entries()].reduce((s, [k, unit]) => s + unit * qty[k], 0) * 100) / 100;

  it('weights by each item\'s own unit price', () => {
    const m = allocateComboCost(30, [
      { key: 'shirt', qty: 1, singleUnitPrice: 20 },
      { key: 'cap', qty: 1, singleUnitPrice: 10 }
    ]);
    expect(m.get('shirt')).toBe(20);
    expect(m.get('cap')).toBe(10);
  });

  it('falls back to unit count when a price is missing', () => {
    const m = allocateComboCost(30, [
      { key: 'a', qty: 2, singleUnitPrice: 12 },
      { key: 'b', qty: 1 }
    ]);
    expect(m.get('a')).toBe(10);
    expect(m.get('b')).toBe(10);
  });

  it('adds back up to the combo cost despite rounding', () => {
    const qty = { a: 1, b: 1, c: 1 };
    const m = allocateComboCost(10, [
      { key: 'a', qty: 1, singleUnitPrice: 1 },
      { key: 'b', qty: 1, singleUnitPrice: 1 },
      { key: 'c', qty: 1, singleUnitPrice: 1 }
    ]);
    expect(sumBack(m, qty)).toBe(10);
  });
});

describe('parseMoney', () => {
  it('accepts comma decimals, clears on empty, rejects negatives and junk', () => {
    expect(parseMoney('12,5')).toBe(12.5);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('-1')).toBeNaN();
    expect(parseMoney('abc')).toBeNaN();
  });
});
