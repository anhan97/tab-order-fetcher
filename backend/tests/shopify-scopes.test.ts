import { describe, it, expect } from 'vitest';
import { missingFulfillmentScopes, missingScopeMessage, TRACKING_SCOPES } from '../src/lib/shopify-scopes';

const BASE = ['read_orders', 'write_orders', 'read_products'];

describe('missingFulfillmentScopes', () => {
  it('names the merchant-managed pair when a store has none of the fulfillment scopes', () => {
    expect(missingFulfillmentScopes(BASE)).toEqual([
      'read_merchant_managed_fulfillment_orders',
      'write_merchant_managed_fulfillment_orders'
    ]);
  });

  it('is satisfied by one complete group', () => {
    expect(missingFulfillmentScopes([...BASE, 'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders'])).toEqual([]);
    // A store whose orders go to a fulfillment service only has the assigned pair.
    expect(missingFulfillmentScopes([...BASE, 'read_assigned_fulfillment_orders', 'write_assigned_fulfillment_orders'])).toEqual([]);
  });

  it('asks only for the half that is missing, in the group already started', () => {
    expect(missingFulfillmentScopes([...BASE, 'read_assigned_fulfillment_orders']))
      .toEqual(['write_assigned_fulfillment_orders']);
    // Read alone on merchant-managed is exactly the case that returns
    // fulfillment orders but refuses to fulfil them.
    expect(missingFulfillmentScopes([...BASE, 'read_merchant_managed_fulfillment_orders']))
      .toEqual(['write_merchant_managed_fulfillment_orders']);
  });

  it('says nothing when the scope list could not be read', () => {
    expect(missingFulfillmentScopes([])).toEqual([]);
  });

  it('the message tells the merchant what to add and where', () => {
    const msg = missingScopeMessage(missingFulfillmentScopes(BASE), 'shop.myshopify.com');
    expect(msg).toContain('shop.myshopify.com');
    expect(msg).toContain('write_merchant_managed_fulfillment_orders');
    expect(msg).toMatch(/reconnect the store/i);
  });

  it('what a new store asks for covers every group', () => {
    expect(missingFulfillmentScopes(TRACKING_SCOPES)).toEqual([]);
    expect(TRACKING_SCOPES).toHaveLength(6);
  });
});
