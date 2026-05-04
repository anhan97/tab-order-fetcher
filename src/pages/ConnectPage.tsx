import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { Button } from '@/components/ui/button';
import { Store, ArrowLeft, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const ConnectPage = () => {
    const { stores, activeStore, addStore, removeStore, setActiveStoreByDomain } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [busy, setBusy] = useState<string | null>(null);

    const isFirstTimeFlow = stores.length === 0;

    const handleConnectionSuccess = async (config: { storeUrl: string; accessToken: string }) => {
        try {
            await addStore(config.storeUrl, config.accessToken);
            const cleanDomain = config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            setActiveStoreByDomain(cleanDomain);
            toast({ title: 'Store added', description: cleanDomain });
            // First-time flow: bounce to dashboard once they have a store.
            // Subsequent adds: stay so they can add more or remove.
            if (isFirstTimeFlow) {
                navigate('/orders', { replace: true });
            }
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

    // First-time flow: full-screen centered card, no nav.
    if (isFirstTimeFlow) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="max-w-2xl w-full">
                    <Card className="p-8 text-center">
                        <div className="mb-6">
                            <div className="p-4 bg-teal-50 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
                                <Store className="h-10 w-10 text-teal-500" />
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">Add your first Shopify store</h2>
                        <p className="text-slate-600 mb-8">
                            Enter your Shopify store details. You can add more stores later from the sidebar.
                        </p>
                        <ShopifyConnection onConnectionSuccess={handleConnectionSuccess} />
                    </Card>

                    <div className="mt-6 text-center text-sm text-slate-500">
                        <Link to="/privacy" className="text-blue-600 hover:text-blue-800 hover:underline">
                            Privacy Policy
                        </Link>
                        <span className="mx-2">•</span>
                        <Link to="/terms" className="text-blue-600 hover:text-blue-800 hover:underline">
                            Terms of Service
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // "Manage stores" flow when the user already has at least one store.
    // This is rendered inside the Layout's <Outlet>, but ConnectPage in
    // App.tsx is mounted OUTSIDE the Layout — keep that invariant by
    // including a back-link manually.
    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            <div className="max-w-3xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>
                        <ArrowLeft className="h-4 w-4 mr-1.5" />
                        Back to dashboard
                    </Button>
                </div>

                {/* Existing stores list */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Store className="h-5 w-5 text-teal-500" />
                            Your stores
                            <span className="text-sm font-normal text-slate-500">({stores.length})</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
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
                    </CardContent>
                </Card>

                {/* Add another */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Add another store</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ShopifyConnection onConnectionSuccess={handleConnectionSuccess} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
