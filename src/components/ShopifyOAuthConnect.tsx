/**
 * OAuth app-install connect (ShipBob-style): user enters the shop domain,
 * backend returns the Shopify authorize URL, browser redirects there. After
 * the merchant approves, Shopify calls our backend callback which stores the
 * token (encrypted), registers webhooks, kicks the initial order sync, and
 * redirects back to /connect?status=connected.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Store, AlertCircle, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';

export function ShopifyOAuthConnect() {
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Đã có app hệ thống (admin cấu hình) chưa — nếu chưa, chặn nút + báo liên hệ admin.
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    apiFetch<{ configured: boolean }>('/api/shopify/oauth/status')
      .then(r => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, []);

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
      // Full-page redirect to Shopify's consent screen.
      window.location.href = r.installUrl;
    } catch (e: any) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  };

  if (configured === false) {
    return (
      <Alert className="border-amber-200 bg-amber-50/50">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm text-slate-700">
          Hệ thống chưa cấu hình Shopify App. Vui lòng liên hệ <strong>admin</strong> để cài đặt
          (Admin → Shopify App). Sau khi admin cấu hình xong, F5 lại trang này là kết nối được.
        </AlertDescription>
      </Alert>
    );
  }

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
            disabled={busy || configured === null}
          />
        </div>
        <Button onClick={begin} disabled={busy || configured === null || !shop.trim()} className="bg-teal-600 hover:bg-teal-700">
          {busy || configured === null ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Store className="h-4 w-4 mr-1.5" />}
          Kết nối qua Shopify
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Bạn sẽ được chuyển sang Shopify để cấp quyền cho app (không cần copy token thủ công).
        Sau khi bấm <em>Install</em>, hệ thống tự lưu kết nối, đăng ký webhook và đồng bộ đơn hàng.
      </p>
    </div>
  );
}
