
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';
import { apiFetch } from '@/utils/apiClient';
import { useAppContext } from '@/context/AppContext';

interface FacebookAdsConnectionProps {
  onConnectionSuccess: (config: { accessToken: string; adAccountId: string }) => void;
}

export function FacebookAdsConnection({ onConnectionSuccess }: FacebookAdsConnectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appIdMismatch, setAppIdMismatch] = useState<{ active: string; user: string } | null>(null);
  const [missingApp, setMissingApp] = useState(false);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  /**
   * App-level authorization failure. Distinct from missingScopes — the user
   * granted everything we asked for, but the FB App isn't approved at the
   * platform level for ads_read / ads_management on this ad account. Has 3
   * possible fixes (App Review, app role, BM share).
   */
  const [appNotAuthorized, setAppNotAuthorized] = useState<{ fbAppId: string } | null>(null);
  const { shopifyConfig } = useAppContext();

  // Legacy Shopify headers for sessions without a JWT; apiFetch adds the
  // Bearer automatically when one exists, and the backend prefers it. This
  // keeps the userId consistent with the picker flow so the token isn't
  // stored under one identity and checked under another.
  const legacyHeaders = (): Record<string, string> => {
    if (!shopifyConfig) return {};
    return {
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
  };

  // On mount: fetch the user's registered FB App and either configure the
  // SDK to use it (if SDK isn't loaded yet) or surface a "reload required"
  // notice. Without this step, clicking Connect mints a token under the
  // env-default app, then the backend tries to swap with the user's app
  // secret and FB rejects with "access token does not belong to application".
  useEffect(() => {
    if (!shopifyConfig) return;
    let cancelled = false;
    (async () => {
      try {
        const j = await apiFetch('/api/facebook/my-app', { headers: legacyHeaders() });
        if (cancelled) return;
        if (!j.fbAppId) {
          setMissingApp(true);
          return;
        }
        const active = FacebookAdsApiClient.getActiveAppId();
        if (active && active !== j.fbAppId) {
          // SDK is already loaded with a different app — page reload is the
          // only clean way to switch (FB SDK can't re-init).
          if ((window as any).FB) {
            setAppIdMismatch({ active, user: j.fbAppId });
            return;
          }
        }
        FacebookAdsApiClient.configureAppId(j.fbAppId);
      } catch {
        /* offline / backend down — let the connect attempt surface the real error */
      }
    })();
    return () => { cancelled = true; };
  }, [shopifyConfig]);

  const handleLogin = async (rerequest = false) => {
    setIsLoading(true);
    setError(null);
    setMissingScopes([]);
    setAppNotAuthorized(null);

    try {
      // Re-check user app id right before login so a recent app-credential
      // edit takes effect without forcing a manual reload.
      if (shopifyConfig) {
        try {
          const j = await apiFetch('/api/facebook/my-app', { headers: legacyHeaders() });
          const active = FacebookAdsApiClient.getActiveAppId();
          if (j.fbAppId && active && active !== j.fbAppId && (window as any).FB) {
            setAppIdMismatch({ active, user: j.fbAppId });
            setIsLoading(false);
            return;
          }
          if (j.fbAppId) FacebookAdsApiClient.configureAppId(j.fbAppId);
        } catch { /* fall through */ }
      }

      const client = FacebookAdsApiClient.getInstance();
      const { accessToken: shortLivedToken } = await client.login({ rerequest });

      // After SDK login, fetch ad accounts list using the short-lived token
      // (one-time use; we won't keep this token around).
      const accounts = await client.getAdAccounts();
      if (accounts.length === 0) {
        throw new Error('No Facebook Ad accounts found. Please make sure you have access to at least one ad account.');
      }

      // SECURITY: send the short-lived token to backend over HTTPS *body*
      // (not URL/query). Backend exchanges to long-lived (~60 days) and
      // stores AES-encrypted in DB. The frontend never persists or re-uses
      // the raw token after this — subsequent calls go through cookie/auth
      // resolution server-side.
      if (!shopifyConfig) {
        throw new Error('Connect Shopify first so we can identify your account.');
      }
      await apiFetch('/api/facebook/connect', {
        method: 'POST',
        headers: legacyHeaders(),
        body: JSON.stringify({
          token: shortLivedToken,
          // Tell the backend which app minted this token — exchanging it
          // against the user's default app fails when they differ.
          fbAppId: FacebookAdsApiClient.getActiveAppId() || undefined,
          adAccounts: accounts.map(a => ({ id: a.id, name: a.name }))
        })
      });

      // Wipe legacy localStorage entries so old code paths don't pick up
      // a stale token. Token now lives ONLY in DB.
      try {
        localStorage.removeItem('facebook_access_token');
        localStorage.removeItem('facebook_user_id');
      } catch { /* ignore */ }

      // Notify parent. accessToken is now empty — kept in the type for
      // back-compat but the UI no longer relies on it.
      const firstAccount = accounts[0];
      onConnectionSuccess({
        accessToken: '',  // intentionally empty — DB is source of truth
        adAccountId: firstAccount.id
      });
    } catch (error: any) {
      console.error('Facebook login error:', error);
      // Scope-missing error from client.login → drives the dedicated UI below
      // with a "Reconnect & grant permissions" button (auth_type=rerequest).
      if (error?.code === 'missing_scopes' && Array.isArray(error.missingScopes)) {
        setMissingScopes(error.missingScopes);
        return;
      }
      // App-not-authorized error from getAdAccounts → user granted everything
      // but FB rejects the actual ads call because the app isn't whitelisted
      // for ads_read/ads_management on the target ad account.
      if (error?.code === 'app_not_authorized_for_ads') {
        setAppNotAuthorized({ fbAppId: FacebookAdsApiClient.getActiveAppId() });
        return;
      }
      const raw = error instanceof Error ? error.message : 'Failed to connect to Facebook';
      // Translate FB's cryptic "access token does not belong to application X"
      // into the actual user-actionable advice — this is the #1 source of
      // confused support tickets in mixed-app environments.
      const friendlier = /does not belong to application/i.test(raw)
        ? 'The Facebook login token was minted under a different App ID than the one you registered. Click "Reload page" below, then sign in again.'
        : raw;
      setError(friendlier);
    } finally {
      setIsLoading(false);
    }
  };

  const reloadPage = () => window.location.reload();

  return (
    <div className="space-y-4">
      {missingApp && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You haven't registered a Facebook App yet. Open the <strong>FB App</strong> tab above, paste your App ID + App Secret from{' '}
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a>, then come back.
          </AlertDescription>
        </Alert>
      )}

      {appIdMismatch && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              The Facebook SDK already loaded with App ID <code className="font-mono">{appIdMismatch.active}</code>, but your registered app is <code className="font-mono">{appIdMismatch.user}</code>.
              Logging in now would mint a token tied to the wrong app and FB would reject it on the backend exchange.
            </p>
            <Button size="sm" variant="outline" onClick={reloadPage}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reload page to switch apps
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {missingScopes.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              Facebook didn't grant the permissions we need: <code className="font-mono">{missingScopes.join(', ')}</code>.
              The consent dialog let you untick them — sign in again and leave <strong>every checkbox checked</strong>.
            </p>
            <Button size="sm" variant="outline" onClick={() => handleLogin(true)} disabled={isLoading}>
              <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
              Reconnect & grant permissions
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {appNotAuthorized && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="space-y-3">
            <div>
              <p className="font-semibold">Facebook App not authorized for ads access</p>
              <p className="text-sm mt-1">
                You signed in successfully and granted permissions, but FB still rejects ad-account API calls with
                {' '}<code className="font-mono text-xs">"Ad account owner has NOT grant ads_management or ads_read"</code>.
                That's an <strong>app-level</strong> issue, not a user-permission issue. Pick the fix that matches your setup:
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="border-l-2 border-rose-300 pl-3">
                <p className="font-medium">1. App not approved for ads scopes (most common)</p>
                <p className="text-xs mt-0.5">
                  New FB Apps need <strong>Advanced Access</strong> for <code>ads_read</code> + <code>ads_management</code> on{' '}
                  <a href={`https://developers.facebook.com/apps/${appNotAuthorized.fbAppId}/app-review/permissions/`} target="_blank" rel="noopener noreferrer" className="underline font-mono">
                    App Review → Permissions and Features
                  </a>.
                </p>
              </div>

              <div className="border-l-2 border-rose-300 pl-3">
                <p className="font-medium">2. You're not a Developer / Tester of the app</p>
                <p className="text-xs mt-0.5">
                  Add yourself in{' '}
                  <a href={`https://developers.facebook.com/apps/${appNotAuthorized.fbAppId}/roles/roles/`} target="_blank" rel="noopener noreferrer" className="underline">
                    App Roles
                  </a>{' '}
                  as Admin, Developer, or Tester. Standard Access works for these roles even before App Review.
                </p>
              </div>

              <div className="border-l-2 border-rose-300 pl-3">
                <p className="font-medium">3. Ad account is in a Business Manager that hasn't shared with this app</p>
                <p className="text-xs mt-0.5">
                  Open{' '}
                  <a href="https://business.facebook.com/settings/apps/" target="_blank" rel="noopener noreferrer" className="underline">
                    business.facebook.com/settings/apps
                  </a>
                  {' '}→ Add app <code className="font-mono">{appNotAuthorized.fbAppId}</code>, then assign it to the ad account with
                  ads-management permission.
                </p>
              </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => handleLogin(false)} disabled={isLoading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              I fixed it — try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error && !appIdMismatch && missingScopes.length === 0 && !appNotAuthorized && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            {/does not belong to application/i.test(error) && (
              <Button size="sm" variant="outline" onClick={reloadPage}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Reload page
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={() => handleLogin(false)}
        disabled={isLoading || missingApp || !!appIdMismatch || !!appNotAuthorized}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect Facebook Ads'
        )}
      </Button>
    </div>
  );
}
