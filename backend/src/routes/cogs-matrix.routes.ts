/**
 * Excel-style COGS price matrix — mounted at /api/cogs-matrix.
 *
 * Rows = the store's product variants (from ProductVariant, kept fresh by
 * order sync / product sync). Columns = CogsLine (supplier × carrier ×
 * country), each with sub-columns per SET size. A cell = CogsPrice: product
 * cost + shipping cost for that many units via that line (cost = their sum).
 *
 *   GET    /            whole matrix: variants + lines + prices + combos
 *   POST   /lines       create a line (column)
 *   PATCH  /lines/:id   update a line (carrier, country, supplier, setSizes…)
 *   DELETE /lines/:id   remove a line and its prices
 *   PUT    /prices      bulk upsert/delete cells (autosave from the grid)
 *   POST   /combos      create a combo (a priced mix of different variants)
 *   PATCH  /combos/:id  rename / change items
 *   DELETE /combos/:id  remove a combo and its prices
 *   PUT    /combo-prices  bulk upsert/delete combo cells
 *   POST   /import-pricebooks   one-time prefill from the legacy Pricebook data
 *
 * Identity: requireAuth + resolveStore (same pattern as orders.routes).
 */
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore } from '../middleware/resolve-store';
import { requireStoreCapability } from '../middleware/resolve-store';
import { decryptToken } from '../lib/token-crypto';
import { audit } from '../lib/audit';
import {
  normalizeComboItems, comboSignature, validateCombo, parseMoney, type ComboItem
} from '../lib/cogs-combo';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireActive, resolveStore);

/**
 * Lazily backfill ProductVariant.imageUrl from the Shopify Products API.
 * Runs at most once per store per 10 minutes (in-memory throttle) and only
 * when some variants are missing an image. Failures are swallowed — images
 * are cosmetic, the matrix must load regardless.
 */
const imageRefreshAt = new Map<string, number>();
const IMAGE_REFRESH_TTL_MS = 10 * 60 * 1000;

async function refreshVariantImages(storeId: string): Promise<void> {
  const last = imageRefreshAt.get(storeId) ?? 0;
  if (Date.now() - last < IMAGE_REFRESH_TTL_MS) return;
  imageRefreshAt.set(storeId, Date.now()); // set first — a failing store shouldn't retry every load

  const store = await prisma.shopifyStore.findUnique({ where: { id: storeId } });
  if (!store) return;
  const token = decryptToken(store.accessToken);
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  // Page through products; variant image = its image_id in images[], else product image.
  let url: string | null =
    `https://${store.storeDomain}/admin/api/2025-10/products.json?limit=250&fields=id,image,images,variants`;
  const updates: Array<{ variantId: bigint; imageUrl: string }> = [];
  for (let page = 0; url && page < 8; page++) {
    const res: any = await fetch(url, { headers });
    if (!res.ok) return;
    const body: any = await res.json();
    for (const prod of body.products || []) {
      const productImg = prod.image?.src || prod.images?.[0]?.src || null;
      for (const v of prod.variants || []) {
        const own = v.image_id ? (prod.images || []).find((i: any) => i.id === v.image_id)?.src : null;
        const src = own || productImg;
        if (src && v.id) updates.push({ variantId: BigInt(v.id), imageUrl: src });
      }
    }
    const link = res.headers.get('link') || '';
    const next = link.split(',').find((s: string) => s.includes('rel="next"'));
    url = next ? (next.match(/<([^>]+)>/)?.[1] ?? null) : null;
  }

  // updateMany by PK — never creates rows, never touches basecost.
  for (const u of updates) {
    await prisma.productVariant.updateMany({
      where: { variantId: u.variantId },
      data: { imageUrl: u.imageUrl }
    });
  }
}

