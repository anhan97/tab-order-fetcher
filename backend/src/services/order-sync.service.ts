import { PrismaClient, Prisma } from '@prisma/client';
import { fetchShopifyOrders, fetchOrderTransactions, summarizeTransactionFees, fetchBalanceTransactions } from './shopify.service';
import { resolveShippingCompanyForOrder } from './shipping-company.service';
import { decryptToken } from '../lib/token-crypto';
import { orderSignature, allocateComboCost } from '../lib/cogs-combo';

const prisma = new PrismaClient();
const THROTTLE_MS = parseInt(process.env.SHOPIFY_THROTTLE_MS || '500', 10);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SyncResult {
  ordersCreated: number;
  ordersUpdated: number;
  transactionsSynced: number;
  errors: Array<{ orderNumber: string; error: string }>;
}

export async function syncOrders(storeId: string, options: { since?: Date; until?: Date; pullTransactions?: boolean } = {}): Promise<SyncResult> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');

  // Two modes:
  //   • Explicit `since` (backfill, UI range, P&L scheduler): every order
  //     CREATED in the window is re-pulled.
  //   • Incremental (no since/until): every order UPDATED since the last
  //     successful run. This used to be "created after the newest order we
  //     have", which never revisited older orders (new fulfillments and
  //     refunds were missed) and never filled a gap left by a failed first
  //     sync. With no cursor yet we pull everything Shopify will give us (its
  //     REST API limits plain read_orders to the last 60 days).
  const incremental = options.since === undefined && options.until === undefined;
  const since = options.since;
  const updatedSince = incremental && store.ordersSyncedAt
    // Small overlap so an order updated during the previous run isn't missed.
    ? new Date(store.ordersSyncedAt.getTime() - 5 * 60 * 1000)
    : undefined;
  const startedAt = new Date();

  const result: SyncResult = { ordersCreated: 0, ordersUpdated: 0, transactionsSynced: 0, errors: [] };
  const pullTransactions = options.pullTransactions !== false;

  let pageInfo: string | undefined;
  do {
    const { orders, pageInfo: nextPage } = await fetchShopifyOrders(
      store.storeDomain,
      decryptToken(store.accessToken),
      {
        createdAtMin: since?.toISOString(),
        createdAtMax: options.until?.toISOString(),
        updatedAtMin: updatedSince?.toISOString(),
        limit: 250,
        page_info: pageInfo,
        // Always include cancelled orders too so refunds/cancellations show up correctly in P&L.
        status: 'any'
      }
    );

    for (const order of orders) {
      try {
        const upserted = await upsertOrder(store.userId, storeId, order, {
          defaultShippingCompany: store.defaultShippingCompany || null,
          defaultSupplier: store.defaultSupplier || null
        });
        if (upserted.created) result.ordersCreated++; else result.ordersUpdated++;

        if (Array.isArray(order.line_items)) {
          await persistLineItems(store.userId, storeId, upserted.orderId, order.line_items);
        }

        // After line items are persisted, recompute snapshots using the Pricebook
        // for (country, supplier). Falls back gracefully when no pricebook found.
        await recomputeOrderCostSnapshots(store.userId, storeId, upserted.orderId);

        if (pullTransactions) {
          // Shopify REST limits non-Plus stores to 2 calls/sec. Sleep between
          // /transactions.json calls so the bucket doesn't fill — the fetcher
          // also retries on 429 with backoff as a safety net.
          await sleep(THROTTLE_MS);
          const txs = await fetchOrderTransactions(store.storeDomain, decryptToken(store.accessToken), order.id);
          const txCount = await persistTransactions(store.userId, storeId, upserted.orderId, txs);
          result.transactionsSynced += txCount;

          // Recompute Order.paymentFee from the DB (not from this payload) —
          // /orders/transactions returns fee=0 until settlement, but a prior
          // Balance Transactions sync may have stored the real fee already.
          const summary = summarizeTransactionFees(txs);
          // Refund fees come back to the merchant, so they reduce the total —
          // the same rule syncBalanceTransactions and P&L apply.
          const [charges, refunds] = await Promise.all([
            prisma.orderTransaction.aggregate({
              where: { orderId: upserted.orderId, status: 'success', kind: { in: ['sale', 'capture'] } },
              _sum: { fee: true }
            }),
            prisma.orderTransaction.aggregate({
              where: { orderId: upserted.orderId, status: 'success', kind: 'refund' },
              _sum: { fee: true }
            })
          ]);
          const netFee = Math.max(0, Number(charges._sum.fee || 0) - Number(refunds._sum.fee || 0));
          await prisma.order.update({
            where: { id: upserted.orderId },
            data: {
              paymentFee: new Prisma.Decimal(netFee.toFixed(2)),
              paymentGateway: summary.primaryGateway || (order.payment_gateway_names?.[0] ?? order.gateway ?? null)
            }
          });
        }
      } catch (e: any) {
        result.errors.push({ orderNumber: String(order.order_number ?? order.id), error: e?.message || String(e) });
      }
    }

    pageInfo = nextPage;
  } while (pageInfo);

  // Only advance the cursor once every page came back — a thrown page leaves
  // it untouched so the next run covers the same ground again.
  if (incremental) {
    await prisma.shopifyStore.update({ where: { id: storeId }, data: { ordersSyncedAt: startedAt } });
  }

  return result;
}

