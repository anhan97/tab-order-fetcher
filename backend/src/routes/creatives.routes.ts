/**
 * Creative library API — scoped to the active store.
 *
 *   GET    /api/creatives/products        Shopify products + creative counts
 *   GET    /api/creatives                 list (?productId&status&launched&q&ids&page&pageSize)
 *   GET    /api/creatives/:id
 *   POST   /api/creatives                 multipart: file (+ poster JPEG) and copy fields
 *   PUT    /api/creatives/:id             angle + copy (name is regenerated)
 *   POST   /api/creatives/:id/archive | /restore
 *   DELETE /api/creatives/:id             soft delete
 *
 * Reading needs the store's `read` capability; changing needs `manage`.
 */
import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { creativeCopySchema } from '../ads-launcher/contract';
import {
  createCreative,
  creativeCountsByProduct,
  deleteCreative,
  getCreativeDto,
  listCreatives,
  setCreativeStatus,
  updateCreative
} from '../ads-launcher/creatives.service';
import { fail, handle, ok, scopeOf, storeChain, zodFail } from '../ads-launcher/http';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaTypeOf,
  removeQuietly,
  sniffMatches,
  storeCreativeFiles,
  tmpUploadDir
} from '../ads-launcher/media-storage';
import { findProduct, listProducts, productOptions } from '../ads-launcher/shopify-catalog';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpUploadDir()),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 10)}`)
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 2, fields: 20 }
}).fields([{ name: 'file', maxCount: 1 }, { name: 'poster', maxCount: 1 }]);

const listQuery = z.object({
  ids: z.string().optional().transform(v => (v ? v.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200) : undefined))
    .pipe(z.array(z.string().uuid()).optional()),
  productId: z.string().regex(/^\d{1,40}$/).optional(),
  status: z.enum(['active', 'archived']).optional(),
  launched: z.enum(['not', 'all']).default('all'),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48)
});

const uuid = z.string().uuid();

router.get('/products', ...storeChain('read'), handle(async (req, res) => {
  const scope = scopeOf(req);
  const [{ items, source }, counts] = await Promise.all([listProducts(scope.storeId), creativeCountsByProduct(scope.storeId)]);
  res.setHeader('X-Catalog-Source', source);
  ok(res, { items: productOptions(items, counts) });
}));

router.get('/', ...storeChain('read'), handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return zodFail(res, parsed.error);
  ok(res, await listCreatives(scopeOf(req), parsed.data));
}));

router.get('/:id', ...storeChain('read'), handle(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'not_found', 'Creative not found');
  const dto = await getCreativeDto(scopeOf(req), req.params.id);
  if (!dto) return fail(res, 404, 'not_found', 'Creative not found');
  ok(res, dto);
}));

const uploadFields = creativeCopySchema.extend({
  productId: z.string().regex(/^\d{1,40}$/, 'Pick a product'),
  productCode: z.string().trim().max(64).optional(),
  width: z.coerce.number().int().positive().max(20000).optional(),
  height: z.coerce.number().int().positive().max(20000).optional()
});

router.post('/', ...storeChain('manage'), (req, res, next) => {
  upload(req, res, err => {
    if (!err) return next();
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    fail(res, tooBig ? 413 : 400, tooBig ? 'file_too_large' : 'invalid_upload', tooBig ? 'File is larger than 500 MB' : err.message);
  });
}, handle(async (req, res) => {
  const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
  const file = files.file?.[0];
  const poster = files.poster?.[0] ?? null;
  const cleanup = () => removeQuietly(file?.path, poster?.path);
  try {
    if (!file) return fail(res, 400, 'invalid_upload', 'Attach a file');
    const parsed = uploadFields.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);

    const mediaType = mediaTypeOf(file.mimetype);
    if (!mediaType) return fail(res, 400, 'unsupported_type', `Unsupported file type ${file.mimetype}. Use JPEG, PNG, GIF, MP4, MOV or WebM.`);
    if (mediaType === 'image' && file.size > MAX_IMAGE_BYTES) return fail(res, 413, 'file_too_large', 'Images must be 30 MB or smaller');
    if (!(await sniffMatches(file.path, file.mimetype))) return fail(res, 400, 'invalid_upload', 'The file content does not match its type');
    if (poster && (poster.mimetype !== 'image/jpeg' || poster.size > 5 * 1024 * 1024 || !(await sniffMatches(poster.path, 'image/jpeg')))) {
      return fail(res, 400, 'invalid_upload', 'The poster must be a JPEG under 5 MB');
    }

    const scope = scopeOf(req);
    const product = await findProduct(scope.storeId, parsed.data.productId);
    if (!product) return fail(res, 400, 'product_not_found', 'That product is not in this store');

    const stored = await storeCreativeFiles({ storeId: scope.storeId, tmpMediaPath: file.path, mime: file.mimetype, tmpPosterPath: poster?.path });
    const dto = await createCreative(scope, {
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle || null,
        code: parsed.data.productCode || product.code,
        imageUrl: product.imageUrl
      },
      angle: parsed.data.angle,
      primaryText: parsed.data.primaryText,
      headline: parsed.data.headline,
      description: parsed.data.description,
      mediaType,
      mediaPath: stored.mediaPath,
      posterPath: stored.posterPath,
      mediaMime: file.mimetype,
      mediaSize: file.size,
      width: parsed.data.width,
      height: parsed.data.height,
      originalName: file.originalname
    });
    ok(res, dto, 201);
  } finally {
    // No-op once the files were moved into the library.
    await cleanup();
  }
}));

router.put('/:id', ...storeChain('manage'), handle(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'not_found', 'Creative not found');
  const parsed = creativeCopySchema.safeParse(req.body);
  if (!parsed.success) return zodFail(res, parsed.error);
  const dto = await updateCreative(scopeOf(req), req.params.id, parsed.data);
  if (!dto) return fail(res, 404, 'not_found', 'Creative not found');
  ok(res, dto);
}));

for (const [action, status] of [['archive', 'archived'], ['restore', 'active']] as const) {
  router.post(`/:id/${action}`, ...storeChain('manage'), handle(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'not_found', 'Creative not found');
    const dto = await setCreativeStatus(scopeOf(req), req.params.id, status);
    if (!dto) return fail(res, 404, 'not_found', 'Creative not found');
    ok(res, dto);
  }));
}

router.delete('/:id', ...storeChain('manage'), handle(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'not_found', 'Creative not found');
  if (!(await deleteCreative(scopeOf(req), req.params.id))) return fail(res, 404, 'not_found', 'Creative not found');
  ok(res, { ok: true });
}));

export default router;
