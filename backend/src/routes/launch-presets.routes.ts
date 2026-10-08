/**
 * Launch presets (spec §7.6). Every row is private to the caller — the actor,
 * not the store owner: two managers of one store keep separate presets.
 *
 *   GET    /api/launch-presets                    list (copies starters on first open)
 *   POST   /api/launch-presets                    create { name, description, config }
 *   PUT    /api/launch-presets/:id                update
 *   DELETE /api/launch-presets/:id                soft delete
 *   POST   /api/launch-presets/restore-starters   re-add / revive / repair starters
 */
import express from 'express';
import { presetInputSchema } from '../ads-launcher/contract';
import { fail, handle, ok, storeChain, zodFail } from '../ads-launcher/http';
import { createPreset, deletePreset, listPresets, restoreStarters, updatePreset } from '../ads-launcher/presets.service';

const router = express.Router();
const chain = storeChain('manage');
const actor = (req: express.Request) => req.resolved!.actorId;

router.get('/', ...chain, handle(async (req, res) => {
  ok(res, { items: await listPresets(actor(req)) });
}));

router.post('/', ...chain, handle(async (req, res) => {
  const parsed = presetInputSchema.safeParse(req.body);
  if (!parsed.success) return zodFail(res, parsed.error);
  ok(res, await createPreset(actor(req), parsed.data), 201);
}));

router.post('/restore-starters', ...chain, handle(async (req, res) => {
  ok(res, { items: await restoreStarters(actor(req)) });
}));

router.put('/:id', ...chain, handle(async (req, res) => {
  const parsed = presetInputSchema.safeParse(req.body);
  if (!parsed.success) return zodFail(res, parsed.error);
  const row = await updatePreset(actor(req), req.params.id, parsed.data);
  if (!row) return fail(res, 404, 'not_found', 'Preset not found');
  ok(res, row);
}));

router.delete('/:id', ...chain, handle(async (req, res) => {
  if (!(await deletePreset(actor(req), req.params.id))) return fail(res, 404, 'not_found', 'Preset not found');
  ok(res, { ok: true });
}));

export default router;
