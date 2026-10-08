import { describe, expect, it } from 'vitest';
import {
  addAllInOrder,
  distinctProducts,
  errorMessage,
  formatMoney,
  formatRoas,
  normalizeAngle,
  refreshSelection,
  renameWithAngle,
  selectionOrder,
  toggleInOrder
} from './library';

type Item = { id: string; v?: number };
const key = (x: Item) => x.id;
const ids = (xs: Item[]) => xs.map(key);

describe('ordered selection', () => {
  it('toggles while keeping selection order', () => {
    let sel: Item[] = [];
    sel = toggleInOrder(sel, { id: 'c' }, key);
    sel = toggleInOrder(sel, { id: 'a' }, key);
    sel = toggleInOrder(sel, { id: 'b' }, key);
    expect(ids(sel)).toEqual(['c', 'a', 'b']);
    sel = toggleInOrder(sel, { id: 'a' }, key);
    expect(ids(sel)).toEqual(['c', 'b']);
    expect(selectionOrder(sel, 'b', key)).toBe(2);
    expect(selectionOrder(sel, 'a', key)).toBe(0);
  });

  it('"select all shown" appends only the missing ones, in display order', () => {
    const sel = addAllInOrder([{ id: 'b' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'a' }], key);
    expect(ids(sel)).toEqual(['b', 'a', 'c']);
  });

  it('refreshSelection swaps in fresh copies without reordering', () => {
    const sel = [{ id: 'b', v: 1 }, { id: 'a', v: 1 }];
    const out = refreshSelection(sel, [{ id: 'a', v: 2 }], key);
    expect(out).toEqual([{ id: 'b', v: 1 }, { id: 'a', v: 2 }]);
    expect(refreshSelection(sel, undefined, key)).toEqual(sel);
  });

  it('distinctProducts ignores empties and keeps first-seen order', () => {
    expect(distinctProducts(['p2', null, 'p1', 'p2', undefined, ''])).toEqual(['p2', 'p1']);
  });
});

describe('names', () => {
  it('normalizeAngle turns | into /', () => {
    expect(normalizeAngle('Before | after')).toBe('Before / after');
  });

  it('renameWithAngle swaps only the angle part, keeping the created date', () => {
    const name = 'Triết | Dead corner fix | SINLTB071SHNA - 25/04/2026';
    expect(renameWithAngle(name, 'New | angle  here', { creator: 'x', code: 'y', createdAt: '2026-10-07T00:00:00Z' }))
      .toBe('Triết | New / angle here | SINLTB071SHNA - 25/04/2026');
  });

  it('renameWithAngle rebuilds names of an unexpected shape', () => {
    const out = renameWithAngle('legacy name', 'Hook', { creator: 'An Le', code: 'ABC', createdAt: new Date(2026, 3, 25, 12) });
    expect(out).toBe('An Le | Hook | ABC - 25/04/2026');
  });
});

describe('formatting', () => {
  it('formatMoney uses the currency when there is one', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('$1,234.50');
    expect(formatMoney('12', null)).toBe('12.00');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('', 'USD')).toBe('—');
    expect(formatMoney('abc', 'USD')).toBe('—');
    expect(formatMoney('5', 'NOT-A-CODE')).toBe('5.00 NOT-A-CODE');
  });

  it('formatRoas', () => {
    expect(formatRoas(2.345)).toBe('2.35');
    expect(formatRoas(null)).toBe('—');
  });

  it('errorMessage makes network failures readable', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/Network error/);
    expect(errorMessage(new Error('Angle is required'))).toBe('Angle is required');
    expect(errorMessage(undefined)).toBe('Something went wrong.');
  });
});
