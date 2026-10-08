/**
 * DB-backed order management (fulfillment workflow) — mounted at /api/orders.
 *
 * The DB is the source of truth (webhooks + scheduler keep it fresh); this
 * replaces reading the live Shopify proxy for the fulfillment screens.
 *
 *   GET    /                 list w/ filters + tab counts (paginated)
 *   POST   /sync             pull orders from Shopify (optional backfill `since`) + fees
 *   GET    /sync-status      last order sync, last fee sync and why fees may be missing
 *   POST   /cost-summary     what is owed to the supplier for a selection
 *   POST   /supplier-statement  CSV of that selection for the supplier
 *   GET    /export           CSV export (same filters) — customer + address + items
 *   GET    /:id              detail incl. line items
 *   PATCH  /:id/status       lifecycle transition (state machine enforced)
 *   PATCH  /:id/tracking     set tracking (+ push fulfillment to Shopify, auto-SHIPPED)
 *
 * Identity: requireAuth (JWT) + resolveStore (X-Shopify-Store-Domain header
 * picks which of the user's stores).
 */
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore } from '../middleware/resolve-store';
import { requireStoreCapability } from '../middleware/resolve-store';
import { canTransition, isFulfillStatus, ORDER_FULFILL_TRANSITIONS } from '../lib/order-lifecycle';
import {
  EXPORT_FIELDS, EXPORT_FIELD_MAP, DEFAULT_EXPORT_COLUMNS,
  sanitizeColumns, serializeRows, type ExportDelimiter
} from '../lib/order-export-fields';
import { decryptToken } from '../lib/token-crypto';
import { updateOrderTracking } from '../services/shopify.service';
import { syncOrders, syncBalanceTransactions } from '../services/order-sync.service';
import { audit } from '../lib/audit';
import {
  stuckWhere, issuesWhere, issueReasons, daysSinceShipped, parseStuckDays
} from '../lib/fulfillment-views';
import {
  orderCost, summarize, statementRows, STATEMENT_HEADER, type CostOrder
} from '../lib/supplier-cost';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireActive, resolveStore);

type View = 'STUCK' | 'ISSUES';
type Settlement = 'unsettled' | 'settled';

interface ListFilters {
  storeId: string;
  q?: string;
  fulfillStatus?: string;
  paymentStatus?: string;
  from?: Date;
  to?: Date;
  view?: View;
  stuckDays: number;
  settlement?: Settlement;
}

/**
 * Filters compose with AND so a view's own OR (STUCK, ISSUES) can never clobber
 * the search box's OR — spreading them into one object would silently drop
 * one of the two.
 */
