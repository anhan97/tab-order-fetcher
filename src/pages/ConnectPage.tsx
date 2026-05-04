import { Card } from '@/components/ui/card';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { Store } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Navigate, Link } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export const ConnectPage = () => {
    const { stores, addStore, setActiveStoreByDomain } = useAuth();
    const { toast } = useToast();

    // If the user already has stores, send them straight into the app — they
    // can come back to /connect via the Layout sidebar to add more.
    const showAddingFlow = stores.length === 0;

    if (!showAddingFlow) {
        return <Navigate to="/orders" replace />;
    }

    const handleConnectionSuccess = async (config: { storeUrl: string; accessToken: string }) => {
        try {
            await addStore(config.storeUrl, config.accessToken);
            setActiveStoreByDomain(config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''));
            toast({ title: 'Store added', description: config.storeUrl });
        } catch (e: any) {
            toast({ title: 'Failed to save store', description: e?.message || String(e), variant: 'destructive' });
        }
    };

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
};