/** setSizes Json → sorted unique positive ints, always containing at least [1]. */
function normalizeSetSizes(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : [];
  const cleaned = [...new Set(arr.map(n => parseInt(String(n), 10)).filter(n => n >= 1 && n <= 99))];
  cleaned.sort((a, b) => a - b);
  return cleaned.length ? cleaned : [1];
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    // Cosmetic — throttled internally; never blocks the matrix on failure.
    try { await refreshVariantImages(storeId); } catch { /* ignore */ }
    // Row list = union of (a) this store's ProductVariant rows and (b) every
    // variant that appears on this store's order line items. (b) matters
    // because ProductVariant.variantId is a GLOBAL PK — when several
    // user+store rows share one physical shop domain (legacy synthetic-user
    // split), the variant row may be owned by another storeId and a plain
    // storeId filter would show an incomplete product list.
    const [ownVariants, liVariants, lines, combos] = await Promise.all([
      prisma.productVariant.findMany({
        where: { storeId },
        select: { variantId: true, productId: true, sku: true, title: true, basecost: true, imageUrl: true }
      }),
      prisma.orderLineItem.findMany({
        where: { order: { storeId }, variantId: { not: null } },
        distinct: ['variantId'],
        orderBy: { id: 'desc' },
        select: { variantId: true, productId: true, sku: true, title: true }
      }),
      prisma.cogsLine.findMany({
        where: { storeId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          prices: { select: { variantId: true, setQty: true, productCost: true, shippingCost: true, cost: true } }
        }
      }),
      prisma.cogsCombo.findMany({
        where: { storeId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { prices: { select: { lineId: true, productCost: true, shippingCost: true, cost: true } } }
      })
    ]);

    // Enrich order-derived variants with the canonical ProductVariant row
    // (any owner — global PK) for title/sku/basecost.
    const liIds = liVariants.map(v => v.variantId!) ;
    const canonical = liIds.length
      ? await prisma.productVariant.findMany({
          where: { variantId: { in: liIds } },
          select: { variantId: true, productId: true, sku: true, title: true, basecost: true, imageUrl: true }
        })
      : [];
    const canonMap = new Map(canonical.map(v => [v.variantId.toString(), v]));

    const merged = new Map<string, { variantId: string; productId: string; sku: string | null; title: string; basecost: string; imageUrl: string | null }>();
    for (const v of ownVariants) {
      merged.set(v.variantId.toString(), {
        variantId: String(v.variantId), productId: String(v.productId),
        sku: v.sku, title: v.title, basecost: String(v.basecost), imageUrl: v.imageUrl
      });
    }
    for (const li of liVariants) {
      const key = li.variantId!.toString();
      if (merged.has(key)) continue;
      const canon = canonMap.get(key);
      merged.set(key, {
        variantId: key,
        productId: String(canon?.productId ?? li.productId ?? 0),
        sku: canon?.sku ?? li.sku,
        title: canon?.title ?? li.title ?? '(unnamed)',
        basecost: String(canon?.basecost ?? 0),
        imageUrl: canon?.imageUrl ?? null
      });
    }
    const variants = [...merged.values()].sort((a, b) =>
      a.productId === b.productId ? a.title.localeCompare(b.title) : a.productId.localeCompare(b.productId)
    );

    res.json({
      variants,
      lines: lines.map(l => ({
        id: l.id,
        supplier: l.supplier,
        carrier: l.carrier,
        countryCode: l.countryCode,
        currency: l.currency,
        setSizes: normalizeSetSizes(l.setSizes),
        sortOrder: l.sortOrder,
        prices: l.prices.map(p => ({
          variantId: String(p.variantId),
          setQty: p.setQty,
          productCost: String(p.productCost),
          shippingCost: String(p.shippingCost),
          cost: String(p.cost)
        }))
      })),
      combos: combos.map(c => ({
        id: c.id,
        name: c.name,
        items: normalizeComboItems(c.items),
        sortOrder: c.sortOrder,
        prices: c.prices.map(p => ({
          lineId: p.lineId,
          productCost: String(p.productCost),
          shippingCost: String(p.shippingCost),
          cost: String(p.cost)
        }))
      }))
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load matrix' });
  }
});

router.post('/lines', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const supplier = String(req.body?.supplier || 'Default').trim() || 'Default';
    const carrier = String(req.body?.carrier || '').trim();
    const countryCode = String(req.body?.countryCode || '').trim().toUpperCase();
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
    const setSizes = normalizeSetSizes(req.body?.setSizes ?? [1]);
    if (!carrier) return res.status(400).json({ error: 'Nhập tên line ship (carrier)' });
    if (!/^[A-Z]{2}$/.test(countryCode)) return res.status(400).json({ error: 'Chọn quốc gia (mã 2 ký tự)' });

    const max = await prisma.cogsLine.aggregate({
      where: { storeId: req.resolved!.storeId }, _max: { sortOrder: true }
    });
    const line = await prisma.cogsLine.create({
      data: {
        userId: req.resolved!.userId,
        storeId: req.resolved!.storeId,
        supplier, carrier, countryCode, currency,
        setSizes,
        sortOrder: (max._max.sortOrder ?? 0) + 1
      }
    });
    res.json({ line: { ...line, setSizes, prices: [] } });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'Line này đã tồn tại (trùng supplier + carrier + quốc gia)' });
    }
    res.status(500).json({ error: e?.message || 'Failed to create line' });
  }
});

