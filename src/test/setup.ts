import '@testing-library/jest-dom';
import { vi } from 'vitest';

// In-memory localStorage. This used to be four bare `vi.fn()` stubs that
// stored nothing and always returned undefined, so any test asserting on
// persisted state silently passed against a black hole. Backed by a real Map
// so reads observe writes; still spies, so `toHaveBeenCalledWith` works.
const store = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
  setItem: vi.fn((k: string, v: string) => { store.set(k, String(v)); }),
  removeItem: vi.fn((k: string) => { store.delete(k); }),
  clear: vi.fn(() => { store.clear(); }),
  key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
  get length() { return store.size; },
};

global.localStorage = localStorageMock as any;

// Mock fetch
global.fetch = vi.fn();

// Mock ResizeObserver
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})); 