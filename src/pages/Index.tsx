
import { useState, useEffect } from 'react';
import { ShopifyConnection } from '@/components/ShopifyConnection';
import { FacebookAdsConnection } from '@/components/FacebookAdsConnection';
import { OrdersTable } from '@/components/OrdersTable';
import { TrackingUpload } from '@/components/TrackingUpload';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ShoppingBag, Download, Settings, Upload, BarChart3, LogOut } from 'lucide-react';
import { ShopifyApiClient } from '@/utils/shopifyApi';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';
import { Order } from '@/types/order';

const Index = () => {
  const [isShopifyConnected, setIsShopifyConnected] = useState(false);
  const [isFacebookConnected, setIsFacebookConnected] = useState(false);
  const [shopifyConfig, setShopifyConfig] = useState<{
    storeUrl: string;
    accessToken: string;
  } | null>(null);
  const [facebookConfig, setFacebookConfig] = useState<{
    accessToken: string;
    adAccountId: string;
  } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    // Try to load from localStorage on startup
    const savedShopifyClient = ShopifyApiClient.fromLocalStorage();
    const savedFacebookClient = FacebookAdsApiClient.fromLocalStorage();
    
    if (savedShopifyClient) {
      setShopifyConfig({
        storeUrl: localStorage.getItem('shopify_store_url') || '',
        accessToken: localStorage.getItem('shopify_access_token') || ''
      });
      setIsShopifyConnected(true);
    }
    
    if (savedFacebookClient) {
      setFacebookConfig({
        accessToken: localStorage.getItem('facebook_access_token') || '',
        adAccountId: localStorage.getItem('facebook_ad_account_id') || ''
      });
      setIsFacebookConnected(true);
    }
  }, []);

  const handleShopifyConnectionSuccess = (config: { storeUrl: string; accessToken: string }) => {
    setShopifyConfig(config);
    setIsShopifyConnected(true);
  };

  const handleFacebookConnectionSuccess = (config: { accessToken: string; adAccountId: string }) => {
    setFacebookConfig(config);
    setIsFacebookConnected(true);
  };

  const handleDisconnectShopify = () => {
    ShopifyApiClient.clearLocalStorage();
    setShopifyConfig(null);
    setIsShopifyConnected(false);
    setOrders([]);
  };

  const handleDisconnectFacebook = () => {
    FacebookAdsApiClient.clearLocalStorage();
    setFacebookConfig(null);
    setIsFacebookConnected(false);
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
                <p className="text-sm text-slate-600">Quản lý đơn hàng và phân tích Facebook Ads</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {isShopifyConnected && (
                <div className="flex items-center space-x-2 text-sm text-teal-600">
                  <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
                  <span>Shopify</span>
                </div>
              )}
              {isFacebookConnected && (
                <div className="flex items-center space-x-2 text-sm text-blue-600">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span>Facebook Ads</span>
                </div>
              )}
              {(isShopifyConnected || isFacebookConnected) && (
                <div className="flex space-x-2">
                  {isShopifyConnected && (
                    <Button
                      onClick={handleDisconnectShopify}
                      variant="outline"
                      size="sm"
                    >
                      <LogOut className="h-4 w-4 mr-1" />
                      Shopify
                    </Button>
                  )}
                  {isFacebookConnected && (
                    <Button
                      onClick={handleDisconnectFacebook}
                      variant="outline"
                      size="sm"
                    >
                      <LogOut className="h-4 w-4 mr-1" />
                      Facebook
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isShopifyConnected ? (
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
              <ShopifyConnection onConnectionSuccess={handleShopifyConnectionSuccess} />
            </Card>
          </div>
        ) : (
          <Tabs defaultValue="orders" className="space-y-6">
            <TabsList className="grid w-full grid-cols-5 max-w-2xl">
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
              <TabsTrigger value="analytics" className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4" />
                <span>Analytics</span>
              </TabsTrigger>
              <TabsTrigger value="facebook" className="flex items-center space-x-2">
                <Settings className="h-4 w-4" />
                <span>Facebook</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders" className="space-y-6">
              <OrdersTable 
                shopifyConfig={shopifyConfig!} 
                onOrdersChange={setOrders}
              />
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

            <TabsContent value="analytics" className="space-y-6">
              {isFacebookConnected && facebookConfig ? (
                <AnalyticsDashboard 
                  facebookConfig={facebookConfig}
                  orders={orders}
                />
              ) : (
                <Card className="p-6 text-center">
                  <h3 className="text-lg font-semibold mb-4">Cần kết nối Facebook Ads</h3>
                  <p className="text-slate-600 mb-4">
                    Để xem phân tích ROAS và hiệu suất quảng cáo, vui lòng kết nối với Facebook Ads trước.
                  </p>
                  <p className="text-sm text-slate-500">
                    Chuyển sang tab "Facebook" để thiết lập kết nối.
                  </p>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="facebook" className="space-y-6">
              {!isFacebookConnected ? (
                <div className="max-w-2xl mx-auto">
                  <Card className="p-8 text-center">
                    <div className="mb-6">
                      <div className="p-4 bg-blue-50 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
                        <BarChart3 className="h-10 w-10 text-blue-500" />
                      </div>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Kết nối Facebook Ads</h2>
                    <p className="text-slate-600 mb-8">
                      Kết nối để phân tích ROAS và hiệu suất quảng cáo
                    </p>
                    <FacebookAdsConnection onConnectionSuccess={handleFacebookConnectionSuccess} />
                  </Card>
                </div>
              ) : (
                <Card className="p-6 text-center">
                  <h3 className="text-lg font-semibold mb-4 text-green-600">✓ Đã kết nối Facebook Ads</h3>
                  <p className="text-slate-600 mb-4">
                    Tài khoản quảng cáo đã được kết nối thành công. 
                    Chuyển sang tab "Analytics" để xem phân tích chi tiết.
                  </p>
                  <Button onClick={handleDisconnectFacebook} variant="outline">
                    <LogOut className="mr-2 h-4 w-4" />
                    Ngắt kết nối Facebook Ads
                  </Button>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
};

export default Index;