router.patch('/lines/:id', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.cogsLine.findFirst({
      where: { id: req.params.id, storeId: req.resolved!.storeId }
    });
    if (!existing) return res.status(404).json({ error: 'Line not found' });

    const data: Prisma.CogsLineUpdateInput = {};
    if (req.body?.supplier !== undefined) data.supplier = String(req.body.supplier).trim() || 'Default';
    if (req.body?.carrier !== undefined) {
      const c = String(req.body.carrier).trim();
      if (!c) return res.status(400).json({ error: 'Carrier không được rỗng' });
      data.carrier = c;
    }
    if (req.body?.countryCode !== undefined) {
      const cc = String(req.body.countryCode).trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'Mã quốc gia phải 2 ký tự' });
      data.countryCode = cc;
    }
    if (req.body?.currency !== undefined) data.currency = String(req.body.currency).trim().toUpperCase() || 'USD';
    if (req.body?.setSizes !== undefined) data.setSizes = normalizeSetSizes(req.body.setSizes);
    if (req.body?.sortOrder !== undefined) data.sortOrder = parseInt(String(req.body.sortOrder), 10) || 0;

    const line = await prisma.cogsLine.update({ where: { id: existing.id }, data });
    res.json({ line: { ...line, setSizes: normalizeSetSizes(line.setSizes) } });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'Trùng với một line đã có (supplier + carrier + quốc gia)' });
    }
    res.status(500).json({ error: e?.message || 'Failed to update line' });
  }
});

router.delete('/lines/:id', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const del = await prisma.cogsLine.deleteMany({
      where: { id: req.params.id, storeId: req.resolved!.storeId }
    });
    if (del.count === 0) return res.status(404).json({ error: 'Line not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete line' });
  }
});

/**
 * Turn one cell's { productCost, shippingCost } (or a legacy single `cost`)
 * into what gets stored. Returns null to delete the cell, undefined to skip
 * an invalid one. The total is always derived here, never trusted from the
 * client, so cost === productCost + shippingCost holds for every row.
 */
function resolveCellCost(c: any): { productCost: number; shippingCost: number; cost: number } | null | undefined {
  const hasSplit = c && ('productCost' in c || 'shippingCost' in c);
  const product = parseMoney(hasSplit ? c.productCost : c?.cost);
  const shipping = hasSplit ? parseMoney(c.shippingCost) : null;
  if (Number.isNaN(product) || Number.isNaN(shipping)) return undefined;
  if (product === null && shipping === null) return null;
  const p = product ?? 0;
  const s = shipping ?? 0;
  return { productCost: p, shippingCost: s, cost: Math.round((p + s) * 100) / 100 };
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

/**
 * Bulk cell save (grid autosave). Body:
 *   { cells: [{ lineId, variantId, setQty, productCost, shippingCost }] }
 * Both parts empty → delete the cell. One part empty → it counts as 0.
 * A legacy { cost } is still accepted and stored as product cost.
 * Line ownership checked per store.
 */
router.put('/prices', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const cells: any[] = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (cells.length === 0) return res.json({ ok: true, saved: 0, deleted: 0 });
    if (cells.length > 2000) return res.status(400).json({ error: 'At most 2000 cells per save' });

    const storeLines = await prisma.cogsLine.findMany({
      where: { storeId: req.resolved!.storeId }, select: { id: true }
    });
    const lineIds = new Set(storeLines.map(l => l.id));

    let saved = 0, deleted = 0;
    const ops: Prisma.PrismaPromise<any>[] = [];
    for (const c of cells) {
      const lineId = String(c?.lineId || '');
      const setQty = parseInt(String(c?.setQty), 10);
      if (!lineIds.has(lineId) || !(setQty >= 1 && setQty <= 99)) continue;
      let variantId: bigint;
      try { variantId = BigInt(String(c?.variantId)); } catch { continue; }

      const parts = resolveCellCost(c);
      if (parts === undefined) continue;
      if (parts === null) {
        ops.push(prisma.cogsPrice.deleteMany({ where: { lineId, variantId, setQty } }));
        deleted++;
      } else {
        const data = {
          productCost: dec(parts.productCost),
          shippingCost: dec(parts.shippingCost),
          cost: dec(parts.cost)
        };
        ops.push(prisma.cogsPrice.upsert({
          where: { lineId_variantId_setQty: { lineId, variantId, setQty } },
          create: { lineId, variantId, setQty, ...data },
          update: data
        }));
        saved++;
      }
    }
    await prisma.$transaction(ops);
    res.json({ ok: true, saved, deleted });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to save prices' });
  }
});

