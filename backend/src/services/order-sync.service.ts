import { PrismaClient, Prisma } from '@prisma/client';
import { fetchShopifyOrders, fetchOrderTransactions, summarizeTransactionFees, fetchBalanceTransactions } from './shopify.service';
import { resolveShippingCompanyForOrder } from './shipping-company.service';

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

  // Determine the lower bound. If the caller didn't pass `since`, use the last
  // synced order's date — this is the incremental cron path. When the caller
  // passes `since` explicitly (e.g. from the UI date range), respect it so
  // existing orders within that range get re-synced (so we can pick up refunds
  // and updated transactions).
  let since = options.since;
  if (since === undefined) {
    const lastOrder = await prisma.order.findFirst({
      where: { storeId },
      orderBy: { shopifyCreatedAt: 'desc' }
    });
    since = lastOrder?.shopifyCreatedAt ?? lastOrder?.createdAt ?? undefined;
  }

  const result: SyncResult = { ordersCreated: 0, ordersUpdated: 0, transactionsSynced: 0, errors: [] };
  const pullTransactions = options.pullTransactions !== false;

  let pageInfo: string | undefined;
  do {
    const { orders, pageInfo: nextPage } = await fetchShopifyOrders(
      store.storeDomain,
      store.accessToken,
      {
        createdAtMin: since?.toISOString(),
        createdAtMax: options.until?.toISOString(),
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
          const txs = await fetchOrderTransactions(store.storeDomain, store.accessToken, order.id);
          const txCount = await persistTransactions(store.userId, storeId, upserted.orderId, txs);
          result.transactionsSynced += txCount;

          // Recompute Order.paymentFee from the DB (not from this payload) —
          // /orders/transactions returns fee=0 until settlement, but a prior
          // Balance Transactions sync may have stored the real fee already.
          const summary = summarizeTransactionFees(txs);
          const aggregate = await prisma.orderTransaction.aggregate({
            where: {
              orderId: upserted.orderId,
              status: 'success',
              kind: { in: ['sale', 'capture', 'refund'] }
            },
            _sum: { fee: true }
          });
          await prisma.order.update({
            where: { id: upserted.orderId },
            data: {
              paymentFee: new Prisma.Decimal(aggregate._sum.fee || 0),
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

  return result;
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

  const data = {
    orderNumber: String(order.order_number ?? order.name ?? order.id),
    customerEmail: order.customer?.email ?? null,
    customerName: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || null,
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
    ...utm
  };

  const existing = await prisma.order.findUnique({
    where: { userId_storeId_shopifyOrderId: { userId, storeId, shopifyOrderId: String(order.id) } },
    select: { id: true }
  });

  if (existing) {
    await prisma.order.update({ where: { id: existing.id }, data });
    return { orderId: existing.id, created: false };
  }

  const created = await prisma.order.create({
    data: {
      userId,
      storeId,
      shopifyOrderId: String(order.id),
      ...data
    }
  });
  return { orderId: created.id, created: true };
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
        quantity: it.quantity ?? 0,
        price: new Prisma.Decimal(it.price ?? '0'),
        totalDiscount: new Prisma.Decimal(it.total_discount ?? '0'),
        unitBasecost: null
      },
      update: {
        sku: it.sku ?? null,
        title: it.title ?? null,
        quantity: it.quantity ?? 0,
        price: new Prisma.Decimal(it.price ?? '0'),
        totalDiscount: new Prisma.Decimal(it.total_discount ?? '0')
        // unitBasecost updated in recomputeOrderCostSnapshots
      }
    });
  }
}

/**
 * Snapshot per-unit landed cost (basecost = product + supplier shipping)
 * onto each OrderLineItem. Reads ProductVariant.basecost — the single source
 * of truth — and freezes it on the line item so historical Basecost doesn't
 * drift if the variant's basecost is later edited.
 *
 * Idempotent: safe to call multiple times for the same order.
 */
export async function recomputeOrderCostSnapshots(_userId: string, _storeId: string, orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { lineItems: { select: { id: true, variantId: true } } }
  });
  if (!order || !order.lineItems.length) return;

  // ProductVariant.variantId is a global @id, so we look up by PK without
  // tenant scoping — variant ownership was already enforced at sync time.
  const variantIds = order.lineItems.map(li => li.variantId).filter((v): v is bigint => v !== null);
  if (variantIds.length === 0) return;

  const variants = await prisma.productVariant.findMany({
    where: { variantId: { in: variantIds } },
    select: { variantId: true, basecost: true }
  });
  const basecostMap = new Map(variants.map(v => [v.variantId.toString(), v.basecost]));

  for (const li of order.lineItems) {
    if (li.variantId === null) continue;
    const basecost = basecostMap.get(li.variantId.toString());
    if (basecost !== undefined) {
      await prisma.orderLineItem.update({
        where: { id: li.id },
        data: { unitBasecost: basecost }
      });
    }
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
 * After orders + their transactions have been synced, pull Shopify Payments
 * balance transactions for the same window and update OrderTransaction rows
 * with authoritative fee/net values (REST /orders/transactions returns fee=0
 * until the transaction is settled into a payout).
 *
 * Returns the number of OrderTransaction rows updated.
 */
export async function syncBalanceTransactions(
  storeId: string,
  since: Date,
  until: Date
): Promise<{ updated: number; balanceRows: number; errors: string[] }> {
  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');

  let balances;
  try {
    balances = await fetchBalanceTransactions(store.storeDomain, store.accessToken, since, until);
  } catch (e: any) {
    // Endpoint returns 404/403 if the store does not use Shopify Payments — that's fine, just no-op.
    return { updated: 0, balanceRows: 0, errors: [e?.message || String(e)] };
  }

  let updated = 0;
  const orderTxIdsAffected = new Set<string>();
  for (const b of balances) {
    if (!b.source_order_transaction_id) continue;
    const fee = parseFloat(b.fee || '0') || 0;
    const amount = parseFloat(b.amount || '0') || 0;
    const net = parseFloat(b.net || (amount - fee).toString()) || (amount - fee);

    // Match by shopifyTransactionId. Multiple OrderTransaction rows could have
    // the same shopifyTransactionId across different stores, so scope by storeId.
    const matched = await prisma.orderTransaction.findMany({
      where: { storeId, shopifyTransactionId: String(b.source_order_transaction_id) },
      select: { id: true }
    });
    for (const m of matched) {
      await prisma.orderTransaction.update({
        where: { id: m.id },
        data: {
          fee: new Prisma.Decimal(fee),
          net: new Prisma.Decimal(net)
        }
      });
      orderTxIdsAffected.add(m.id);
      updated++;
    }
  }

  // Recompute Order.paymentFee aggregate after fee backfill.
  const orderIdsToRecompute = await prisma.orderTransaction.findMany({
    where: { id: { in: Array.from(orderTxIdsAffected) } },
    select: { orderId: true },
    distinct: ['orderId']
  });
  for (const { orderId } of orderIdsToRecompute) {
    const aggregate = await prisma.orderTransaction.aggregate({
      where: { orderId, status: 'success', kind: { in: ['sale', 'capture', 'refund'] } },
      _sum: { fee: true }
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentFee: new Prisma.Decimal(aggregate._sum.fee || 0) }
    });
  }

  return { updated, balanceRows: balances.length, errors: [] };
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
