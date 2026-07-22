/**
 * Excel-style COGS price matrix — mounted at /api/cogs-matrix.
 *
 * Rows = the store's product variants (from ProductVariant, kept fresh by
 * order sync / product sync). Columns = CogsLine (supplier × carrier ×
 * country), each with sub-columns per SET size. A cell = CogsPrice: the TOTAL
 * landed cost (product + shipping) for that many units via that line.
 *
 *   GET    /            whole matrix: variants + lines + prices
 *   POST   /lines       create a line (column)
 *   PATCH  /lines/:id   update a line (carrier, country, supplier, setSizes…)
 *   DELETE /lines/:id   remove a line and its prices
 *   PUT    /prices      bulk upsert/delete cells (autosave from the grid)
 *   POST   /import-pricebooks   one-time prefill from the legacy Pricebook data
 *
 * Identity: requireAuth + resolveStore (same pattern as orders.routes).
 */
import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore } from '../middleware/resolve-store';
import { decryptToken } from '../lib/token-crypto';
import { audit } from '../lib/audit';

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
    const [ownVariants, liVariants, lines] = await Promise.all([
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
        include: { prices: { select: { variantId: true, setQty: true, cost: true } } }
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
          cost: String(p.cost)
        }))
      }))
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load matrix' });
  }
});

router.post('/lines', async (req: Request, res: Response) => {
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

router.patch('/lines/:id', async (req: Request, res: Response) => {
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

router.delete('/lines/:id', async (req: Request, res: Response) => {
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
 * Bulk cell save (grid autosave). Body:
 *   { cells: [{ lineId, variantId, setQty, cost }] }
 * cost null/'' → delete the cell. Line ownership checked per store.
 */
router.put('/prices', async (req: Request, res: Response) => {
  try {
    const cells: any[] = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (cells.length === 0) return res.json({ ok: true, saved: 0, deleted: 0 });
    if (cells.length > 2000) return res.status(400).json({ error: 'Tối đa 2000 ô mỗi lần lưu' });

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

      const raw = c?.cost;
      const isDelete = raw === null || raw === undefined || String(raw).trim() === '';
      if (isDelete) {
        ops.push(prisma.cogsPrice.deleteMany({ where: { lineId, variantId, setQty } }));
        deleted++;
      } else {
        const cost = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(cost) || cost < 0) continue;
        ops.push(prisma.cogsPrice.upsert({
          where: { lineId_variantId_setQty: { lineId, variantId, setQty } },
          create: { lineId, variantId, setQty, cost: new Prisma.Decimal(cost.toFixed(2)) },
          update: { cost: new Prisma.Decimal(cost.toFixed(2)) }
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
router.post('/import-pricebooks', async (req: Request, res: Response) => {
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
          cells.push({
            lineId: line.id,
            variantId: o.variantId,
            setQty: n,
            cost: new Prisma.Decimal((Number(o.overrideCost) * n + tierFor(n)).toFixed(2))
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

export default router;
