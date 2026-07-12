/**
 * Admin-only: the ONE global Shopify App (OAuth) the whole system connects
 * stores through (shipbro-style). Admin dán Client ID + Secret ở đây; mọi
 * user "Kết nối qua Shopify" dùng app này. Secret mã hoá ở backend.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AppWindow, Loader2, Save, Trash2, Info } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

interface AppInfo { clientId: string; secretLength: number; updatedAt: string; }

export function ShopifyAppConfigCard() {
  const { toast } = useToast();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [envFallback, setEnvFallback] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');
  const [scopes, setScopes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ app: AppInfo | null; envFallback: boolean; redirectUri: string; scopes: string }>('/api/admin/shopify-app');
      setApp(r.app);
      setEnvFallback(r.envFallback);
      setRedirectUri(r.redirectUri);
      setScopes(r.scopes);
      setEditing(!r.app);
      if (r.app) setClientId(r.app.clientId);
    } catch (e: any) {
      toast({ title: 'Không tải được cấu hình', description: e?.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/admin/shopify-app', {
        method: 'PUT',
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      });
      toast({ title: 'Đã lưu Shopify App hệ thống' });
      setClientSecret('');
      setEditing(false);
      await load();
    } catch (e: any) {
      toast({ title: 'Lưu thất bại', description: e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm('Xoá cấu hình Shopify App hệ thống? Người dùng sẽ không kết nối được store mới cho tới khi cấu hình lại.')) return;
    try {
      await apiFetch('/api/admin/shopify-app', { method: 'DELETE' });
      setApp(null);
      setEditing(true);
      await load();
    } catch (e: any) {
      toast({ title: 'Xoá thất bại', description: e?.message, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="p-6 flex items-center text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Đang tải cấu hình Shopify App…
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AppWindow className="h-4 w-4 text-teal-600" />
          Shopify App (OAuth hệ thống)
          {app && <Badge className="bg-emerald-100 text-emerald-700">đã cấu hình</Badge>}
          {!app && envFallback && <Badge className="bg-slate-100 text-slate-600">đang dùng env</Badge>}
          {!app && !envFallback && <Badge className="bg-amber-100 text-amber-700">chưa cấu hình</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {app && !editing ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm">{app.clientId}</div>
              <div className="text-xs text-slate-500">Secret: {'•'.repeat(8)} ({app.secretLength} ký tự)</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Sửa</Button>
              <Button variant="ghost" size="sm" className="text-rose-600" onClick={remove}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-2">
              <Input placeholder="Client ID (API key)" value={clientId} onChange={e => setClientId(e.target.value)} />
              <Input placeholder="Client Secret (API secret key)" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving || !clientId.trim() || !clientSecret.trim()} size="sm" className="bg-teal-600 hover:bg-teal-700">
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Lưu app
              </Button>
              {app && <Button variant="outline" size="sm" onClick={() => { setEditing(false); setClientSecret(''); }}>Huỷ</Button>}
            </div>
          </>
        )}

        <Alert className="border-blue-200 bg-blue-50/40">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs space-y-1">
            <p>
              Tạo <strong>1 app duy nhất</strong> ở{' '}
              <a href="https://partners.shopify.com" target="_blank" rel="noopener noreferrer" className="underline">partners.shopify.com</a>{' '}
              (chọn <strong>Public distribution</strong> để cài được nhiều store), lấy Client ID + Secret dán vào đây.
              Mọi user trong hệ thống sẽ kết nối store của họ qua app này.
            </p>
            {redirectUri && (
              <p>Khai <strong>Allowed redirection URL</strong> trong app: <code className="bg-white px-1 rounded break-all">{redirectUri}</code></p>
            )}
            {scopes && <p>Scopes cần cấp: <code className="bg-white px-1 rounded">{scopes}</code></p>}
            <p className="text-amber-700">
              Lưu ý: để đọc được tên/địa chỉ/SĐT khách, app phải được Shopify duyệt
              <strong> Protected customer data access</strong> (Partner Dashboard → API access).
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
