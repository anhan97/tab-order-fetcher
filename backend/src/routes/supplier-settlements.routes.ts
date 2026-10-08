/**
 * Supplier payments — mounted at /api/supplier-settlements.
 *
 *   GET    /             payments for this store, newest first
 *   POST   /             record a payment for a set of orders
 *   GET    /:id          one payment with its orders
 *   POST   /:id/void     undo a payment: its orders become payable again
 *   GET    /:id/statement  CSV of the orders in the payment
 *
 * A payment's totals are computed HERE from the orders' frozen line-item
 * costs, never taken from the client, then snapshotted on the row. An order
 * can sit in only one live payment: recording one claims the orders with a
 * conditional update, so two people paying the same orders at the same time
 * cannot both succeed.
 *
 * Money moves, so writes need the 'costs' capability (owner, manager,
 * finance). Anyone who can open the store can read.
 */
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore, requireStoreCapability } from '../middleware/resolve-store';
import { serializeRows } from '../lib/order-export-fields';
import { audit } from '../lib/audit';
import {
  summarize, settlementBlocker, statementRows, STATEMENT_HEADER, type CostOrder
} from '../lib/supplier-cost';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireActive, resolveStore);

const ORDER_COST_SELECT = {
  id: true, orderNumber: true, supplier: true, shippingCompany: true, shippingCountryCode: true,
  fulfillStatus: true, supplierSettlementId: true, processedAt: true, shippedAt: true, trackingNumber: true,
  lineItems: {
    select: {
      title: true, sku: true, variantTitle: true, quantity: true,
      variantId: true, unitBasecost: true, unitProductCost: true, unitShippingCost: true
    }
  }
} as const;

const toDto = (s: any) => ({
  id: s.id,
  supplier: s.supplier,
  status: s.status,
  orderCount: s.orderCount,
  unitCount: s.unitCount,
  productCost: String(s.productCost),
  shippingCost: String(s.shippingCost),
  totalCost: String(s.totalCost),
  currency: s.currency,
  paidAt: s.paidAt,
  reference: s.reference,
  note: s.note,
  createdBy: s.createdBy,
  createdAt: s.createdAt,
  voidedAt: s.voidedAt,
  voidedBy: s.voidedBy
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await prisma.supplierSettlement.findMany({
      where: { storeId: req.resolved!.storeId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 200
    });
    res.json({ settlements: rows.map(toDto) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list supplier payments' });
  }
});

router.post('/', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    const ids: string[] = Array.isArray(req.body?.orderIds) ? [...new Set<string>(req.body.orderIds.map(String))] : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Select at least one order' });
    if (ids.length > 5000) return res.status(400).json({ error: 'At most 5000 orders per payment' });

    const paidAt = req.body?.paidAt ? new Date(String(req.body.paidAt)) : new Date();
    if (Number.isNaN(paidAt.getTime())) return res.status(400).json({ error: 'Invalid payment date' });
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 200) || null : null;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) || null : null;

    const orders = await prisma.order.findMany({ where: { storeId, id: { in: ids } }, select: ORDER_COST_SELECT });
    if (orders.length !== ids.length) {
      return res.status(400).json({ error: `${ids.length - orders.length} selected order(s) do not belong to this store` });
    }

    const summary = summarize(orders as unknown as CostOrder[]);
    const blocker = settlementBlocker(summary);
    if (blocker) return res.status(409).json({ error: blocker, summary });

    const currency = (await prisma.cogsLine.findFirst({
      where: { storeId }, orderBy: { sortOrder: 'asc' }, select: { currency: true }
    }))?.currency ?? 'USD';

    const settlement = await prisma.$transaction(async tx => {
      const created = await tx.supplierSettlement.create({
        data: {
          userId: req.resolved!.userId,
          storeId,
          supplier: summary.suppliers[0],
          orderCount: summary.orders,
          unitCount: summary.units,
          productCost: new Prisma.Decimal(summary.product.toFixed(2)),
          shippingCost: new Prisma.Decimal(summary.shipping.toFixed(2)),
          totalCost: new Prisma.Decimal(summary.total.toFixed(2)),
          currency,
          paidAt,
          reference,
          note,
          createdBy: req.resolved!.actorId
        }
      });
      // Claim only orders still unpaid. If someone settled any of them in the
      // meantime the count comes up short and the whole payment rolls back.
      const claimed = await tx.order.updateMany({
        where: { storeId, id: { in: ids }, supplierSettlementId: null },
        data: { supplierSettlementId: created.id }
      });
      if (claimed.count !== ids.length) {
        throw Object.assign(new Error('Some of these orders were just paid by someone else — reload and try again'), { status: 409 });
      }
      return created;
    });

    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.resolved!.actorId,
      action: 'supplier_settlement.created',
      target: settlement.id,
      metadata: { supplier: settlement.supplier, orders: summary.orders, total: summary.total, reference }
    });
    res.status(201).json({ settlement: toDto(settlement) });
  } catch (e: any) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to record the payment' });
  }
});

async function findOwn(req: Request) {
  return prisma.supplierSettlement.findFirst({ where: { id: req.params.id, storeId: req.resolved!.storeId } });
}

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const s = await findOwn(req);
    if (!s) return res.status(404).json({ error: 'Payment not found' });
    const orders = await prisma.order.findMany({
      where: { storeId: s.storeId, supplierSettlementId: s.id },
      orderBy: { processedAt: 'asc' },
      select: { id: true, orderNumber: true, processedAt: true, shippedAt: true, trackingNumber: true, fulfillStatus: true }
    });
    res.json({ settlement: toDto(s), orders });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load the payment' });
  }
});

router.post('/:id/void', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const s = await findOwn(req);
    if (!s) return res.status(404).json({ error: 'Payment not found' });
    if (s.status === 'VOID') return res.status(409).json({ error: 'This payment is already void' });

    const released = await prisma.$transaction(async tx => {
      await tx.supplierSettlement.update({
        where: { id: s.id },
        data: { status: 'VOID', voidedAt: new Date(), voidedBy: req.resolved!.actorId }
      });
      const r = await tx.order.updateMany({
        where: { storeId: s.storeId, supplierSettlementId: s.id },
        data: { supplierSettlementId: null }
      });
      return r.count;
    });

    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.resolved!.actorId,
      action: 'supplier_settlement.voided',
      target: s.id,
      metadata: { supplier: s.supplier, released }
    });
    res.json({ ok: true, released });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to void the payment' });
  }
});

router.get('/:id/statement', async (req: Request, res: Response) => {
  try {
    const s = await findOwn(req);
    if (!s) return res.status(404).json({ error: 'Payment not found' });
    // A void payment has released its orders; its statement is empty by design.
    const orders = await prisma.order.findMany({
      where: { storeId: s.storeId, supplierSettlementId: s.id },
      orderBy: { processedAt: 'asc' },
      select: ORDER_COST_SELECT
    });
    const summaryRow = [
      `Supplier: ${s.supplier}`, `Paid: ${s.paidAt.toISOString().slice(0, 10)}`,
      `Reference: ${s.reference ?? ''}`, `Orders: ${s.orderCount}`, `Units: ${s.unitCount}`,
      `Product: ${s.productCost}`, `Shipping: ${s.shippingCost}`, `Total: ${s.totalCost} ${s.currency}`
    ];
    const rows = [summaryRow, [], STATEMENT_HEADER, ...statementRows(orders as any)];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="supplier-payment-${s.supplier.replace(/[^\w-]+/g, '_')}-${s.paidAt.toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + serializeRows(rows, 'comma'));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to build the statement' });
  }
});

export default router;