/**
 * Webhook path: ingest ONE order payload (orders/create|updated|cancelled|
 * fulfilled) for a store. Same upsert pipeline as the batch sync minus the
 * per-order transactions fetch — payment fees arrive later via the balance
 * sync / scheduler, and webhook handlers must stay fast (Shopify retries on
 * slow responses).
 */
export async function ingestOrderPayload(storeId: string, order: any): Promise<{ orderId: string; created: boolean }> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');
  const upserted = await upsertOrder(store.userId, storeId, order, {
    defaultShippingCompany: store.defaultShippingCompany || null,
    defaultSupplier: store.defaultSupplier || null
  });
  if (Array.isArray(order.line_items)) {
    await persistLineItems(store.userId, storeId, upserted.orderId, order.line_items);
  }
  await recomputeOrderCostSnapshots(store.userId, storeId, upserted.orderId);
  return upserted;
}

async function upsertOrder(
  userId: string,
  storeId: string,
  order: any,
  defaults: { defaultShippingCompany: string | null; defaultSupplier: string | null }
): Promise<{ orderId: string; created: boolean }> {
  const utm = extractUtmParameters(order);
  const totalRefunded = sumRefunds(order);

  // Resolve carrier (shipping company): tracking_company → tracking-prefix lookup
  // → auto-create from prefix → store default. Returns null if no fulfillment.
  const detectedCarrier = await resolveShippingCompanyForOrder(order);
  const shippingCompany = detectedCarrier || defaults.defaultShippingCompany;
  // Supplier is currently store-default only. Future: could be inferred from
  // line item vendor or product tag.
  const supplier = defaults.defaultSupplier;
  const shippingCountryCode: string | null = order.shipping_address?.country_code
    ?? order.billing_address?.country_code
    ?? null;

  // Full shipping address (JSON) + phone — needed to export orders for
  // fulfillment. shipping_address.phone is the delivery contact; fall back
  // to order.phone / customer default address.
  const addr = order.shipping_address ?? order.billing_address ?? null;
  const shippingAddress = addr ? {
    name: addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(' ') || null,
    address1: addr.address1 ?? null,
    address2: addr.address2 ?? null,
    city: addr.city ?? null,
    province: addr.province ?? null,
    provinceCode: addr.province_code ?? null,
    zip: addr.zip ?? null,
    country: addr.country ?? null,
    countryCode: addr.country_code ?? null,
    phone: addr.phone ?? null,
    company: addr.company ?? null
  } : null;
  const customerPhone: string | null =
    addr?.phone ?? order.phone ?? order.customer?.phone ?? order.customer?.default_address?.phone ?? null;

  // Tracking + carrier delivery status from fulfillments. Shopify is the
  // source of truth for the whole shipping lifecycle — the UI has no manual
  // status actions; everything derives from what the store reports.
  const fulfillments: any[] = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const trackingNumber: string | null =
    fulfillments.flatMap(f => f.tracking_numbers?.length ? f.tracking_numbers : [f.tracking_number]).find(Boolean) ?? null;
  // fulfillment.shipment_status: label_printed|label_purchased|attempted_delivery|
  // ready_for_pickup|confirmed|in_transit|out_for_delivery|delivered|failure
  const shipmentStatus: string | null =
    fulfillments.map(f => f.shipment_status).find(Boolean) ?? null;
  // Earliest fulfillment = when the parcel actually left.
  const shippedTimes = fulfillments
    .map(f => (f.created_at ? new Date(f.created_at).getTime() : NaN))
    .filter(t => Number.isFinite(t));
  const shippedFromShopify = shippedTimes.length ? new Date(Math.min(...shippedTimes)) : null;

  const data = {
    orderNumber: String(order.order_number ?? order.name ?? order.id),
    customerEmail: order.customer?.email ?? null,
    customerName: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ')
      || (addr?.name ?? null),
    totalAmount: parseFloat(order.total_price ?? '0'),
    currency: order.currency,
    presentmentCurrency: order.presentment_currency ?? null,
    status: order.financial_status ?? 'unknown',
    fulfillmentStatus: order.fulfillment_status ?? 'unfulfilled',
    subtotalPrice: order.subtotal_price ? new Prisma.Decimal(order.subtotal_price) : null,
    totalDiscounts: order.total_discounts ? new Prisma.Decimal(order.total_discounts) : new Prisma.Decimal(0),
    totalShipping: order.total_shipping_price_set?.shop_money?.amount
      ? new Prisma.Decimal(order.total_shipping_price_set.shop_money.amount)
      : new Prisma.Decimal(0),
    totalTax: order.total_tax ? new Prisma.Decimal(order.total_tax) : new Prisma.Decimal(0),
    totalRefunded: new Prisma.Decimal(totalRefunded),
    shopifyCreatedAt: order.created_at ? new Date(order.created_at) : null,
    processedAt: order.processed_at ? new Date(order.processed_at) : (order.created_at ? new Date(order.created_at) : null),
    cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : null,
    closedAt: order.closed_at ? new Date(order.closed_at) : null,
    paymentGateway: order.payment_gateway_names?.[0] ?? order.gateway ?? null,
    shippingCompany,
    shippingCountryCode,
    supplier,
    shippingAddress: shippingAddress as any,
    customerPhone,
    ...utm
  };

  const existing = await prisma.order.findUnique({
    where: { userId_storeId_shopifyOrderId: { userId, storeId, shopifyOrderId: String(order.id) } },
    select: { id: true, fulfillStatus: true, trackingNumber: true, deliveryStatus: true, shippedAt: true }
  });

  const effectiveTracking = trackingNumber ?? existing?.trackingNumber ?? null;
  const lifecycle = {
    // Shopify is authoritative: latest tracking from the store wins.
    trackingNumber: effectiveTracking,
    deliveryStatus: shipmentStatus ?? existing?.deliveryStatus ?? null,
    shippedAt: shippedFromShopify ?? existing?.shippedAt ?? null,
    fulfillStatus: fulfillStatusFromShopify(existing?.fulfillStatus ?? 'PENDING', order, effectiveTracking, shipmentStatus)
  };

  if (existing) {
    await prisma.order.update({
      where: { id: existing.id },
      data: { ...data, ...lifecycle }
    });
    return { orderId: existing.id, created: false };
  }

  const created = await prisma.order.create({
    data: {
      userId,
      storeId,
      shopifyOrderId: String(order.id),
      ...data,
      ...lifecycle
    }
  });
  return { orderId: created.id, created: true };
}

