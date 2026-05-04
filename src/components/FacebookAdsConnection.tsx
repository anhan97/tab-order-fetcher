
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';
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
  const { shopifyConfig } = useAppContext();

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
        const res = await fetch('/api/facebook/my-app', {
          headers: {
            'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            'X-Shopify-Access-Token': shopifyConfig.accessToken
          }
        });
        if (cancelled) return;
        if (!res.ok) return;
        const j = await res.json();
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

    try {
      // Re-check user app id right before login so a recent app-credential
      // edit takes effect without forcing a manual reload.
      if (shopifyConfig) {
        try {
          const r = await fetch('/api/facebook/my-app', {
            headers: {
              'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
              'X-Shopify-Access-Token': shopifyConfig.accessToken
            }
          });
          if (r.ok) {
            const j = await r.json();
            const active = FacebookAdsApiClient.getActiveAppId();
            if (j.fbAppId && active && active !== j.fbAppId && (window as any).FB) {
              setAppIdMismatch({ active, user: j.fbAppId });
              setIsLoading(false);
              return;
            }
            if (j.fbAppId) FacebookAdsApiClient.configureAppId(j.fbAppId);
          }
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
      const connectRes = await fetch('/api/facebook/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
          'X-Shopify-Access-Token': shopifyConfig.accessToken
        },
        body: JSON.stringify({
          token: shortLivedToken,
          adAccounts: accounts.map(a => ({ id: a.id, name: a.name }))
        })
      });
      if (!connectRes.ok) {
        const err = await connectRes.json().catch(() => ({}));
        throw new Error(err.error || `Connect failed: ${connectRes.status}`);
      }

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

      {error && !appIdMismatch && missingScopes.length === 0 && (
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
        disabled={isLoading || missingApp || !!appIdMismatch}
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
