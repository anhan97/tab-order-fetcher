/**
 * Who sees which page, and what each grantable permission means — shared by
 * the sidebar, the route gates and the admin's Store access dialog.
 *
 * The server decides (backend/src/lib/store-access.ts, mirrored here — keep
 * the two in step); this only keeps the UI from offering what would 403.
 */
import type { StoreCapability, StorePermission } from '@/context/AuthContext';

/** System role (User.role). */
export type AppRole = 'admin' | 'user' | 'cs' | 'finance';

// ─── Store roles + permissions (admin's Store access dialog) ────────────────

export const STORE_ROLES = ['manager', 'cs', 'finance', 'viewer', 'creative'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

/** One line each, so the admin picks a role without reading the source. */
export const ROLE_HELP: Record<StoreRole, string> = {
  manager: 'Orders, fulfillment, costs and store settings. Ads features only if ticked below.',
  cs: 'View orders, plus work them: status, tracking, export',
  finance: 'View orders, plus edit costs: COGS, pricebooks, operating costs',
  viewer: 'Read-only: orders, P&L, costs',
  creative: 'Creatives only: upload, and edit their own. No orders, no P&L.'
};

/** Permissions a role carries by itself — mirrors CAPABILITIES in store-access.ts. */
export const ROLE_PERMISSIONS: Record<StoreRole, readonly StorePermission[]> = {
  manager: [],
  cs: [],
  finance: [],
  viewer: [],
  creative: ['creatives.upload']
};

export interface PermissionInfo {
  id: StorePermission;
  label: string;
  help: string;
}

export const PERMISSION_GROUPS: Array<{ label: string; items: PermissionInfo[] }> = [
  {
    label: 'Creatives',
    items: [
      { id: 'creatives.upload', label: 'Upload creatives', help: 'Upload, and edit / archive their own. Sees only their own unless "See all creatives" is on.' },
      { id: 'creatives.view', label: 'See all creatives', help: 'The whole creative library and the Posts tab' },
      { id: 'creatives.manage', label: 'Manage all creatives', help: "Edit, archive and delete anyone's creatives" }
    ]
  },
  {
    label: 'Ads',
    items: [{ id: 'ads.launch', label: 'Launch ads', help: 'Ads Launcher and presets; picks from the whole library' }]
  },
  {
    label: 'Facebook',
    items: [
      { id: 'facebook.view', label: 'See Facebook', help: 'Ad accounts, campaigns, spend and the Content page' },
      { id: 'facebook.manage', label: 'Map campaigns', help: 'Assign campaigns to this store and recompute its ad spend' }
    ]
  },
  {
    label: 'Finance',
    items: [
      { id: 'fees.view', label: 'See payment fees', help: 'Gateway fees and profit after them. Without it, profit is shown before payment fees.' }
    ]
  }
];

export const PERMISSION_LABEL: Record<StorePermission, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))
) as Record<StorePermission, string>;

/** A permission useless without another brings it along — mirrors IMPLIES in store-access.ts. */
export const PERMISSION_IMPLIES: Partial<Record<StorePermission, readonly StorePermission[]>> = {
  'creatives.manage': ['creatives.upload', 'creatives.view'],
  'ads.launch': ['creatives.view'],
  'facebook.manage': ['facebook.view']
};

/** Permissions in effect for a member: the role's own, the granted ones, and what they imply. */
export function effectivePermissions(role: StoreRole, granted: readonly StorePermission[]): Set<StorePermission> {
  const out = new Set<StorePermission>([...(ROLE_PERMISSIONS[role] ?? []), ...granted]);
  for (const p of [...out]) for (const implied of PERMISSION_IMPLIES[p] ?? []) out.add(implied);
  return out;
}

/** Why a permission is on without being ticked (the role, or another permission), or null. */
export function impliedBy(role: StoreRole, granted: readonly StorePermission[], p: StorePermission): string | null {
  if (ROLE_PERMISSIONS[role]?.includes(p)) return `included in ${role}`;
  const by = granted.find(g => g !== p && PERMISSION_IMPLIES[g]?.includes(p));
  return by ? `included in "${PERMISSION_LABEL[by]}"` : null;
}

// ─── Pages ──────────────────────────────────────────────────────────────────

/** System roles that see each page in the sidebar. */
export const PAGE_ROLES: Record<string, readonly AppRole[]> = {
  '/orders': ['admin', 'user', 'cs', 'finance'],
  '/fulfillment': ['admin', 'user', 'cs'],
  '/tracking': ['admin', 'user', 'cs'],
  '/connect': ['admin', 'user', 'cs', 'finance'],
  '/cogs': ['admin', 'user', 'finance'],
  '/facebook': ['admin', 'user'],
  '/creatives': ['admin', 'user'],
  '/ads-launcher': ['admin', 'user'],
  '/content': ['admin', 'user'],
  '/admin': ['admin']
};

/** What a page needs in the active store — any one of the list. */
export const PAGE_ACCESS: Record<string, readonly StoreCapability[]> = {
  '/orders': ['read'],
  '/fulfillment': ['read'],
  '/tracking': ['read'],
  '/cogs': ['read'],
  '/facebook': ['facebook.view'],
  '/content': ['facebook.view'],
  '/creatives': ['creatives.view', 'creatives.upload'],
  '/ads-launcher': ['ads.launch']
};

/** Where "/" lands: the first of these the user may open. */
export const HOME_ORDER = ['/orders', '/creatives', '/ads-launcher', '/facebook', '/connect'] as const;

/** Does the active store allow this page? Pages that need nothing always pass. */
export function storeAllowsPage(path: string, canInStore: (c: StoreCapability) => boolean): boolean {
  const need = PAGE_ACCESS[path];
  return !need || need.some(c => canInStore(c));
}

/**
 * Sidebar rule. Admins see every page. Everyone else needs their system role
 * on the page and, for store pages, the capability in the active store — with
 * no active store only the pages that need none (Stores) show.
 */
export function canOpenPage(path: string, role: AppRole, canInStore: (c: StoreCapability) => boolean): boolean {
  if (role === 'admin') return true;
  const roles = PAGE_ROLES[path];
  if (roles && !roles.includes(role)) return false;
  return storeAllowsPage(path, canInStore);
}

export function homePath(role: AppRole, canInStore: (c: StoreCapability) => boolean): string {
  return HOME_ORDER.find(p => canOpenPage(p, role, canInStore)) ?? '/connect';
}