/**
 * Derive the internal lifecycle state purely from Shopify signals (there are
 * no manual status actions in the UI):
 *   - cancelled_at set                      → CANCELLED (always wins)
 *   - carrier says delivered               → DELIVERED
 *   - has tracking / marked fulfilled       → SHIPPED (unless already DELIVERED)
 *   - otherwise                             → PENDING (or whatever we had)
 * 17Track (if configured) can still upgrade SHIPPED → DELIVERED for carriers
 * Shopify has no shipment_status for.
 */
function fulfillStatusFromShopify(current: string, order: any, trackingNumber: string | null, shipmentStatus: string | null): string {
  if (order.cancelled_at) return 'CANCELLED';
  if (shipmentStatus === 'delivered') return 'DELIVERED';
  if (current === 'DELIVERED') return 'DELIVERED';
  if (trackingNumber || order.fulfillment_status === 'fulfilled') return 'SHIPPED';
  return current === 'SHIPPED' ? 'SHIPPED' : current;
}

async function persistTransactions(userId: string, storeId: string, orderId: string, txs: any[]): Promise<number> {
  let count = 0;
  for (const tx of txs) {
    const fee = parseFloat(tx.fee ?? '0') || 0;
    const amount = parseFloat(tx.amount ?? '0') || 0;
    // Shopify REST /orders/transactions returns fee=0 until the transaction is
    // settled into a payout — but the Balance Transactions API does have it.
    // Don't clobber a balance-derived fee with 0. Update fee/net only if this
    // payload actually carries a fee.
    const updateFeeFields: any = fee > 0
      ? { fee: new Prisma.Decimal(fee), net: new Prisma.Decimal(amount - fee) }
      : {};

    await prisma.orderTransaction.upsert({
      where: {
        orderId_shopifyTransactionId: { orderId, shopifyTransactionId: String(tx.id) }
      },
      create: {
        userId,
        storeId,
        orderId,
        shopifyTransactionId: String(tx.id),
        kind: tx.kind,
        status: tx.status,
        gateway: tx.gateway ?? null,
        amount: new Prisma.Decimal(amount),
        fee: new Prisma.Decimal(fee),
        net: new Prisma.Decimal(amount - fee),
        currency: tx.currency,
        presentmentCurrency: tx.presentment_currency ?? null,
        processedAt: tx.processed_at ? new Date(tx.processed_at) : null
      },
      update: {
        kind: tx.kind,
        status: tx.status,
        gateway: tx.gateway ?? null,
        amount: new Prisma.Decimal(amount),
        ...updateFeeFields,
        processedAt: tx.processed_at ? new Date(tx.processed_at) : null
      }
    });
    count++;
  }
  return count;
}

