/**
 * DB-backed order management (fulfillment workflow) — mounted at /api/orders.
 *
 * The DB is the source of truth (webhooks + scheduler keep it fresh); this
 * replaces reading the live Shopify proxy for the fulfillment screens.
 *
 *   GET    /                 list w/ filters + tab counts (paginated)
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
import { canTransition, isFulfillStatus, ORDER_FULFILL_TRANSITIONS } from '../lib/order-lifecycle';
import {
  EXPORT_FIELDS, EXPORT_FIELD_MAP, DEFAULT_EXPORT_COLUMNS,
  sanitizeColumns, serializeRows, type ExportDelimiter
} from '../lib/order-export-fields';
import { decryptToken } from '../lib/token-crypto';
import { updateOrderTracking } from '../services/shopify.service';
import { audit } from '../lib/audit';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireActive, resolveStore);

interface ListFilters {
  storeId: string;
  q?: string;
  fulfillStatus?: string;
  paymentStatus?: string;
  from?: Date;
  to?: Date;
}

function buildWhere(f: ListFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { storeId: f.storeId };
  if (f.fulfillStatus) where.fulfillStatus = f.fulfillStatus;
  if (f.paymentStatus === 'unpaid') where.status = { notIn: ['paid', 'refunded', 'partially_refunded'] };
  else if (f.paymentStatus) where.status = f.paymentStatus;
  if (f.from || f.to) {
    where.processedAt = {};
    if (f.from) (where.processedAt as any).gte = f.from;
    if (f.to) (where.processedAt as any).lte = f.to;
  }
  if (f.q) {
    where.OR = [
      { orderNumber: { contains: f.q, mode: 'insensitive' } },
      { customerName: { contains: f.q, mode: 'insensitive' } },
      { customerEmail: { contains: f.q, mode: 'insensitive' } },
      { customerPhone: { contains: f.q, mode: 'insensitive' } },
      { trackingNumber: { contains: f.q, mode: 'insensitive' } }
    ];
  }
  return where;
}

function parseFilters(req: Request): ListFilters {
  return {
    storeId: req.resolved!.storeId,
    q: String(req.query.q || '').trim() || undefined,
    fulfillStatus: String(req.query.fulfillStatus || '').trim().toUpperCase() || undefined,
    paymentStatus: String(req.query.paymentStatus || '').trim() || undefined,
    from: req.query.from ? new Date(String(req.query.from)) : undefined,
    to: req.query.to ? new Date(String(req.query.to)) : undefined
  };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const where = buildWhere(filters);
    const [orders, total, statusCounts, unpaidCount] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          // Explicit select: variantId/productId are BigInt and would crash
          // res.json — the list view doesn't need them anyway.
          lineItems: {
            select: { id: true, title: true, sku: true, quantity: true, price: true }
          }
        }
      }),
      prisma.order.count({ where }),
      // Tab counts ignore the fulfillStatus filter itself (a tab shows its own
      // count regardless of which tab is active) but respect q/date filters.
      prisma.order.groupBy({
        by: ['fulfillStatus'],
        where: buildWhere({ ...filters, fulfillStatus: undefined }),
        _count: { _all: true }
      }),
      prisma.order.count({
        where: {
          ...buildWhere({ ...filters, fulfillStatus: undefined }),
          status: { notIn: ['paid', 'refunded', 'partially_refunded'] }
        }
      })
    ]);

    const tabs: Record<string, number> = { ALL: 0, UNPAID: unpaidCount };
    for (const row of statusCounts) {
      tabs[row.fulfillStatus] = row._count._all;
      tabs.ALL += row._count._all;
    }

    res.json({ orders, total, limit, offset, tabs });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list orders' });
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
router.post('/export-presets', async (req: Request, res: Response) => {
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
router.delete('/export-presets/:id', async (req: Request, res: Response) => {
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
    const filters = parseFilters(req);
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

router.patch('/:id/status', async (req: Request, res: Response) => {
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
router.patch('/:id/tracking', async (req: Request, res: Response) => {
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