function buildWhere(f: ListFilters, now = new Date()): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.fulfillStatus) and.push({ fulfillStatus: f.fulfillStatus });
  if (f.paymentStatus === 'unpaid') and.push({ status: { notIn: ['paid', 'refunded', 'partially_refunded'] } });
  else if (f.paymentStatus) and.push({ status: f.paymentStatus });

  if (f.view === 'STUCK') and.push(stuckWhere(now, f.stuckDays));
  else if (f.view === 'ISSUES') and.push(issuesWhere(now));
  // STUCK / ISSUES describe current state — an order shipped a month ago is
  // exactly what they exist for — so the date range only narrows the others.
  else if (f.from || f.to) {
    and.push({ processedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  }

  if (f.settlement === 'unsettled') and.push({ supplierSettlementId: null });
  else if (f.settlement === 'settled') and.push({ supplierSettlementId: { not: null } });

  if (f.q) {
    and.push({
      OR: [
        { orderNumber: { contains: f.q, mode: 'insensitive' } },
        { customerName: { contains: f.q, mode: 'insensitive' } },
        { customerEmail: { contains: f.q, mode: 'insensitive' } },
        { customerPhone: { contains: f.q, mode: 'insensitive' } },
        { trackingNumber: { contains: f.q, mode: 'insensitive' } }
      ]
    });
  }
  return and.length ? { storeId: f.storeId, AND: and } : { storeId: f.storeId };
}

const validDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

function parseFilters(src: Record<string, any>, storeId: string): ListFilters {
  const view = String(src.view || '').trim().toUpperCase();
  const settlement = String(src.settlement || '').trim().toLowerCase();
  return {
    storeId,
    q: String(src.q || '').trim() || undefined,
    fulfillStatus: String(src.fulfillStatus || '').trim().toUpperCase() || undefined,
    paymentStatus: String(src.paymentStatus || '').trim() || undefined,
    from: validDate(src.from),
    to: validDate(src.to),
    view: view === 'STUCK' || view === 'ISSUES' ? view : undefined,
    stuckDays: parseStuckDays(src.stuckDays),
    settlement: settlement === 'unsettled' || settlement === 'settled' ? settlement : undefined
  };
}

const COST_LINE_SELECT = {
  id: true, title: true, sku: true, variantTitle: true, quantity: true, price: true,
  variantId: true, unitBasecost: true, unitProductCost: true, unitShippingCost: true
} as const;

router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query, req.resolved!.storeId);
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const now = new Date();

    const where = buildWhere(filters, now);
    // Status tabs follow the date / search / settlement filters; the two
    // attention views count across all dates, like the views themselves.
    const tabBase = { ...filters, fulfillStatus: undefined, paymentStatus: undefined, view: undefined };
    const [orders, total, statusCounts, unpaidCount, stuckCount, issuesCount] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: filters.view === 'STUCK' ? [{ shippedAt: 'asc' }, { processedAt: 'asc' }] : { processedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          lineItems: { select: COST_LINE_SELECT },
          supplierSettlement: { select: { id: true, paidAt: true, reference: true, status: true } }
        }
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({ by: ['fulfillStatus'], where: buildWhere(tabBase, now), _count: { _all: true } }),
      prisma.order.count({ where: buildWhere({ ...tabBase, paymentStatus: 'unpaid' }, now) }),
      prisma.order.count({ where: buildWhere({ ...tabBase, from: undefined, to: undefined, view: 'STUCK' }, now) }),
      prisma.order.count({ where: buildWhere({ ...tabBase, from: undefined, to: undefined, view: 'ISSUES' }, now) })
    ]);

    const tabs: Record<string, number> = { ALL: 0, UNPAID: unpaidCount, STUCK: stuckCount, ISSUES: issuesCount };
    for (const row of statusCounts) {
      tabs[row.fulfillStatus] = row._count._all;
      tabs.ALL += row._count._all;
    }

    res.json({
      orders: orders.map(o => {
        const shipped = daysSinceShipped(o, now);
        return {
          ...o,
          // BigInt is not JSON-serializable; the client only needs a flag.
          lineItems: o.lineItems.map(({ variantId, ...li }) => ({ ...li, hasVariant: variantId !== null })),
          supplierCost: orderCost(o),
          issues: issueReasons(o, now),
          daysSinceShipped: o.fulfillStatus === 'SHIPPED' || o.fulfillStatus === 'DELIVERED' ? shipped.days : null,
          shippedAtEstimated: shipped.estimated
        };
      }),
      total, limit, offset, tabs, stuckDays: filters.stuckDays
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list orders' });
  }
});

// ── Sync ────────────────────────────────────────────────────────────────────

/**
 * Pull orders now. Without `since` this is the incremental sync (orders
 * updated since the last run). With `since` it re-pulls every order created
 * after that date — the way to fill a gap. Fees for the same window follow.
 *
 * Replaces POST /api/shopify/stores/:id/sync for this page: that route only
 * accepted the store's owner, so a granted manager got a 404.
 */
router.post('/sync', requireStoreCapability('sync'), async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    const since = validDate(req.body?.since);
    if (since && since.getTime() < Date.now() - 400 * 86_400_000) {
      return res.status(400).json({ error: 'Backfill is limited to the last 400 days' });
    }
    const orders = await syncOrders(storeId, since ? { since, pullTransactions: false } : { pullTransactions: false });
    const feeFrom = since ?? new Date(Date.now() - 14 * 86_400_000);
    const fees = await syncBalanceTransactions(storeId, feeFrom, new Date());
    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.resolved!.actorId,
      action: since ? 'orders.backfilled' : 'orders.synced',
      target: req.resolved!.storeDomain,
      metadata: { since: since?.toISOString() ?? null, created: orders.ordersCreated, updated: orders.ordersUpdated }
    });
    res.json({ orders, fees });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Sync failed' });
  }
});