async function persistLineItems(userId: string, storeId: string, orderId: string, items: any[]): Promise<void> {
  // Auto-create ProductVariant rows for any variant_id we haven't seen yet —
  // baseCost defaults to 0, the user fills it in on the COGS page later. The
  // cost snapshot itself is computed in recomputeOrderCostSnapshots below.
  // NOTE: ProductVariant.variantId is a global PK, so we upsert by PK and
  // refresh the sku/title (cheap) but DO NOT touch baseCost — preserves any
  // cost the user has already entered.
  for (const it of items) {
    const variantId = typeof it.variant_id === 'number' ? BigInt(it.variant_id) : null;
    if (variantId !== null) {
      await prisma.productVariant.upsert({
        where: { variantId },
        create: {
          variantId,
          userId,
          storeId,
          sku: it.sku ?? null,
          title: it.title ?? '(unnamed)',
          productId: typeof it.product_id === 'number' ? BigInt(it.product_id) : BigInt(0),
          basecost: new Prisma.Decimal(0)
        },
        // DO NOT update sku/title from order line items — those carry the
        // historical SKU at order time, which would overwrite a current rename
        // done in Shopify. Use the Products API sync (scripts/sync-products.ts)
        // for the canonical sku/title. basecost is also preserved (user owns it).
        update: {}
      });
    }

    await prisma.orderLineItem.upsert({
      where: { orderId_shopifyLineItemId: { orderId, shopifyLineItemId: String(it.id) } },
      create: {
        orderId,
        shopifyLineItemId: String(it.id),
        variantId,
        productId: typeof it.product_id === 'number' ? BigInt(it.product_id) : null,
        sku: it.sku ?? null,
        title: it.title ?? null,
        variantTitle: it.variant_title ?? null,
        quantity: it.quantity ?? 0,
        price: new Prisma.Decimal(it.price ?? '0'),
        totalDiscount: new Prisma.Decimal(it.total_discount ?? '0'),
        unitBasecost: null
      },
      update: {
        sku: it.sku ?? null,
        title: it.title ?? null,
        variantTitle: it.variant_title ?? null,
        quantity: it.quantity ?? 0,
        price: new Prisma.Decimal(it.price ?? '0'),
        totalDiscount: new Prisma.Decimal(it.total_discount ?? '0')
        // unitBasecost updated in recomputeOrderCostSnapshots
      }
    });
  }
}

