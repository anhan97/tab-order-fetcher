
import { useState } from 'react';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { OrdersTable } from '@/components/OrdersTable';
import { TrackingUpload } from '@/components/TrackingUpload';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingBag, Download, Settings, Upload } from 'lucide-react';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [shopifyConfig, setShopifyConfig] = useState<{
    storeUrl: string;
    accessToken: string;
  } | null>(null);

  const handleConnectionSuccess = (config: { storeUrl: string; accessToken: string }) => {
    setShopifyConfig(config);
    setIsConnected(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-teal-500 rounded-lg">
                <ShoppingBag className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Shopify Order Manager</h1>
                <p className="text-sm text-slate-600">Quản lý và xuất dữ liệu đơn hàng</p>
              </div>
            </div>
            
            {isConnected && (
              <div className="flex items-center space-x-2 text-sm text-teal-600">
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
                <span>Đã kết nối</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isConnected ? (
          <div className="max-w-2xl mx-auto">
            <Card className="p-8 text-center">
              <div className="mb-6">
                <div className="p-4 bg-teal-50 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
                  <Settings className="h-10 w-10 text-teal-500" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Kết nối với Shopify Store</h2>
              <p className="text-slate-600 mb-8">
                Nhập thông tin của Shopify store để bắt đầu quản lý đơn hàng
              </p>
              <ShopifyConnection onConnectionSuccess={handleConnectionSuccess} />
            </Card>
          </div>
        ) : (
          <Tabs defaultValue="orders" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 max-w-lg">
              <TabsTrigger value="orders" className="flex items-center space-x-2">
                <ShoppingBag className="h-4 w-4" />
                <span>Đơn hàng</span>
              </TabsTrigger>
              <TabsTrigger value="tracking" className="flex items-center space-x-2">
                <Upload className="h-4 w-4" />
                <span>Tracking</span>
              </TabsTrigger>
              <TabsTrigger value="export" className="flex items-center space-x-2">
                <Download className="h-4 w-4" />
                <span>Xuất CSV</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders" className="space-y-6">
              <OrdersTable shopifyConfig={shopifyConfig!} />
            </TabsContent>

            <TabsContent value="tracking" className="space-y-6">
              <TrackingUpload shopifyConfig={shopifyConfig!} />
            </TabsContent>

            <TabsContent value="export" className="space-y-6">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Xuất dữ liệu đơn hàng</h3>
                <p className="text-slate-600 mb-4">
                  Tính năng xuất CSV sẽ được tích hợp vào bảng đơn hàng. 
                  Chuyển sang tab "Đơn hàng" để xem và xuất dữ liệu.
                </p>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
};

export default Index;
