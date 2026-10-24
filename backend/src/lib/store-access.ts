/**
 * "What may this person do inside this store?" — one answer, one place.
 *
 * Two ways to reach a store:
 *   • ownership  — ShopifyStore.userId. Unlimited.
 *   • membership — a StoreMember row an admin created. Scoped by role.
 *
 * Every store-scoped route resolves an access level through here rather than
 * comparing userIds itself, so adding a role means editing this file only.
 *
 * Capabilities, deliberately coarse (five verbs, not a permission matrix —
 * a matrix nobody can hold in their head is how authorization bugs get
 * written):
 *
 *   read    — see the store: orders, costs, P&L, products
 *   sync    — re-pull / recompute from Shopify & Facebook. Not authoring, but
 *             the jobs are expensive, so a pure viewer cannot kick them off
 *   fulfill — move orders along: status, tracking, export
 *   costs   — edit money-in-the-model: COGS, pricebooks, operating costs
 *   manage  — store settings (default carrier/supplier, export presets)
 *
 * On top of the role, the ads side is granted feature by feature
 * (StoreMember.permissions). No member role includes any of these: a manager
 * sees nothing of Creatives / Ads Launcher / Facebook until an admin ticks it.
 *
 *   creatives.upload — upload creatives; edit / archive / delete their OWN
 *   creatives.view   — see the whole creative library (and the posts)
 *   creatives.manage — edit / archive / delete anyone's creatives
 *   ads.launch       — Ads Launcher + presets (needs to see the library)
 *   facebook.view    — Facebook page: ad accounts, campaigns, spend
 *   facebook.manage  — map campaigns to the store, recompute store spend
 *   fees.view        — payment gateway fees, and profit after them. Without
 *                      it the API strips every fee figure and reports profit
 *                      BEFORE payment fees (lib/fee-visibility.ts)
 *
 * The 'creative' role is creatives.upload and nothing else — no orders, no
 * P&L — for staff who only produce creatives.
 *
 * NOT expressible here, on purpose:
 *   • the Shopify access token — it bypasses every check below, so only the
 *     owner ever receives it
 *   • adding / removing stores, and granting membership — owner + admin only
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 'owner' is not a StoreMember role — it is what ownership resolves to. */
export type StoreAccessLevel = 'owner' | 'manager' | 'cs' | 'finance' | 'viewer' | 'creative';

/** Feature permissions, granted one by one on top of the role. */
export const STORE_PERMISSIONS = [
  'creatives.upload', 'creatives.view', 'creatives.manage',
  'ads.launch', 'facebook.view', 'facebook.manage',
  'fees.view'
] as const;
export type StorePermission = (typeof STORE_PERMISSIONS)[number];

export type StoreCapability = 'read' | 'sync' | 'fulfill' | 'costs' | 'manage' | StorePermission;

/** Canonical order — capability lists always come back in this order. */
export const ALL_STORE_CAPABILITIES: readonly StoreCapability[] = ['read', 'sync', 'fulfill', 'costs', 'manage', ...STORE_PERMISSIONS];

/** Roles an admin may hand out. 'owner' is absent: it is not grantable. */
export const GRANTABLE_STORE_ROLES = ['manager', 'cs', 'finance', 'viewer', 'creative'] as const;
export type GrantableStoreRole = (typeof GRANTABLE_STORE_ROLES)[number];

export function isGrantableStoreRole(v: unknown): v is GrantableStoreRole {
  return typeof v === 'string' && (GRANTABLE_STORE_ROLES as readonly string[]).includes(v);
}

export function isStorePermission(v: unknown): v is StorePermission {
  return typeof v === 'string' && (STORE_PERMISSIONS as readonly string[]).includes(v);
}

/** Known permissions only, deduplicated, in canonical order. Junk is dropped. */
export function normalizePermissions(v: unknown): StorePermission[] {
  const given = new Set(Array.isArray(v) ? v.filter(isStorePermission) : []);
  return STORE_PERMISSIONS.filter(p => given.has(p));
}

const CAPABILITIES: Record<StoreAccessLevel, readonly StoreCapability[]> = {
  owner:    ALL_STORE_CAPABILITIES,
  manager:  ['read', 'sync', 'fulfill', 'costs', 'manage'],
  cs:       ['read', 'sync', 'fulfill'],
  finance:  ['read', 'sync', 'costs'],
  viewer:   ['read'],
  creative: ['creatives.upload']
};

/** A permission that is useless without another one brings it along. */
const IMPLIES: Partial<Record<StoreCapability, readonly StoreCapability[]>> = {
  'creatives.manage': ['creatives.upload', 'creatives.view'],
  'ads.launch': ['creatives.view'],
  'facebook.manage': ['facebook.view']
};

/**
 * Everything a level grants, plus the member's extra permissions. An unknown
 * level grants nothing — not even its extra permissions (fails closed).
 */
