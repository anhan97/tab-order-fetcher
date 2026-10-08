/**
 * Which Shopify access scopes a store's token actually has, and what that
 * means for pushing fulfillments.
 *
 * Writing tracking to Shopify goes through fulfillment orders. Shopify does
 * NOT reject a token that lacks those scopes — it simply returns the subset of
 * fulfillment orders the token may see, which for a token without them is an
 * EMPTY list. The old code read that as "this order has no fulfillment orders"
 * and raised a generic 500, so a missing permission looked like a bug in the
 * order.
 *
 * https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentorder
 */

/** One read scope is enough to SEE a fulfillment order; write to fulfil it. */
export const FULFILLMENT_SCOPE_GROUPS = [
  { read: 'read_merchant_managed_fulfillment_orders', write: 'write_merchant_managed_fulfillment_orders' },
  { read: 'read_assigned_fulfillment_orders', write: 'write_assigned_fulfillment_orders' },
  { read: 'read_third_party_fulfillment_orders', write: 'write_third_party_fulfillment_orders' }
] as const;

/** What a store connected today asks for. Merchant-managed covers the normal
 *  case (the merchant ships themselves); assigned/third-party cover stores
 *  whose orders are routed to a fulfillment service. */
export const TRACKING_SCOPES = FULFILLMENT_SCOPE_GROUPS.flatMap(g => [g.read, g.write]);

const has = (granted: string[], scope: string) => granted.includes(scope);

/**
 * Scopes to add so this token can push tracking. Empty when the token can
 * already see AND fulfil at least one kind of fulfillment order — that is all
 * Shopify needs. An empty `granted` means we could not read the scope list, so
 * we say nothing rather than guess.
 */
export function missingFulfillmentScopes(granted: string[]): string[] {
  if (granted.length === 0) return [];
  const usable = FULFILLMENT_SCOPE_GROUPS.some(g => has(granted, g.read) && has(granted, g.write));
  if (usable) return [];
  // Recommend completing whichever group is furthest along, else the
  // merchant-managed one, which is what a normal store needs.
  const partial = FULFILLMENT_SCOPE_GROUPS.find(g => has(granted, g.read) || has(granted, g.write));
  const target = partial ?? FULFILLMENT_SCOPE_GROUPS[0];
  return [target.read, target.write].filter(s => !has(granted, s));
}

/** The message a merchant can act on, in the app's UI language (English). */
export function missingScopeMessage(missing: string[], storeDomain: string): string {
  return `${storeDomain} cannot write fulfillments: the Shopify app is missing ${missing.join(' and ')}. `
    + 'Add the scope(s) to the app in the Shopify admin (custom app) or Partner Dashboard, then reconnect the store on the Stores page.';
}
