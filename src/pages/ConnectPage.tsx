import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { ShopifyOAuthConnect } from '@/components/ShopifyOAuthConnect';
import { Button } from '@/components/ui/button';
import { Store, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const ConnectPage = () => {
    const { stores, activeStore, addStore, removeStore, setActiveStoreByDomain, refreshStores } = useAuth();
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [busy, setBusy] = useState<string | null>(null);

    // Landing back from the Shopify OAuth callback:
    //   ?status=connected&shop=…  → refresh list, activate the new store
    //   ?status=error&reason=…    → surface the failure
    useEffect(() => {
        const status = searchParams.get('status');
        if (!status) return;
        const shop = searchParams.get('shop');
        const reason = searchParams.get('reason');
        setSearchParams({}, { replace: true });
        if (status === 'connected' && shop) {
            (async () => {
                await refreshStores();
                setActiveStoreByDomain(shop);
                toast({ title: 'Đã kết nối store qua Shopify', description: `${shop} — đơn hàng đang được đồng bộ nền.` });
            })();
        } else if (status === 'error') {
            toast({
                title: 'Kết nối Shopify thất bại',
                description: `Lý do: ${reason || 'không rõ'}. Thử lại hoặc dùng cách dán token bên dưới.`,
                variant: 'destructive'
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleConnectionSuccess = async (config: { storeUrl: string; accessToken: string }) => {
        try {
            await addStore(config.storeUrl, config.accessToken);
            const cleanDomain = config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            setActiveStoreByDomain(cleanDomain);
            toast({ title: 'Đã thêm store', description: cleanDomain });
        } catch (e: any) {
            toast({ title: 'Failed to save store', description: e?.message || String(e), variant: 'destructive' });
        }
    };

    const handleRemove = async (id: string, label: string) => {
        if (!confirm(`Remove ${label}? Historical orders / P&L data stay intact.`)) return;
        setBusy(id);
        try {
            await removeStore(id);
            toast({ title: 'Store removed', description: label });
        } catch (e: any) {
            toast({ title: 'Remove failed', description: e?.message || String(e), variant: 'destructive' });
        } finally {
            setBusy(null);
        }
    };

    // Rendered inside the Layout's <Outlet> — sidebar + store switcher stay
    // visible. Works for both "first store" (empty list) and "manage/switch".
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="text-xl font-bold text-slate-900">Stores</h1>
                <p className="text-sm text-slate-500">
                    Kết nối cửa hàng Shopify của bạn. Một tài khoản quản lý được nhiều store — chọn store
                    ở thanh bên để chuyển qua lại.
                </p>
            </div>

            {/* Existing stores list */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Store className="h-5 w-5 text-teal-500" />
                        Cửa hàng của bạn
                        <span className="text-sm font-normal text-slate-500">({stores.length})</span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {stores.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 text-sm">
                            Chưa có store nào. Kết nối store đầu tiên bên dưới để bắt đầu.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {stores.map(s => {
                                const isActive = activeStore?.id === s.id;
                                return (
                                    <div key={s.id} className={cn(
                                        "flex items-center justify-between p-3 rounded-lg border transition-colors",
                                        isActive ? "bg-teal-50 border-teal-200" : "bg-white border-slate-200"
                                    )}>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                                {(s.name || s.storeDomain).slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-medium text-slate-900 truncate">{s.name || s.storeDomain}</div>
                                                <div className="text-xs text-slate-500 truncate">{s.storeDomain}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {isActive ? (
                                                <span className="text-xs font-medium text-teal-700 bg-teal-100 rounded-full px-2.5 py-1 flex items-center gap-1">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Active
                                                </span>
                                            ) : (
                                                <Button variant="outline" size="sm" onClick={() => setActiveStoreByDomain(s.storeDomain)}>
                                                    Switch to
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                                onClick={() => handleRemove(s.id, s.name || s.storeDomain)}
                                                disabled={busy === s.id}
                                                title="Remove store"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add / connect another store */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">{stores.length === 0 ? 'Kết nối store' : 'Thêm store khác'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ShopifyOAuthConnect />
                    <details className="text-xs text-slate-400">
                        <summary className="cursor-pointer hover:text-slate-600">
                            Cách cũ: dán Admin API token thủ công
                        </summary>
                        <div className="mt-3">
                            <ShopifyConnection onConnectionSuccess={handleConnectionSuccess} />
                        </div>
                    </details>
                </CardContent>
            </Card>
        </div>
    );
};
