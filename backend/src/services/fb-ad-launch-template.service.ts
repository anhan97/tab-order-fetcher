/**
 * Saved-template CRUD for the auto-launch wizard.
 *
 * Templates store the wizard's configuration as JSON. We don't try to
 * validate the shape — the wizard is the source of truth for what's
 * valid, and forcing a strict TS shape here would mean a migration every
 * time the wizard learns a new targeting field.
 *
 * "Default" is a UI marker, not enforced unique. A user may pick which
 * template auto-loads first.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface TemplateInput {
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
}

export async function listTemplates(userId: string) {
  return prisma.adLaunchTemplate.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, name: true, config: true, isDefault: true, createdAt: true, updatedAt: true }
  });
}

export async function getTemplate(userId: string, id: string) {
  return prisma.adLaunchTemplate.findFirst({ where: { id, userId } });
}

export async function createTemplate(userId: string, input: TemplateInput) {
  if (input.isDefault) await clearDefault(userId);
  return prisma.adLaunchTemplate.create({
    data: {
      userId,
      name: input.name.trim(),
      config: input.config as unknown as Prisma.InputJsonValue,
      isDefault: !!input.isDefault
    }
  });
}

export async function updateTemplate(userId: string, id: string, input: Partial<TemplateInput>) {
  const existing = await prisma.adLaunchTemplate.findFirst({ where: { id, userId } });
  if (!existing) return null;
  if (input.isDefault) await clearDefault(userId, id);
  return prisma.adLaunchTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.config !== undefined ? { config: input.config as unknown as Prisma.InputJsonValue } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {})
    }
  });
}

export async function deleteTemplate(userId: string, id: string): Promise<boolean> {
  const r = await prisma.adLaunchTemplate.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

async function clearDefault(userId: string, exceptId?: string) {
  await prisma.adLaunchTemplate.updateMany({
    where: { userId, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false }
  });
}