/**
 * One-time prefill from the legacy Pricebook system:
 * Pricebook(supplier, countryCode, shippingCompany) → CogsLine;
 * cell(set N) = variant override unit cost × N + shipping tier for N items.
 * Skips lines that already exist (idempotent, never overwrites matrix edits).
 */
router.post('/import-pricebooks', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    let books = await prisma.pricebook.findMany({
      where: { storeId },
      include: { shippingTiers: true, variantCostOverrides: true }
    });
    // Legacy synthetic-user split: pricebooks may live on ANOTHER store row
    // that points at the same physical shop domain. Same shop → safe to
    // import its price data as the starting point.
    if (books.length === 0) {
      const siblingStores = await prisma.shopifyStore.findMany({
        where: { storeDomain: req.resolved!.storeDomain, id: { not: storeId } },
        select: { id: true }
      });
      if (siblingStores.length) {
        books = await prisma.pricebook.findMany({
          where: { storeId: { in: siblingStores.map(s => s.id) } },
          include: { shippingTiers: true, variantCostOverrides: true }
        });
      }
    }

    let createdLines = 0, createdCells = 0;
    for (const b of books) {
      if (b.variantCostOverrides.length === 0) continue; // nothing to prefill
      const carrier = b.shippingCompany || 'Default';
      const exists = await prisma.cogsLine.findUnique({
        where: {
          storeId_supplier_carrier_countryCode: {
            storeId, supplier: b.supplier, carrier, countryCode: b.countryCode
          }
        }
      });
      if (exists) continue;

      const setSizes = [1, 2, 3];
      const tierFor = (n: number): number => {
        const t = b.shippingTiers.find(t => n >= t.minItems && n <= t.maxItems);
        return t ? Number(t.shippingCost) : 0;
      };
      const line = await prisma.cogsLine.create({
        data: {
          userId: req.resolved!.userId, storeId,
          supplier: b.supplier, carrier, countryCode: b.countryCode,
          currency: b.currency || 'USD', setSizes, sortOrder: 100 + createdLines
        }
      });
      createdLines++;

      const cells: Prisma.CogsPriceCreateManyInput[] = [];
      for (const o of b.variantCostOverrides) {
        for (const n of setSizes) {
          // The legacy data already separates goods from freight — keep that.
          const product = Number(o.overrideCost) * n;
          const shipping = tierFor(n);
          cells.push({
            lineId: line.id,
            variantId: o.variantId,
            setQty: n,
            productCost: dec(product),
            shippingCost: dec(shipping),
            cost: dec(product + shipping)
          });
        }
      }
      if (cells.length) {
        await prisma.cogsPrice.createMany({ data: cells, skipDuplicates: true });
        createdCells += cells.length;
      }
    }

    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.userId,
      action: 'cogs_matrix.imported_pricebooks',
      target: req.resolved!.storeDomain,
      metadata: { createdLines, createdCells }
    });
    res.json({ ok: true, createdLines, createdCells });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Import failed' });
  }
});

// ── Combos ──────────────────────────────────────────────────────────────────

/** Items must be variants this store actually sells — not arbitrary ids. */
async function unknownVariants(storeId: string, items: ComboItem[]): Promise<string[]> {
  const ids = items.map(i => BigInt(i.variantId));
  const [own, sold] = await Promise.all([
    prisma.productVariant.findMany({ where: { storeId, variantId: { in: ids } }, select: { variantId: true } }),
    prisma.orderLineItem.findMany({
      where: { order: { storeId }, variantId: { in: ids } },
      distinct: ['variantId'],
      select: { variantId: true }
    })
  ]);
  const known = new Set([...own, ...sold].map(v => String(v.variantId)));
  return items.map(i => i.variantId).filter(id => !known.has(id));
}