export function capabilitiesFor(level: StoreAccessLevel, permissions: readonly string[] = []): StoreCapability[] {
  const base = Object.prototype.hasOwnProperty.call(CAPABILITIES, level) ? CAPABILITIES[level] : null;
  if (!base) return [];
  const out = new Set<StoreCapability>([...base, ...normalizePermissions(permissions)]);
  for (const c of [...out]) for (const implied of IMPLIES[c] ?? []) out.add(implied);
  return ALL_STORE_CAPABILITIES.filter(c => out.has(c));
}

export function can(
  level: StoreAccessLevel | null | undefined,
  capability: StoreCapability,
  permissions: readonly string[] = []
): boolean {
  if (!level) return false;
  return capabilitiesFor(level, permissions).includes(capability);
}

export interface ResolvedStoreAccess {
  storeId: string;
  storeDomain: string;
  /** Whoever OWNS the store — not necessarily the caller. */
  ownerId: string;
  level: StoreAccessLevel;
  /** Extra ads-side permissions from the membership; [] for the owner. */
  permissions: StorePermission[];
}

/**
 * Resolve one store for a caller, by store id or by domain.
 *
 * Returns null when the store does not exist, is inactive, or the caller has
 * neither ownership nor a membership row. Callers turn that into 404/403 —
 * this function does not know about HTTP.
 *
 * Note the ownership check runs first: an owner who is also (redundantly) a
 * member still gets full access rather than the narrower granted role.
 */
export async function resolveStoreAccess(
  userId: string,
  target: { storeId?: string; storeDomain?: string }
): Promise<ResolvedStoreAccess | null> {
  const { storeId, storeDomain } = target;
  if (!storeId && !storeDomain) return null;

  // By id: one store. By domain: the same domain can exist under several
  // owners (each merchant registers it separately), so prefer the one the
  // caller owns, then any they were granted.
  const stores = storeId
    ? await prisma.shopifyStore.findMany({ where: { id: storeId, isActive: true }, take: 1 })
    : await prisma.shopifyStore.findMany({
        where: { storeDomain: storeDomain!, isActive: true },
        orderBy: { createdAt: 'asc' }
      });
  if (stores.length === 0) return null;

  const owned = stores.find(s => s.userId === userId);
  if (owned) {
    return { storeId: owned.id, storeDomain: owned.storeDomain, ownerId: owned.userId, level: 'owner', permissions: [] };
  }

  const membership = await prisma.storeMember.findFirst({
    where: { userId, storeId: { in: stores.map(s => s.id) } }
  });
  if (!membership) return null;

  const store = stores.find(s => s.id === membership.storeId)!;
  return {
    storeId: store.id,
    storeDomain: store.storeDomain,
    ownerId: store.userId,
    level: (isGrantableStoreRole(membership.role) ? membership.role : 'viewer') as StoreAccessLevel,
    permissions: normalizePermissions(membership.permissions)
  };
}

export interface AccessibleStore {
  id: string;
  storeDomain: string;
  name: string | null;
  defaultShippingCompany: string | null;
  defaultSupplier: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Encrypted at rest; callers decide whether the caller may see it. */
  accessToken: string;
  ownerId: string;
  access: StoreAccessLevel;
  /** Extra ads-side permissions from the membership; [] for owned stores. */
  permissions: StorePermission[];
}

/**
 * Every store the user can open: the ones they own, then the ones granted.
 * Owned first so a user's own store stays the default active one.
 */
export async function listAccessibleStores(userId: string): Promise<AccessibleStore[]> {
  const [owned, memberships] = await Promise.all([
    prisma.shopifyStore.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.storeMember.findMany({
      where: { userId },
      include: { store: true },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  const ownedIds = new Set(owned.map(s => s.id));
  const rows: AccessibleStore[] = owned.map(s => ({
    id: s.id,
    storeDomain: s.storeDomain,
    name: s.name,
    defaultShippingCompany: s.defaultShippingCompany,
    defaultSupplier: s.defaultSupplier,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    accessToken: s.accessToken,
    ownerId: s.userId,
    access: 'owner',
    permissions: []
  }));

  for (const m of memberships) {
    // A grant on a store you already own, or on one that was deactivated,
    // adds nothing — skip rather than showing a duplicate/dead entry.
    if (!m.store || !m.store.isActive || ownedIds.has(m.storeId)) continue;
    rows.push({
      id: m.store.id,
      storeDomain: m.store.storeDomain,
      name: m.store.name,
      defaultShippingCompany: m.store.defaultShippingCompany,
      defaultSupplier: m.store.defaultSupplier,
      createdAt: m.store.createdAt,
      updatedAt: m.store.updatedAt,
      accessToken: m.store.accessToken,
      ownerId: m.store.userId,
      access: (isGrantableStoreRole(m.role) ? m.role : 'viewer') as StoreAccessLevel,
      permissions: normalizePermissions(m.permissions)
    });
  }

  return rows;
}
