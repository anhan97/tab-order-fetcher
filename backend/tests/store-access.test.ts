/**
 * The capability table is the whole authorization model for delegated stores,
 * so it gets pinned explicitly rather than left to "read the record literal".
 * A role quietly gaining a capability is exactly the kind of change that
 * should fail a test rather than ship.
 */
import { describe, it, expect } from 'vitest';
import {
  can, capabilitiesFor, isGrantableStoreRole, GRANTABLE_STORE_ROLES,
  type StoreAccessLevel, type StoreCapability
} from '../src/lib/store-access';

const ALL_CAPS: StoreCapability[] = ['read', 'sync', 'fulfill', 'costs', 'manage'];

describe('store capability table', () => {
  const expected: Record<StoreAccessLevel, StoreCapability[]> = {
    owner:   ['read', 'sync', 'fulfill', 'costs', 'manage'],
    manager: ['read', 'sync', 'fulfill', 'costs', 'manage'],
    cs:      ['read', 'sync', 'fulfill'],
    finance: ['read', 'sync', 'costs'],
    viewer:  ['read']
  };

  it.each(Object.entries(expected))('%s has exactly the expected capabilities', (level, caps) => {
    expect(capabilitiesFor(level as StoreAccessLevel).sort()).toEqual([...caps].sort());
  });

  it.each(Object.entries(expected))('%s: can() agrees with the table for every capability', (level, caps) => {
    for (const cap of ALL_CAPS) {
      expect(can(level as StoreAccessLevel, cap)).toBe(caps.includes(cap));
    }
  });

  it('a viewer can only read — never writes anything', () => {
    expect(can('viewer', 'read')).toBe(true);
    for (const cap of ['sync', 'fulfill', 'costs', 'manage'] as StoreCapability[]) {
      expect(can('viewer', cap)).toBe(false);
    }
  });

  it('cs cannot touch costs, finance cannot touch fulfillment', () => {
    expect(can('cs', 'costs')).toBe(false);
    expect(can('finance', 'fulfill')).toBe(false);
  });

  it('only owner and manager may change store settings', () => {
    expect(can('owner', 'manage')).toBe(true);
    expect(can('manager', 'manage')).toBe(true);
    expect(can('cs', 'manage')).toBe(false);
    expect(can('finance', 'manage')).toBe(false);
    expect(can('viewer', 'manage')).toBe(false);
  });

  it('an unknown or missing level grants nothing (fails closed)', () => {
    for (const cap of ALL_CAPS) {
      expect(can(null, cap)).toBe(false);
      expect(can(undefined, cap)).toBe(false);
      expect(can('nonsense' as StoreAccessLevel, cap)).toBe(false);
    }
  });

  it('capabilitiesFor returns a copy — callers cannot mutate the table', () => {
    const caps = capabilitiesFor('viewer');
    caps.push('manage');
    expect(capabilitiesFor('viewer')).toEqual(['read']);
  });
});

describe('grantable roles', () => {
  it('owner is not grantable — ownership comes from ShopifyStore.userId', () => {
    expect(isGrantableStoreRole('owner')).toBe(false);
    expect(GRANTABLE_STORE_ROLES).not.toContain('owner' as never);
  });

  it.each(GRANTABLE_STORE_ROLES)('%s is grantable', role => {
    expect(isGrantableStoreRole(role)).toBe(true);
  });

  it('rejects junk an admin request might carry', () => {
    for (const v of ['', 'ADMIN', 'Manager', 'root', null, undefined, 42, {}, []]) {
      expect(isGrantableStoreRole(v)).toBe(false);
    }
  });
});
