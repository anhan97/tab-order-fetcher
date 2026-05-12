/**
 * Setup flow for non-admin users on /facebook.
 *
 * Lists every FB App the user can connect through (their own apps + apps
 * the admin has assigned via FacebookAppUserAccess) and provides a
 * Connect button per app. Picking one drives FB Login through that
 * specific app's credentials.
 *
 * Why one component handles both admin and user cases: admins almost
 * always have own apps and use this same flow; non-admins reach it via
 * pivot. Single code path = no divergent UI bugs.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, LogIn, AlertCircle, ShieldAlert, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/utils/apiClient';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';

interface AvailableApp {
  appRowId: string;
  fbAppId: string;
  fbBmId: string | null;
  appName: string | null;
  isActive: boolean;
  isOwn: boolean;
  isDefault: boolean;
  ownerUserId: string;
  ownerEmail: string | null;
}

export function AvailableAppsPicker({
  onConnectionSuccess
}: {
  onConnectionSuccess: (config: { accessToken: string; adAccountId: string }) => void;
}) {
  const { toast } = useToast();
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ apps: AvailableApp[] }>('/api/facebook/available-apps');
      setApps(r.apps);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const connect = async (app: AvailableApp) => {
    const activeAppId = FacebookAdsApiClient.getActiveAppId();
    const sdkLoaded = !!(window as any).FB;

    // FB SDK is locked to one App ID per page load. If a different app's
    // SDK is already initialised, we must reload after pointing the
    // configureAppId at the new app — otherwise Login fires against the
    // wrong app and FB returns "app does not exist" / 190.
    if (sdkLoaded && activeAppId && activeAppId !== app.fbAppId) {
      if (!confirm(
        `Facebook SDK is loaded with app ${activeAppId}. Switch to ${app.fbAppId} ` +
        `(${app.appName || 'unnamed'}) and reload?`
      )) return;
      FacebookAdsApiClient.configureAppId(app.fbAppId);
      window.location.reload();
      return;
    }

    setConnecting(app.fbAppId);
    try {
      FacebookAdsApiClient.configureAppId(app.fbAppId);
      const client = FacebookAdsApiClient.getInstance();
      const { accessToken } = await client.login({ rerequest: false });
      // Persist the long-lived token server-side. Backend resolves App
      // Secret via resolveForUser → consults pivot for non-admins.
      await apiFetch('/api/facebook/connections', {
        method: 'POST',
        body: JSON.stringify({ token: accessToken, fbAppId: app.fbAppId })
      });
      toast({ title: 'Connected', description: `Linked to ${app.appName || app.fbAppId}` });
      // Reload accounts list — the caller's onConnectionSuccess handler
      // typically calls into AppContext.handleFacebookConnectionSuccess.
      onConnectionSuccess({ accessToken, adAccountId: '' });
    } catch (e: any) {
      toast({ title: 'Connect failed', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setConnecting(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-10 flex items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading available apps…
        </CardContent>
      </Card>
    );
  }

  if (apps.length === 0) {
    return (
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-1">
                Tài khoản chưa được cấp Facebook App
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">
                Liên hệ <strong>admin</strong> để được cấp quyền sử dụng một
                Facebook App. Admin sẽ vào <strong>/admin → tab FB Apps</strong>,
                chọn app rồi bấm <strong>Users</strong> để thêm bạn vào danh sách
                được phép connect. Sau khi được cấp, F5 lại trang này và nút
                <em> Connect</em> sẽ hiện ra.
              </p>
            </div>
          </div>
          <Alert className="border-slate-200 bg-white">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs text-slate-600">
              Vì sao cần cấp app: mỗi user dùng chung 1 FB App của admin để
              tránh mỗi người tự register app riêng (rủi ro chính sách + khó
              quản lý). Admin giữ App Secret; bạn chỉ cần login Facebook qua app
              đó để hệ thống lấy được access token.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Pre-pick: own default app first, else the first assigned app. The
  // picker keeps full list visible when there are multiple, but the
  // "default" badge calls out the recommended one.
  const recommended = apps.find(a => a.isDefault) || apps[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LogIn className="h-4 w-4" />
          Connect Facebook
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">
          {apps.length === 1
            ? <>Bấm <strong>Connect</strong> để liên kết tài khoản Facebook qua app này.</>
            : <>{apps.length} apps đã được cấp — chọn app để connect (gợi ý: <strong>{recommended.appName || recommended.fbAppId}</strong>).</>}
        </p>
        {apps.map(app => (
          <div
            key={app.appRowId}
            className={`border rounded-lg p-3 flex items-center gap-3 ${
              app.appRowId === recommended.appRowId
                ? 'border-blue-300 bg-blue-50/40'
                : 'border-slate-200'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">
                  {app.appName || `App ${app.fbAppId}`}
                </span>
                {app.isOwn ? (
                  <Badge className="bg-slate-100 text-slate-700">your app</Badge>
                ) : (
                  <Badge className="bg-blue-100 text-blue-700">assigned</Badge>
                )}
                {app.isDefault && (
                  <Badge className="bg-amber-100 text-amber-700 gap-1">
                    <Star className="h-3 w-3 fill-current" /> default
                  </Badge>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">
                ID: {app.fbAppId}
                {app.ownerEmail && !app.isOwn && (
                  <span className="ml-2 text-slate-400">· managed by {app.ownerEmail}</span>
                )}
              </div>
            </div>
            <Button
              onClick={() => connect(app)}
              disabled={connecting !== null}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {connecting === app.fbAppId
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <LogIn className="h-4 w-4 mr-2" />}
              Connect
            </Button>
          </div>
        ))}
        <Alert className="border-blue-200 bg-blue-50/40">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Your FB token gets exchanged for a 60-day long-lived token and
            auto-refreshes daily. To disconnect, return here after logging in.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
