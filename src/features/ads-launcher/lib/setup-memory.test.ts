import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SETUP_MEMORY_DEBOUNCE_MS,
  pickSetupMemory,
  readSetupMemory,
  setupMemoryKey,
  useSetupMemory,
  writeSetupMemory
} from './setup-memory';

const FULL = {
  adAccountId: '900000000000001',
  pixelId: '2000000002',
  pageId: '1000000001',
  storeId: 'store-1',
  displayLink: 'shop-a.com',
  urlTags: 'utm_source=fb',
  presetId: 'preset-1'
};

describe('setup memory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('uses a per-user key', () => {
    expect(setupMemoryKey('u1')).toBe('ads-launcher:setup:u1');
  });

  it('round-trips the remembered fields per user', () => {
    writeSetupMemory('u1', FULL);
    expect(readSetupMemory('u1')).toEqual(FULL);
    expect(readSetupMemory('u2')).toEqual({});
  });

  it('never stores the pool, copy edits or an existing campaign', () => {
    writeSetupMemory('u1', { ...FULL, pool: ['a'], copy: { a: {} }, target: { mode: 'existing' }, campaignId: '1' } as never);
    const stored = JSON.parse(localStorage.getItem('ads-launcher:setup:u1')!);
    expect(Object.keys(stored).sort()).toEqual(Object.keys(FULL).sort());
  });

  it('keeps only string values', () => {
    expect(pickSetupMemory({ adAccountId: 1, pixelId: '2', pageId: null })).toEqual({ pixelId: '2' });
    expect(pickSetupMemory(null)).toEqual({});
  });

  it('survives broken JSON and a throwing localStorage', () => {
    localStorage.setItem('ads-launcher:setup:u1', '{not json');
    expect(readSetupMemory('u1')).toEqual({});
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(readSetupMemory('u1')).toEqual({});
    expect(() => writeSetupMemory('u1', FULL)).not.toThrow();
  });

  it('does nothing without a user', () => {
    writeSetupMemory(null, FULL);
    expect(localStorage.length).toBe(0);
    expect(readSetupMemory(undefined)).toEqual({});
  });

  it('saves 300 ms after the last change (debounced)', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderHook(({ v }) => useSetupMemory('u1', v), { initialProps: { v: { adAccountId: '1' } } });
      rerender({ v: { adAccountId: '2' } });
      act(() => { vi.advanceTimersByTime(SETUP_MEMORY_DEBOUNCE_MS - 50); });
      expect(localStorage.getItem('ads-launcher:setup:u1')).toBeNull();
      rerender({ v: { adAccountId: '3' } });
      act(() => { vi.advanceTimersByTime(SETUP_MEMORY_DEBOUNCE_MS - 50); });
      expect(localStorage.getItem('ads-launcher:setup:u1')).toBeNull();
      act(() => { vi.advanceTimersByTime(60); });
      expect(readSetupMemory('u1')).toEqual({ adAccountId: '3' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves a pending change when unmounted inside the debounce window', () => {
    vi.useFakeTimers();
    try {
      const { rerender, unmount } = renderHook(({ v }) => useSetupMemory('u1', v), { initialProps: { v: { pageId: '1' } } });
      rerender({ v: { pageId: '2' } });
      unmount();
      expect(readSetupMemory('u1')).toEqual({ pageId: '2' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not save while disabled', () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useSetupMemory('u1', { adAccountId: '1' }, false));
      act(() => { vi.advanceTimersByTime(1000); });
      expect(localStorage.getItem('ads-launcher:setup:u1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