async function comboBody(req: Request, res: Response, storeId: string, requireAll: boolean) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : undefined;
  if (requireAll && !name) { res.status(400).json({ error: 'Name the combo' }); return null; }

  if (req.body?.items === undefined) {
    if (requireAll) { res.status(400).json({ error: 'Add the products in this combo' }); return null; }
    return { name, items: undefined as ComboItem[] | undefined };
  }
  const items = normalizeComboItems(req.body.items);
  const problem = validateCombo(items);
  if (problem) { res.status(400).json({ error: problem }); return null; }
  const unknown = await unknownVariants(storeId, items);
  if (unknown.length) { res.status(400).json({ error: `Unknown product variants: ${unknown.join(', ')}` }); return null; }
  return { name, items };
}

const DUPLICATE = 'P2002';

router.post('/combos', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    const body = await comboBody(req, res, storeId, true);
    if (!body) return;
    const count = await prisma.cogsCombo.count({ where: { storeId } });
    const combo = await prisma.cogsCombo.create({
      data: {
        userId: req.resolved!.userId,
        storeId,
        name: body.name!,
        items: body.items as any,
        signature: comboSignature(body.items!),
        sortOrder: count
      }
    });
    res.json({ combo: { id: combo.id, name: combo.name, items: body.items, sortOrder: combo.sortOrder, prices: [] } });
  } catch (e: any) {
    if (e?.code === DUPLICATE) return res.status(409).json({ error: 'A combo with exactly these products already exists' });
    res.status(500).json({ error: e?.message || 'Failed to create combo' });
  }
});

router.patch('/combos/:id', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const storeId = req.resolved!.storeId;
    const existing = await prisma.cogsCombo.findFirst({ where: { id: req.params.id, storeId } });
    if (!existing) return res.status(404).json({ error: 'Combo not found' });
    const body = await comboBody(req, res, storeId, false);
    if (!body) return;
    const combo = await prisma.cogsCombo.update({
      where: { id: existing.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.items ? { items: body.items as any, signature: comboSignature(body.items) } : {})
      }
    });
    res.json({ combo: { id: combo.id, name: combo.name, items: normalizeComboItems(combo.items) } });
  } catch (e: any) {
    if (e?.code === DUPLICATE) return res.status(409).json({ error: 'A combo with exactly these products already exists' });
    res.status(500).json({ error: e?.message || 'Failed to update combo' });
  }
});

router.delete('/combos/:id', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const r = await prisma.cogsCombo.deleteMany({ where: { id: req.params.id, storeId: req.resolved!.storeId } });
    if (r.count === 0) return res.status(404).json({ error: 'Combo not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete combo' });
  }
});

/**
 * Bulk combo cell save. Body:
 *   { cells: [{ comboId, lineId, productCost, shippingCost }] }
 * Same clearing rules as PUT /prices. Both ids must belong to this store.
 */
router.put('/combo-prices', requireStoreCapability('costs'), async (req: Request, res: Response) => {
  try {
    const cells: any[] = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (cells.length === 0) return res.json({ ok: true, saved: 0, deleted: 0 });
    if (cells.length > 2000) return res.status(400).json({ error: 'At most 2000 cells per save' });

    const storeId = req.resolved!.storeId;
    const [lines, combos] = await Promise.all([
      prisma.cogsLine.findMany({ where: { storeId }, select: { id: true } }),
      prisma.cogsCombo.findMany({ where: { storeId }, select: { id: true } })
    ]);
    const lineIds = new Set(lines.map(l => l.id));
    const comboIds = new Set(combos.map(c => c.id));

    let saved = 0, deleted = 0;
    const ops: Prisma.PrismaPromise<any>[] = [];
    for (const c of cells) {
      const lineId = String(c?.lineId || '');
      const comboId = String(c?.comboId || '');
      if (!lineIds.has(lineId) || !comboIds.has(comboId)) continue;
      const parts = resolveCellCost(c);
      if (parts === undefined) continue;
      if (parts === null) {
        ops.push(prisma.cogsComboPrice.deleteMany({ where: { comboId, lineId } }));
        deleted++;
      } else {
        const data = {
          productCost: dec(parts.productCost),
          shippingCost: dec(parts.shippingCost),
          cost: dec(parts.cost)
        };
        ops.push(prisma.cogsComboPrice.upsert({
          where: { comboId_lineId: { comboId, lineId } },
          create: { comboId, lineId, ...data },
          update: data
        }));
        saved++;
      }
    }
    await prisma.$transaction(ops);
    res.json({ ok: true, saved, deleted });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to save combo prices' });
  }
});

export default router;