/** Normalize a country code for matrix matching (Shopify says GB, sheets often say UK). */
function normCountry(c: string | null | undefined): string {
  const cc = String(c || '').trim().toUpperCase();
  return cc === 'UK' ? 'GB' : cc;
}

/**
 * Pick the COGS-matrix line for an order. Cascade (most → least specific):
 *   1. supplier + carrier + country all match
 *   2. carrier + country match (any supplier)
 *   3. country matches and the line's carrier is a generic bucket (Default/Other)
 *   4. country matches (first by sortOrder)
 * Carrier comparison is case-insensitive exact.
 */
function pickCogsLine(
  lines: Array<{ id: string; supplier: string; carrier: string; countryCode: string; sortOrder: number }>,
  order: { supplier: string | null; shippingCompany: string | null; shippingCountryCode: string | null }
) {
  const country = normCountry(order.shippingCountryCode);
  if (!country) return null;
  const inCountry = lines
    .filter(l => normCountry(l.countryCode) === country)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (inCountry.length === 0) return null;

  const carrier = String(order.shippingCompany || '').trim().toUpperCase();
  const supplier = String(order.supplier || '').trim().toUpperCase();
  const carrierEq = (l: { carrier: string }) => l.carrier.trim().toUpperCase() === carrier;

  if (carrier && supplier) {
    const hit = inCountry.find(l => carrierEq(l) && l.supplier.trim().toUpperCase() === supplier);
    if (hit) return hit;
  }
  if (carrier) {
    const hit = inCountry.find(carrierEq);
    if (hit) return hit;
  }
  const generic = inCountry.find(l => ['DEFAULT', 'OTHER'].includes(l.carrier.trim().toUpperCase()));
  return generic ?? inCountry[0];
}

/**
 * Snapshot per-unit landed cost onto each OrderLineItem (frozen so historical
 * basecost doesn't drift when prices are edited later). The product / shipping
 * split is frozen alongside the total: it is what the supplier gets paid.
 *
 * Cost source, in order:
 *   0. Combo (CogsCombo): the basket exactly matches a combo priced on the
 *      order's ship line → combo cost split across items by weight.
 *   1. COGS matrix (CogsLine × CogsPrice): pick the order's ship line via
 *      pickCogsLine, then per line item with quantity q:
 *        exact set price (setQty=q)            → unit = cost/q
 *        else single price (setQty=1) × q      → unit = cost(set 1)
 *   2. Fallback: ProductVariant.basecost (legacy flat per-unit cost) — keeps
 *      P&L working for stores that haven't filled the matrix. It has no split,
 *      so it is frozen as all-product, zero-shipping.
 *
 * Orders already covered by a SupplierSettlement are never re-costed: their
 * figures are what was paid, and changing them afterwards would make the books
 * disagree with the payment.
 *
 * Idempotent: safe to call multiple times for the same order.
 */