router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const store = await prisma.shopifyStore.findUnique({
      where: { id: req.resolved!.storeId },
      select: { ordersSyncedAt: true, feeSyncAt: true, feeSyncError: true }
    });
    const [orderCount, firstOrder] = await Promise.all([
      prisma.order.count({ where: { storeId: req.resolved!.storeId } }),
      prisma.order.findFirst({
        where: { storeId: req.resolved!.storeId },
        orderBy: { processedAt: 'asc' },
        select: { processedAt: true }
      })
    ]);
    res.json({ ...store, orderCount, firstOrderAt: firstOrder?.processedAt ?? null });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load sync status' });
  }
});

// ── Supplier cost ───────────────────────────────────────────────────────────

const MAX_SELECTION = 5000;

/**
 * The orders a selection refers to: explicit `ids`, or every order matching
 * `filters` (the "select all N matching" case, across pages).
 */
async function loadSelection(storeId: string, body: any) {
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, MAX_SELECTION + 1) : [];
  const where: Prisma.OrderWhereInput = ids.length
    ? { storeId, id: { in: ids } }
    : buildWhere(parseFilters(body?.filters || {}, storeId));
  if (!ids.length && !body?.filters) throw Object.assign(new Error('Pass ids or filters'), { status: 400 });

  const count = await prisma.order.count({ where });
  if (count > MAX_SELECTION) {
    throw Object.assign(new Error(`Selection too large (${count} orders) — narrow the date range, max ${MAX_SELECTION}`), { status: 400 });
  }
  return prisma.order.findMany({
    where,
    orderBy: { processedAt: 'asc' },
    select: {
      id: true, orderNumber: true, supplier: true, shippingCompany: true, shippingCountryCode: true,
      fulfillStatus: true, supplierSettlementId: true, processedAt: true, shippedAt: true, trackingNumber: true,
      lineItems: { select: COST_LINE_SELECT }
    }
  });
}

router.post('/cost-summary', async (req: Request, res: Response) => {
  try {
    const orders = await loadSelection(req.resolved!.storeId, req.body);
    const summary = summarize(orders as unknown as CostOrder[]);
    const currency = (await prisma.cogsLine.findFirst({
      where: { storeId: req.resolved!.storeId }, orderBy: { sortOrder: 'asc' }, select: { currency: true }
    }))?.currency ?? 'USD';
    res.json({ ...summary, currency, selected: orders.length });
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to summarize' });
  }
});

router.post('/supplier-statement', async (req: Request, res: Response) => {
  try {
    const orders = await loadSelection(req.resolved!.storeId, req.body);
    const rows = [STATEMENT_HEADER, ...statementRows(orders as any)];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="supplier-statement-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + serializeRows(rows, 'comma'));
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to build statement' });
  }
});

/** Field catalog for the export column picker (single source of truth). */
router.get('/export-fields', (_req: Request, res: Response) => {
  res.json({
    fields: EXPORT_FIELDS.map(f => ({ key: f.key, label: f.label })),
    defaultColumns: DEFAULT_EXPORT_COLUMNS
  });
});

/** Saved column presets — store-scoped so the whole team shares them. */
router.get('/export-presets', async (req: Request, res: Response) => {
  try {
    const presets = await prisma.orderExportPreset.findMany({
      where: { storeId: req.resolved!.storeId },
      orderBy: { name: 'asc' }
    });
    res.json({ presets });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list presets' });
  }
});

