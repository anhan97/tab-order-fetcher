import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Trash2, ExternalLink, AlertCircle, CheckCircle2, Eye, EyeOff, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/context/AppContext';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';

interface MyAppResponse {
  hasOwnApp: boolean;
  fbAppId: string | null;
  fbBmId: string | null;
  appName: string | null;
  secretFingerprint: string | null;
  isActive: boolean;
  lastError: string | null;
}

/**
 * Per-user Facebook App settings.
 *
 * Each user creates their OWN FB App at https://developers.facebook.com/apps
 * and pastes the App ID + App Secret here. We never share an App across
 * users — keeps compliance/policy violations from cascading.
 *
 * After save we call /my-app/test to verify creds against FB before they
 * try to connect. Saves a confused "why doesn't login work?" round-trip.
 */
export function MyFacebookAppCard({ onSaved }: { onSaved?: () => void }) {
  const { shopifyConfig } = useAppContext();
  const { toast } = useToast();

  const [data, setData] = useState<MyAppResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [bmId, setBmId] = useState('');
  const [appName, setAppName] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const headers = (): Record<string, string> => {
    if (!shopifyConfig) return { 'Content-Type': 'application/json' };
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    };
  };

  const load = async () => {
    if (!shopifyConfig) return;
    setLoading(true);
    try {
      const res = await fetch('/api/facebook/my-app', { headers: headers() });
      if (!res.ok) throw new Error(`${res.status}`);
      const j: MyAppResponse = await res.json();
      setData(j);
      // Pre-fill form with current values for easy editing.
      setAppId(j.fbAppId || '');
      setBmId(j.fbBmId || '');
      setAppName(j.appName || '');
      // Push appId override to SDK so subsequent connects use the user's app.
      if (j.fbAppId) FacebookAdsApiClient.configureAppId(j.fbAppId);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [shopifyConfig?.storeUrl]);

  const save = async () => {
    if (!shopifyConfig) return;
    if (!appId.trim()) {
      toast({ title: 'App ID required', variant: 'destructive' });
      return;
    }
    // Allow blank secret on edit (we'll preserve the existing one server-side
    // by omitting it from the payload when blank).
    const payload: any = { fbAppId: appId.trim(), fbBmId: bmId.trim() || null, appName: appName.trim() || null };
    if (appSecret.trim()) payload.fbAppSecret = appSecret.trim();
    else if (!data?.hasOwnApp) {
      toast({ title: 'App Secret required for first save', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/facebook/my-app', {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const j: MyAppResponse = await res.json();
      setData(j);
      setAppSecret(''); // never echo the secret back into the field
      if (j.fbAppId) FacebookAdsApiClient.configureAppId(j.fbAppId);
      toast({ title: 'Saved', description: 'Facebook App credentials saved.' });
      onSaved?.();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!shopifyConfig) return;
    setTesting(true);
    try {
      const res = await fetch('/api/facebook/my-app/test', { method: 'POST', headers: headers() });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        toast({ title: 'Test failed', description: j.error || `${res.status}`, variant: 'destructive' });
      } else {
        toast({
          title: 'Credentials valid',
          description: `FB accepted the app token (source: ${j.source}).`
        });
        await load(); // refresh lastError state
      }
    } catch (e: any) {
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!shopifyConfig) return;
    if (!confirm('Delete your FB App credentials? You\'ll fall back to the global default until you re-add.')) return;
    try {
      const res = await fetch('/api/facebook/my-app', { method: 'DELETE', headers: headers() });
      if (!res.ok) throw new Error(`${res.status}`);
      toast({ title: 'Deleted' });
      FacebookAdsApiClient.configureAppId(null);
      await load();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-500" />
            My Facebook App
          </span>
          {data?.hasOwnApp ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Own app</Badge>
          ) : (
            <Badge variant="outline">Using global fallback</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data?.hasOwnApp && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Create your <strong>own</strong> Facebook App so a policy issue on someone else's app
              can't take down your ads. Open{' '}
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">
                developers.facebook.com/apps <ExternalLink className="h-3 w-3" />
              </a>
              {' '}→ create a new "Business" app → copy the App ID + App Secret here.
            </AlertDescription>
          </Alert>
        )}

        {data?.lastError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs font-mono break-all">{data.lastError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">App name (optional)</Label>
            <Input value={appName} onChange={e => setAppName(e.target.value)} placeholder="My Adlux App" />
          </div>
          <div>
            <Label className="text-xs">Business Manager ID (optional)</Label>
            <Input value={bmId} onChange={e => setBmId(e.target.value)} placeholder="2741..." />
          </div>
          <div>
            <Label className="text-xs">App ID *</Label>
            <Input
              value={appId}
              onChange={e => setAppId(e.target.value)}
              placeholder="1234567890123456"
              className="font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">App Secret {data?.hasOwnApp && '(leave blank to keep current)'}</Label>
            <div className="flex gap-2">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={e => setAppSecret(e.target.value)}
                placeholder={data?.secretFingerprint || 'Paste from FB Developer Console'}
                className="font-mono"
              />
              <Button variant="ghost" size="icon" onClick={() => setShowSecret(s => !s)} type="button">
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {data?.hasOwnApp && data.secretFingerprint && (
              <p className="text-xs text-slate-400 mt-1 font-mono">Current: {data.secretFingerprint}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {data?.hasOwnApp ? 'Update' : 'Save'}
          </Button>
          {data?.hasOwnApp && (
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Test credentials
            </Button>
          )}
          {data?.hasOwnApp && (
            <Button variant="ghost" onClick={remove} className="ml-auto text-rose-600 hover:text-rose-700 hover:bg-rose-50">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          Required redirects in your FB App settings:{' '}
          <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{window.location.origin}</code>{' '}
          (Site URL, App Domain, Allowed Domains for the JS SDK).
          After saving, reload the page so the FB SDK initialises with your new App ID.
        </p>
      </CardContent>
    </Card>
  );
}
