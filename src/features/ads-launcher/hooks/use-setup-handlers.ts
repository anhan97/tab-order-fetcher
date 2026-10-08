/**
 * Setup events shared by the wizard and Quick launch: picking a landing page
 * fills store, URL and display link (hostname); typing a URL keeps the select
 * in sync (§3.2 step 1).
 */
import { useMemo, type Dispatch } from 'react';
import { CUSTOM_LANDING, displayLinkFor, findLanding, landingById, type LandingGroup } from '../lib/landing';
import type { LaunchSetup } from '../lib/structure';
import type { WizardAction, WizardState } from '../lib/wizard-state';

export function useSetupHandlers(state: WizardState, dispatch: Dispatch<WizardAction>, groups: LandingGroup[]) {
  const { storeId, displayLink, landingUrl } = state.setup;
  return useMemo(
    () => ({
      onSetup: (patch: Partial<LaunchSetup>) => dispatch({ type: 'setup', patch }),
      onAccount: (adAccountId: string) => dispatch({ type: 'account', adAccountId }),
      onProduct: (productId: string) => dispatch({ type: 'product', productId }),
      onLanding: (landingId: string) => {
        if (landingId === CUSTOM_LANDING) {
          dispatch({ type: 'landing', landingId: CUSTOM_LANDING });
          return;
        }
        const item = landingById(groups, landingId);
        if (item) dispatch({ type: 'landing', landingId: item.id, url: item.url, storeId: item.storeId, displayLink: displayLinkFor(item.url) });
      },
      onLandingUrl: (url: string) => {
        const hit = findLanding(groups, url, storeId);
        // The display link follows the URL's hostname until the user types their own.
        const followsUrl = !displayLink || displayLink === displayLinkFor(landingUrl);
        dispatch({
          type: 'landing',
          landingId: hit ? hit.id : CUSTOM_LANDING,
          url,
          ...(hit ? { storeId: hit.storeId } : {}),
          ...(followsUrl ? { displayLink: displayLinkFor(url) } : {})
        });
      }
    }),
    [dispatch, groups, storeId, displayLink, landingUrl]
  );
}