export async function recomputeOrderCostSnapshots(_userId: string, storeId: string, orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      supplier: true,
      shippingCompany: true,
      shippingCountryCode: true,
      supplierSettlementId: true,
      lineItems: { select: { id: true, variantId: true, quantity: true } }
    }
  });
  if (!order || !order.lineItems.length) return;
  if (order.supplierSettlementId) return;

  // ProductVariant.variantId is a global @id, so we look up by PK without
  // tenant scoping — variant ownership was already enforced at sync time.
  const variantIds = order.lineItems.map(li => li.variantId).filter((v): v is bigint => v !== null);
  if (variantIds.length === 0) return;

  const [variants, lines] = await Promise.all([
    prisma.productVariant.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, basecost: true }
    }),
    prisma.cogsLine.findMany({
      where: { storeId },
      select: { id: true, supplier: true, carrier: true, countryCode: true, sortOrder: true }
    })
  ]);
  const basecostMap = new Map(variants.map(v => [v.variantId.toString(), Number(v.basecost)]));

  type Split = { total: number; product: number; shipping: number };
  const line = pickCogsLine(lines, order);
  const priceMap = new Map<string, Split>();
  if (line) {
    const prices = await prisma.cogsPrice.findMany({
      where: { lineId: line.id, variantId: { in: variantIds } },
      select: { variantId: true, setQty: true, cost: true, productCost: true, shippingCost: true }
    });
    for (const pr of prices) {
      priceMap.set(`${pr.variantId}:${pr.setQty}`, {
        total: Number(pr.cost), product: Number(pr.productCost), shipping: Number(pr.shippingCost)
      });
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const write = (id: string, unit: Split) =>
    prisma.orderLineItem.update({
      where: { id },
      data: {
        unitBasecost: new Prisma.Decimal(round2(unit.total).toFixed(2)),
        unitProductCost: new Prisma.Decimal(round2(unit.product).toFixed(2)),
        unitShippingCost: new Prisma.Decimal(round2(unit.shipping).toFixed(2))
      }
    });

  // Combo first: when the whole basket is exactly a priced combo on this ship
  // line, its cost wins over per-item prices — buying these products together
  // is the reason the combo price exists.
  if (line) {
    const signature = orderSignature(order.lineItems);
    const combo = signature
      ? await prisma.cogsCombo.findUnique({
          where: { storeId_signature: { storeId, signature } },
          select: { prices: { where: { lineId: line.id }, select: { cost: true, productCost: true, shippingCost: true } } }
        })
      : null;
    const comboPrice = combo?.prices[0];
    if (comboPrice) {
      const total = Number(comboPrice.cost);
      // Each item keeps the combo's own goods/freight ratio.
      const productShare = total > 0 ? Number(comboPrice.productCost) / total : 1;
      const units = allocateComboCost(
        total,
        order.lineItems.map(li => {
          const single = priceMap.get(`${li.variantId}:1`)?.total ?? basecostMap.get(String(li.variantId));
          return { key: li.id, qty: li.quantity > 0 ? li.quantity : 1, singleUnitPrice: single };
        })
      );
      for (const li of order.lineItems) {
        const unit = units.get(li.id);
        if (unit === undefined) continue;
        const product = round2(unit * productShare);
        await write(li.id, { total: unit, product, shipping: round2(unit - product) });
      }
      return;
    }
  }

  for (const li of order.lineItems) {
    if (li.variantId === null) continue;
    const qty = li.quantity > 0 ? li.quantity : 1;
    const vid = li.variantId.toString();

    let unit: Split | undefined;
    const exactSet = priceMap.get(`${vid}:${qty}`);
    const single = priceMap.get(`${vid}:1`);
    if (exactSet !== undefined) {
      unit = { total: exactSet.total / qty, product: exactSet.product / qty, shipping: exactSet.shipping / qty };
    } else if (single !== undefined) {
      unit = single;
    } else if (basecostMap.has(vid)) {
      const b = basecostMap.get(vid)!;
      // Basecost 0 means "never priced" (variants are auto-created at 0) —
      // leave the line uncosted so it shows as missing, not as a free item.
      if (b > 0) unit = { total: b, product: b, shipping: 0 };
    }

    if (unit !== undefined) await write(li.id, unit);
  }
}

function sumRefunds(order: any): number {
  if (!order.refunds) return 0;
  let total = 0;
  for (const refund of order.refunds) {
    for (const tx of (refund.transactions || [])) {
      if (tx.kind === 'refund') total += parseFloat(tx.amount || '0');
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Pull Shopify Payments balance transactions for a window and store their
 * fees on the matching orders.
 *
 * This is the ONLY source of per-order payment fees: Shopify's REST
 * Transaction resource has no fee field at all, so /orders/{id}/transactions
 * always yields fee = 0. The balance ledger does carry fee/net, but needs the
 * read_shopify_payments_payouts scope and a store on Shopify Payments.
 *
 * Failures are recorded on the store (feeSyncError) rather than swallowed, so
 * the UI can tell "fees are 0 because the app lacks permission" apart from
 * "this order genuinely had no fee".
 *
 * Matching: a balance row points at the order transaction it came from. When
 * that transaction was never pulled (webhook-ingested orders skip it), the row
 * is stored as a transaction itself, keyed by the same Shopify id, so a later
 * transaction pull updates it instead of duplicating it — and P&L, which sums
 * OrderTransaction fees, agrees with the per-order fee column.
 */
export async function syncBalanceTransactions(
  storeId: string,
  since: Date,
  until: Date
): Promise<{ updated: number; created: number; balanceRows: number; errors: string[] }> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');

  let balances: Awaited<ReturnType<typeof fetchBalanceTransactions>>;
  try {
    balances = await fetchBalanceTransactions(store.storeDomain, decryptToken(store.accessToken), since, until);
  } catch (e: any) {
    const msg = e?.message || String(e);
    const reason = /\b(401|403)\b/.test(msg)
      ? 'missing_scope: the Shopify app is not allowed to read Shopify Payments payouts (read_shopify_payments_payouts). Add the scope and reconnect the store.'
      : /\b404\b/.test(msg)
        ? 'not_shopify_payments: this store does not use Shopify Payments, so Shopify exposes no processing fees.'
        : `error: ${msg.slice(0, 300)}`;
    await prisma.shopifyStore.update({ where: { id: storeId }, data: { feeSyncError: reason, feeSyncAt: new Date() } });
    console.warn(`[fees] ${store.storeDomain}: ${reason}`);
    return { updated: 0, created: 0, balanceRows: 0, errors: [reason] };
  }

  let updated = 0, created = 0;
  const affectedOrderIds = new Set<string>();
  const orderIdByShopifyId = new Map<string, string | null>();

  for (const b of balances) {
    if (!b.source_order_transaction_id || !b.source_order_id) continue;
    // Sign lives in `kind` (P&L subtracts refund fees), so store magnitudes.
    const fee = Math.abs(parseFloat(b.fee || '0') || 0);
    const amount = Math.abs(parseFloat(b.amount || '0') || 0);
    const txId = String(b.source_order_transaction_id);

    const matched = await prisma.orderTransaction.findMany({
      where: { storeId, shopifyTransactionId: txId },
      select: { id: true, orderId: true }
    });
    if (matched.length) {
      for (const m of matched) {
        await prisma.orderTransaction.update({
          where: { id: m.id },
          data: { fee: new Prisma.Decimal(fee), net: new Prisma.Decimal(amount - fee) }
        });
        affectedOrderIds.add(m.orderId);
        updated++;
      }
      continue;
    }

    const shopifyOrderId = String(b.source_order_id);
    if (!orderIdByShopifyId.has(shopifyOrderId)) {
      const o = await prisma.order.findFirst({ where: { storeId, shopifyOrderId }, select: { id: true } });
      orderIdByShopifyId.set(shopifyOrderId, o?.id ?? null);
    }
    const orderId = orderIdByShopifyId.get(shopifyOrderId);
    if (!orderId) continue; // order not synced yet — a later run picks it up

    const isRefund = /refund/i.test(b.type || '') || parseFloat(b.amount || '0') < 0;
    await prisma.orderTransaction.upsert({
      where: { orderId_shopifyTransactionId: { orderId, shopifyTransactionId: txId } },
      create: {
        userId: store.userId,
        storeId,
        orderId,
        shopifyTransactionId: txId,
        kind: isRefund ? 'refund' : 'sale',
        status: 'success',
        gateway: 'shopify_payments',
        amount: new Prisma.Decimal(amount),
        fee: new Prisma.Decimal(fee),
        net: new Prisma.Decimal(amount - fee),
        currency: b.currency,
        processedAt: b.processed_at ? new Date(b.processed_at) : null
      },
      update: { fee: new Prisma.Decimal(fee), net: new Prisma.Decimal(amount - fee) }
    });
    affectedOrderIds.add(orderId);
    created++;
  }

  for (const orderId of affectedOrderIds) {
    const [charges, refunds] = await Promise.all([
      prisma.orderTransaction.aggregate({
        where: { orderId, status: 'success', kind: { in: ['sale', 'capture'] } },
        _sum: { fee: true }
      }),
      prisma.orderTransaction.aggregate({
        where: { orderId, status: 'success', kind: 'refund' },
        _sum: { fee: true }
      })
    ]);
    const net = Number(charges._sum.fee || 0) - Number(refunds._sum.fee || 0);
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentFee: new Prisma.Decimal(Math.max(0, net).toFixed(2)), paymentGateway: 'shopify_payments' }
    });
  }

  await prisma.shopifyStore.update({ where: { id: storeId }, data: { feeSyncError: null, feeSyncAt: new Date() } });
  return { updated, created, balanceRows: balances.length, errors: [] };
}

