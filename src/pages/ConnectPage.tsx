import { Card } from '@/components/ui/card';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { Settings } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';
import { Navigate } from 'react-router-dom';

export const ConnectPage = () => {
    const { isShopifyConnected, handleShopifyConnectionSuccess } = useAppContext();

    if (isShopifyConnected) {
        return <Navigate to="/orders" replace />;
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                <Card className="p-8 text-center">
                    <div className="mb-6">
                        <div className="p-4 bg-teal-50 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
                            <Settings className="h-10 w-10 text-teal-500" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect to Shopify Store</h2>
                    <p className="text-slate-600 mb-8">
                        Enter your Shopify store details to start managing orders
                    </p>
                    <ShopifyConnection onConnectionSuccess={handleShopifyConnectionSuccess} />
                </Card>
            </div>
        </div>
    );
};
