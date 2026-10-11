/**
 * The capability table is the whole authorization model for delegated stores,
 * so it gets pinned explicitly rather than left to "read the record literal".
 * A role quietly gaining a capability is exactly the kind of change that
 * should fail a test rather than ship.
 */
import { describe, it, expect } from 'vitest';
import {
  can, capabilitiesFor, isGrantableStoreRole, isStorePermission, normalizePermissions,
  ALL_STORE_CAPABILITIES, GRANTABLE_STORE_ROLES, STORE_PERMISSIONS,
  type StoreAccessLevel, type StoreCapability, type StorePermission
} from '../src/lib/store-access';

const ALL_CAPS: StoreCapability[] = [...ALL_STORE_CAPABILITIES];
const ADS: StorePermission[] = [...STORE_PERMISSIONS];

describe('store capability table', () => {
  const expected: Record<StoreAccessLevel, StoreCapability[]> = {
    owner:    ['read', 'sync', 'fulfill', 'costs', 'manage', ...ADS],
    manager:  ['read', 'sync', 'fulfill', 'costs', 'manage'],
    cs:       ['read', 'sync', 'fulfill'],
    finance:  ['read', 'sync', 'costs'],
    viewer:   ['read'],
    creative: ['creatives.upload']
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
    for (const cap of ALL_CAPS.filter(c => c !== 'read')) {
      expect(can('viewer', cap)).toBe(false);
    }
  });

  it('no member role sees Creatives, the launcher or Facebook until granted', () => {
    for (const level of ['manager', 'cs', 'finance', 'viewer'] as StoreAccessLevel[]) {
      for (const p of ADS) expect(can(level, p)).toBe(false);
    }
  });

  it('a creative uploads and nothing else — no orders, no P&L', () => {
    expect(capabilitiesFor('creative')).toEqual(['creatives.upload']);
    expect(can('creative', 'read')).toBe(false);
    expect(can('creative', 'creatives.view')).toBe(false);
    expect(can('creative', 'ads.launch')).toBe(false);
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
    const owner = capabilitiesFor('owner');
    owner.length = 0;
    expect(capabilitiesFor('owner')).toEqual(ALL_CAPS);
  });
});

describe('granted permissions on top of the role', () => {
  it('adds exactly what was granted (plus what it needs)', () => {
    expect(capabilitiesFor('manager', ['facebook.view'])).toEqual(['read', 'sync', 'fulfill', 'costs', 'manage', 'facebook.view']);
    expect(capabilitiesFor('viewer', ['creatives.upload'])).toEqual(['read', 'creatives.upload']);
  });

  it('a permission brings what it is useless without', () => {
    expect(capabilitiesFor('viewer', ['ads.launch'])).toEqual(['read', 'creatives.view', 'ads.launch']);
    expect(capabilitiesFor('viewer', ['creatives.manage'])).toEqual(['read', 'creatives.upload', 'creatives.view', 'creatives.manage']);
    expect(capabilitiesFor('viewer', ['facebook.manage'])).toEqual(['read', 'facebook.view', 'facebook.manage']);
  });

  it('uploading does not open the whole library', () => {
    expect(can('viewer', 'creatives.view', ['creatives.upload'])).toBe(false);
  });

  it('never grants a store capability, whatever the list carries', () => {
    const caps = capabilitiesFor('viewer', ['manage', 'costs', 'fulfill', 'sync', 'admin'] as string[]);
    expect(caps).toEqual(['read']);
  });

  it('an unknown level grants nothing, granted permissions included (fails closed)', () => {
    expect(capabilitiesFor('nonsense' as StoreAccessLevel, ADS)).toEqual([]);
    expect(capabilitiesFor('constructor' as StoreAccessLevel, ADS)).toEqual([]);
    expect(can(null, 'ads.launch', ADS)).toBe(false);
  });

  it('normalizePermissions keeps known ones, once, in canonical order', () => {
    expect(normalizePermissions(['facebook.view', 'ads.launch', 'ads.launch', 'nope', 7, null])).toEqual(['ads.launch', 'facebook.view']);
    expect(normalizePermissions('ads.launch')).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
  });

  it('isStorePermission rejects store capabilities and junk', () => {
    for (const p of ADS) expect(isStorePermission(p)).toBe(true);
    for (const v of ['read', 'manage', 'ADS.LAUNCH', '', null, {}]) expect(isStorePermission(v)).toBe(false);
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
