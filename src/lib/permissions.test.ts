import { describe, it, expect } from 'vitest';
import type { StoreCapability } from '@/context/AuthContext';
import { canOpenPage, effectivePermissions, homePath, impliedBy } from './permissions';

const caps = (...list: StoreCapability[]) => (c: StoreCapability) => list.includes(c);
const visible = (role: Parameters<typeof canOpenPage>[1], can: (c: StoreCapability) => boolean) =>
  ['/orders', '/fulfillment', '/tracking', '/connect', '/cogs', '/facebook', '/creatives', '/ads-launcher', '/content', '/admin']
    .filter(p => canOpenPage(p, role, can));

describe('sidebar', () => {
  it('a store manager without grants sees no Creatives / Ads Launcher / Facebook / Content', () => {
    expect(visible('user', caps('read', 'sync', 'fulfill', 'costs', 'manage')))
      .toEqual(['/orders', '/fulfillment', '/tracking', '/connect', '/cogs']);
  });

  it('a creative sees Creatives (and Stores to switch) only', () => {
    expect(visible('user', caps('creatives.upload'))).toEqual(['/connect', '/creatives']);
  });

  it('granted permissions add exactly their pages', () => {
    expect(visible('user', caps('read', 'creatives.view', 'ads.launch', 'facebook.view')))
      .toEqual(['/orders', '/fulfillment', '/tracking', '/connect', '/cogs', '/facebook', '/creatives', '/ads-launcher', '/content']);
  });

  it('the system role still limits: finance never sees Facebook, whatever the store grants', () => {
    expect(canOpenPage('/facebook', 'finance', caps('read', 'facebook.view'))).toBe(false);
  });

  it('admins see everything, even with no store', () => {
    expect(visible('admin', caps())).toHaveLength(10);
  });

  it('no active store (nothing granted): only Stores', () => {
    expect(visible('user', caps())).toEqual(['/connect']);
  });
});

describe('home page', () => {
  it('lands on the first page the user may open', () => {
    expect(homePath('user', caps('read'))).toBe('/orders');
    expect(homePath('user', caps('creatives.upload'))).toBe('/creatives');
    expect(homePath('user', caps())).toBe('/connect');
    expect(homePath('admin', caps())).toBe('/orders');
  });
});

describe('permission picker', () => {
  it('folds in what the role and other ticks include', () => {
    expect([...effectivePermissions('creative', [])]).toEqual(['creatives.upload']);
    expect([...effectivePermissions('viewer', ['ads.launch'])].sort()).toEqual(['ads.launch', 'creatives.view']);
    expect([...effectivePermissions('manager', ['creatives.manage'])].sort())
      .toEqual(['creatives.manage', 'creatives.upload', 'creatives.view']);
  });

  it('explains why a permission is on without being ticked', () => {
    expect(impliedBy('creative', [], 'creatives.upload')).toBe('included in creative');
    expect(impliedBy('viewer', ['ads.launch'], 'creatives.view')).toBe('included in "Launch ads"');
    expect(impliedBy('viewer', [], 'creatives.view')).toBeNull();
  });
});
