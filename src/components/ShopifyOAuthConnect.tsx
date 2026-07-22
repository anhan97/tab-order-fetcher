/**
 * OAuth app-install connect — PER-STORE apps: each store is connected through
 * its own Shopify App (unpublished apps only install on stores in the same
 * org). The user registers Client ID + Secret for the shop here, then clicks
 * Connect; the backend returns the Shopify authorize URL and the browser
 * redirects. After the merchant approves, our callback stores the token
 * (encrypted), registers webhooks, kicks the initial sync, and returns to
 * /connect?status=connected. The global/env app still acts as a fallback.
 */
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Store, AlertCircle, KeyRound, Trash2, Copy, Check, ChevronDown } from 'lucide-react';
import { apiFetch, ApiError } from '@/utils/apiClient';

interface UserApp {
  id: string;
  shopDomain: string | null;
  clientId: string;
  label: string | null;
  secretLength: number;
}
interface AppsResp {
  apps: UserApp[];
  redirectUri: string;
  scopes: string;
  hasFallback: boolean;
}

export function ShopifyOAuthConnect() {
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apps, setApps] = useState<UserApp[]>([]);
  const [redirectUri, setRedirectUri] = useState('');
  const [scopes, setScopes] = useState('');
  const [hasFallback, setHasFallback] = useState(false);

  const [showAppForm, setShowAppForm] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savingApp, setSavingApp] = useState(false);
  const [appMsg, setAppMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadApps = useCallback(async () => {
    try {
      const r = await apiFetch<AppsResp>('/api/shopify/oauth/apps');
      setApps(r.apps);
      setRedirectUri(r.redirectUri);
      setScopes(r.scopes);
      setHasFallback(r.hasFallback);
    } catch {
      /* non-fatal — the connect button still works via fallback */
    }
  }, []);

  useEffect(() => { void loadApps(); }, [loadApps]);

  const saveApp = async () => {
    if (!shop.trim()) { setAppMsg('Nhập shop domain ở ô trên trước.'); return; }
    if (!clientId.trim() || !clientSecret.trim()) { setAppMsg('Nhập đủ Client ID và Client Secret.'); return; }
    setSavingApp(true);
    setAppMsg(null);
    setError(null);
    try {
      await apiFetch('/api/shopify/oauth/app', {
        method: 'PUT',
        body: JSON.stringify({ shopDomain: shop.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      });
      setClientSecret('');
      setAppMsg('Đã lưu app cho store này. Giờ bấm "Kết nối qua Shopify".');
      await loadApps();
    } catch (e: any) {
      setAppMsg(e?.message || String(e));
    } finally {
      setSavingApp(false);
    }
  };

  const deleteApp = async (id: string) => {
    try {
      await apiFetch(`/api/shopify/oauth/app/${id}`, { method: 'DELETE' });
      await loadApps();
    } catch { /* ignore */ }
  };

  const begin = async () => {
    const value = shop.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ installUrl: string }>('/api/shopify/oauth/begin', {
        method: 'POST',
        body: JSON.stringify({ shop: value })
      });
      window.location.href = r.installUrl;
    } catch (e: any) {
      if (e instanceof ApiError && e.body?.code === 'no_app_for_shop') {
        setShowAppForm(true);
        setError('Store này chưa có Shopify App. Nhập Client ID + Secret bên dưới, lưu, rồi kết nối lại.');
      } else {
        setError(e?.message || String(e));
      }
      setBusy(false);
    }
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  };

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Store className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ten-store hoặc ten-store.myshopify.com"
            value={shop}
            onChange={e => setShop(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void begin(); }}
            className="pl-9"
            disabled={busy}
          />
        </div>
        <Button onClick={begin} disabled={busy || !shop.trim()} className="bg-teal-600 hover:bg-teal-700">
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Store className="h-4 w-4 mr-1.5" />}
          Kết nối qua Shopify
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Mỗi store cần <strong>Shopify App riêng</strong>. Nhập shop domain ở trên, đăng ký app cho nó
        (bên dưới), rồi bấm kết nối — bạn sẽ được chuyển sang Shopify để cấp quyền.
      </p>

      {/* Toggle app-registration panel */}
      <button
        type="button"
        onClick={() => setShowAppForm(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800"
      >
        <KeyRound className="h-3.5 w-3.5" />
        App Shopify cho store này
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAppForm ? 'rotate-180' : ''}`} />
      </button>

      {showAppForm && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
          <div className="text-xs text-slate-600 space-y-1">
            <p>Tạo app trong <strong>Shopify Partner → Apps</strong>, rồi khai vào app:</p>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0">Allowed redirection URL:</span>
              <code className="flex-1 truncate rounded bg-white px-1.5 py-0.5 border border-slate-200 text-[11px]">{redirectUri || '…'}</code>
              <button type="button" onClick={copyRedirect} className="text-slate-400 hover:text-slate-600" title="Copy">
                {copied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p>Scopes cần cấp: <code className="rounded bg-white px-1 border border-slate-200 text-[11px]">{scopes || 'read_orders,write_orders,read_products,read_customers'}</code></p>
          </div>

          <Input
            placeholder="Client ID (API key)"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            disabled={savingApp}
          />
          <Input
            placeholder="Client Secret (API secret key)"
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            disabled={savingApp}
          />
          {appMsg && <p className="text-xs text-slate-600">{appMsg}</p>}
          <Button onClick={saveApp} disabled={savingApp} size="sm" variant="outline" className="w-full">
            {savingApp ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
            Lưu app cho {shop.trim() || 'store'}
          </Button>
        </div>
      )}

      {/* Registered apps */}
      {apps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500">App đã đăng ký</p>
          {apps.map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
              <Store className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700">{a.shopDomain || '(app mặc định)'}</span>
              <span className="text-slate-400 truncate">· {a.clientId.slice(0, 8)}…</span>
              <button
                type="button"
                onClick={() => deleteApp(a.id)}
                className="ml-auto text-slate-400 hover:text-red-600 shrink-0"
                title="Xoá app"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {hasFallback && apps.length === 0 && (
        <p className="text-[11px] text-slate-400">
          Đang có app hệ thống (fallback) — bạn vẫn kết nối được mà chưa cần đăng ký app riêng,
          nhưng nên đăng ký app riêng cho mỗi store để quản lý độc lập.
        </p>
      )}
    </div>
  );
}