function extractUtmParameters(order: any) {
  const utmParams: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    fbclid?: string;
  } = {};

  const noteAttributes = order.note_attributes || [];
  for (const attr of noteAttributes) {
    switch ((attr.name || '').toLowerCase()) {
      case 'utm_source': utmParams.utmSource = attr.value; break;
      case 'utm_medium': utmParams.utmMedium = attr.value; break;
      case 'utm_campaign': utmParams.utmCampaign = attr.value; break;
      case 'utm_content': utmParams.utmContent = attr.value; break;
      case 'fbclid': utmParams.fbclid = attr.value; break;
    }
  }

  const tags = (order.tags || '').split(',').map((tag: string) => tag.trim());
  for (const tag of tags) {
    if (tag.toLowerCase().startsWith('utm_source:')) utmParams.utmSource = tag.split(':').slice(1).join(':');
    else if (tag.toLowerCase().startsWith('utm_medium:')) utmParams.utmMedium = tag.split(':').slice(1).join(':');
    else if (tag.toLowerCase().startsWith('utm_campaign:')) utmParams.utmCampaign = tag.split(':').slice(1).join(':');
    else if (tag.toLowerCase().startsWith('utm_content:')) utmParams.utmContent = tag.split(':').slice(1).join(':');
    else if (tag.toLowerCase().startsWith('fbclid:')) utmParams.fbclid = tag.split(':').slice(1).join(':');
  }

  return utmParams;
}
