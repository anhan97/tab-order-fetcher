/**
 * What the signed-in user may do in the creative library of the active store.
 * Mirrors backend/src/routes/creatives.routes.ts (the server stays the judge):
 *
 *   creatives.upload — upload; edit / archive their own, delete them while unused
 *   creatives.view   — see the whole library and the posts
 *   creatives.manage — edit / archive / delete anyone's
 *   ads.launch       — pick creatives and launch them
 */
import type { CreativeDto } from '@contract/ads-launcher';
import { useAuth, type StoreCapability } from '@/context/AuthContext';

export interface CreativePerms {
  upload: boolean;
  /** The whole library (and posts); without it only the user's own creatives come back. */
  viewAll: boolean;
  launch: boolean;
  /** Edit copy, archive, restore. */
  canChange: (c: CreativeDto) => boolean;
  canDelete: (c: CreativeDto) => boolean;
}

export function creativePerms(userId: string | null | undefined, can: (c: StoreCapability) => boolean): CreativePerms {
  const manageAll = can('creatives.manage');
  const upload = can('creatives.upload');
  const mine = (c: CreativeDto) => !!userId && c.createdBy === userId;
  return {
    upload,
    viewAll: can('creatives.view'),
    launch: can('ads.launch'),
    canChange: c => manageAll || (upload && mine(c)),
    canDelete: c => manageAll || (upload && mine(c) && c.adsCount === 0)
  };
}

export function useCreativePerms(): CreativePerms {
  const { user, canInStore } = useAuth();
  return creativePerms(user?.id, canInStore);
}