/** Create-or-overwrite a preset by name (upsert on the (store, name) key). */
router.post('/export-presets', requireStoreCapability('fulfill'), async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    const columns = sanitizeColumns(req.body?.columns);
    const delimiter = req.body?.delimiter === 'tab' ? 'tab' : 'comma';
    const includeHeader = req.body?.includeHeader !== false;
    if (!name) return res.status(400).json({ error: 'Tên preset không được để trống' });
    if (columns.length === 0) return res.status(400).json({ error: 'Chọn ít nhất 1 cột' });

    const preset = await prisma.orderExportPreset.upsert({
      where: { storeId_name: { storeId: req.resolved!.storeId, name } },
      create: { userId: req.resolved!.userId, storeId: req.resolved!.storeId, name, columns, delimiter, includeHeader },
      update: { columns, delimiter, includeHeader }
    });
    res.json({ preset });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to save preset' });
  }
});

/** Delete a preset (scoped to the caller's store). */
router.delete('/export-presets/:id', requireStoreCapability('fulfill'), async (req: Request, res: Response) => {
  try {
    await prisma.orderExportPreset.deleteMany({
      where: { id: req.params.id, storeId: req.resolved!.storeId }
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete preset' });
  }
});

/**
 * CSV/text export for fulfillment. One row per order line item (an order with
 * N items => N rows; a single item with quantity 2 stays one row).
 *
 * Query params:
 *   columns   comma-separated field keys (see order-export-fields.ts). Unknown
 *             keys are dropped; empty/absent falls back to the legacy layout.
 *   format    'csv' (comma, default) | 'tsv'/'tab' (tab — paste into a sheet).
 *   header    'false' to omit the header row.
 *   ids       explicit order id list (overrides the list filters).
 * Plus the same list filters (q, fulfillStatus, paymentStatus, from, to).
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query, req.resolved!.storeId);
    const idsParam = String(req.query.ids || '').trim();
    const where = idsParam
      ? { storeId: filters.storeId, id: { in: idsParam.split(',').map(s => s.trim()).filter(Boolean) } }
      : buildWhere(filters);

    const requested = sanitizeColumns(String(req.query.columns || '').split(',').filter(Boolean));
    const columns = requested.length > 0 ? requested : DEFAULT_EXPORT_COLUMNS;
    const fmt = String(req.query.format || 'csv').toLowerCase();
    const delimiter: ExportDelimiter = fmt === 'tsv' || fmt === 'tab' ? 'tab' : 'comma';
    const includeHeader = String(req.query.header || '') !== 'false';

    const orders = await prisma.order.findMany({
      where,
      orderBy: { processedAt: 'asc' },
      take: 5000,
      include: {
        lineItems: { select: { title: true, sku: true, variantTitle: true, quantity: true, price: true } }
      }
    });

    const defs = columns.map(k => EXPORT_FIELD_MAP.get(k)!);
    const rows: string[][] = [];
    if (includeHeader) rows.push(defs.map(d => d.header));

    for (const o of orders) {
      const address = (o.shippingAddress as any) || {};
      const items = o.lineItems.length > 0 ? o.lineItems : [null];
      for (const lineItem of items) {
        rows.push(defs.map(d => String(d.get({ order: o, lineItem, address }) ?? '')));
      }
    }

    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.userId,
      action: 'orders.exported',
      target: req.resolved!.storeDomain,
      metadata: { count: orders.length, columns, delimiter }
    });

    const ext = delimiter === 'tab' ? 'txt' : 'csv';
    res.setHeader('Content-Type', delimiter === 'tab' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${req.resolved!.storeDomain}-${new Date().toISOString().slice(0, 10)}.${ext}"`);
    // BOM so Excel opens UTF-8 (Vietnamese names) correctly.
    res.send('﻿' + serializeRows(rows, delimiter));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Export failed' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, storeId: req.resolved!.storeId },
      include: {
        lineItems: {
          select: {
            id: true, shopifyLineItemId: true, sku: true, title: true,
            quantity: true, price: true, totalDiscount: true, unitBasecost: true
          }
        },
        transactions: {
          select: {
            id: true, kind: true, status: true, gateway: true,
            amount: true, fee: true, net: true, currency: true, processedAt: true
          }
        }
      }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order, allowedTransitions: ORDER_FULFILL_TRANSITIONS[order.fulfillStatus as keyof typeof ORDER_FULFILL_TRANSITIONS] ?? [] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load order' });
  }
});

router.patch('/:id/status', requireStoreCapability('fulfill'), async (req: Request, res: Response) => {
  try {
    const to = String(req.body?.status || '').trim().toUpperCase();
    if (!isFulfillStatus(to)) {
      return res.status(400).json({ error: `status must be one of PENDING, PROCESSING, SHIPPED, DELIVERED, CANCELLED` });
    }
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, storeId: req.resolved!.storeId }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.fulfillStatus === to) return res.json({ ok: true, fulfillStatus: to });
    if (!canTransition(order.fulfillStatus, to)) {
      return res.status(409).json({
        error: `Không thể chuyển ${order.fulfillStatus} → ${to}`,
        allowed: ORDER_FULFILL_TRANSITIONS[order.fulfillStatus as keyof typeof ORDER_FULFILL_TRANSITIONS] ?? []
      });
    }
    await prisma.order.update({
      where: { id: order.id },
      data: {
        fulfillStatus: to,
        // Returning to an earlier stage invalidates carrier delivery info.
        ...(to === 'PENDING' || to === 'PROCESSING' ? { deliveryStatus: null } : {})
      }
    });
    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.userId,
      action: 'order.status_changed',
      target: order.orderNumber,
      metadata: { from: order.fulfillStatus, to }
    });
    res.json({ ok: true, fulfillStatus: to });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to update status' });
  }
});

/**
 * Set/replace the tracking number. Also:
 *   - pushes the fulfillment (with tracking) to Shopify unless pushToShopify=false
 *   - auto-advances PENDING/PROCESSING → SHIPPED
 *   - changing tracking on a DELIVERED order reverts it to SHIPPED
 */
router.patch('/:id/tracking', requireStoreCapability('fulfill'), async (req: Request, res: Response) => {
  try {
    const trackingNumber = String(req.body?.trackingNumber || '').trim();
    const trackingCompany = String(req.body?.trackingCompany || '').trim() || null;
    const pushToShopify = req.body?.pushToShopify !== false;
    const notifyCustomer = req.body?.notifyCustomer !== false;
    if (!trackingNumber) return res.status(400).json({ error: 'trackingNumber required' });

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, storeId: req.resolved!.storeId }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.fulfillStatus === 'CANCELLED') {
      return res.status(409).json({ error: 'Đơn đã huỷ — không thể gắn tracking' });
    }

    let shopifyResult: any = null;
    if (pushToShopify) {
      const store = await prisma.shopifyStore.findUnique({ where: { id: order.storeId } });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      try {
        shopifyResult = await updateOrderTracking(
          store.storeDomain,
          decryptToken(store.accessToken),
          order.orderNumber,
          trackingNumber,
          trackingCompany || order.shippingCompany || 'Other',
          undefined,
          notifyCustomer,
          true,
          true
        );
      } catch (e: any) {
        return res.status(502).json({ error: `Ghi fulfillment lên Shopify thất bại: ${e?.message}` });
      }
    }

    const nextStatus =
      order.fulfillStatus === 'PENDING' || order.fulfillStatus === 'PROCESSING' ? 'SHIPPED'
      : order.fulfillStatus === 'DELIVERED' && order.trackingNumber !== trackingNumber ? 'SHIPPED'
      : order.fulfillStatus;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        trackingNumber,
        ...(trackingCompany ? { shippingCompany: trackingCompany } : {}),
        fulfillStatus: nextStatus,
        ...(order.trackingNumber !== trackingNumber ? { deliveryStatus: null } : {})
      }
    });
    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.userId,
      action: 'order.tracking_set',
      target: order.orderNumber,
      metadata: { trackingNumber, trackingCompany, pushedToShopify: pushToShopify }
    });
    res.json({ ok: true, fulfillStatus: nextStatus, trackingNumber, shopify: shopifyResult ? true : false });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to set tracking' });
  }
});

export default router;
