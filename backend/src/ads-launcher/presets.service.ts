/**
 * Launch presets (§6, §7.6) — always private to the user who owns them.
 *
 * The first time someone opens the list (no row at all, deleted ones
 * included) the starter presets are copied in; after that they are theirs.
 * A row whose stored config no longer parses is skipped and logged, never
 * allowed to break the whole list.
 */
import { Prisma, type LaunchPreset as PresetRow } from '@prisma/client';
import { type LaunchPreset, type LaunchPresetInput, STARTER_PRESETS, normalizePresetConfig } from './contract';
import { prisma } from './prisma-launch-repo';

function toDto(row: PresetRow): LaunchPreset | null {
  const config = normalizePresetConfig(row.config);
  if (!config) {
    console.warn(`[ads-launcher] preset ${row.id} has an invalid config — skipped`);
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config,
    starterKey: row.starterKey,
    position: row.position,
    updatedAt: row.updatedAt.toISOString()
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function live(userId: string): Promise<LaunchPreset[]> {
  const rows = await prisma.launchPreset.findMany({ where: { userId, deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(toDto).filter((p): p is LaunchPreset => !!p);
}

export async function listPresets(userId: string): Promise<LaunchPreset[]> {
  const any = await prisma.launchPreset.count({ where: { userId } });
  if (any === 0) {
    await prisma.launchPreset.createMany({
      data: STARTER_PRESETS.map((s, i) => ({ userId, name: s.name, description: s.description, config: json(s.config), starterKey: s.key, position: i })),
      skipDuplicates: true
    });
  }
  return live(userId);
}

export async function createPreset(userId: string, input: LaunchPresetInput): Promise<LaunchPreset> {
  const max = await prisma.launchPreset.aggregate({ where: { userId }, _max: { position: true } });
  const row = await prisma.launchPreset.create({
    data: { userId, name: input.name, description: input.description, config: json(input.config), position: (max._max.position ?? -1) + 1 }
  });
  return toDto(row)!;
}

export async function updatePreset(userId: string, id: string, input: LaunchPresetInput): Promise<LaunchPreset | null> {
  const res = await prisma.launchPreset.updateMany({
    where: { id, userId, deletedAt: null },
    data: { name: input.name, description: input.description, config: json(input.config) }
  });
  if (res.count === 0) return null;
  return toDto((await prisma.launchPreset.findUnique({ where: { id } }))!);
}

export async function deletePreset(userId: string, id: string): Promise<boolean> {
  const res = await prisma.launchPreset.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
  return res.count > 0;
}

/** Add missing starters, revive deleted ones, repair starters whose config no longer parses. */
export async function restoreStarters(userId: string): Promise<LaunchPreset[]> {
  const existing = await prisma.launchPreset.findMany({ where: { userId, starterKey: { not: null } } });
  const max = await prisma.launchPreset.aggregate({ where: { userId }, _max: { position: true } });
  let position = (max._max.position ?? -1) + 1;
  for (const s of STARTER_PRESETS) {
    const row = existing.find(r => r.starterKey === s.key);
    if (!row) {
      await prisma.launchPreset.create({
        data: { userId, name: s.name, description: s.description, config: json(s.config), starterKey: s.key, position: position++ }
      });
      continue;
    }
    const broken = !normalizePresetConfig(row.config);
    if (row.deletedAt || broken) {
      await prisma.launchPreset.update({
        where: { id: row.id },
        data: { deletedAt: null, ...(broken ? { config: json(s.config) } : {}) }
      });
    }
  }
  return live(userId);
}
