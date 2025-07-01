
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ShopifyConnectionProps {
  onConnectionSuccess: (config: { storeUrl: string; accessToken: string }) => void;
}

export const ShopifyConnection = ({ onConnectionSuccess }: ShopifyConnectionProps) => {
  const [storeUrl, setStoreUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const handleConnect = async () => {
    if (!storeUrl || !accessToken) {
      setError('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // In a real implementation, you would test the connection here
      // For demo purposes, we'll assume success
      
      onConnectionSuccess({ storeUrl, accessToken });
      
      toast({
        title: "Kết nối thành công!",
        description: "Đã kết nối với Shopify store của bạn.",
      });
      
    } catch (err) {
      setError('Không thể kết nối. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>Kết nối Shopify</span>
        </CardTitle>
        <CardDescription>
          Nhập thông tin store để truy cập API
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="storeUrl">Store URL</Label>
          <Input
            id="storeUrl"
            placeholder="your-store.myshopify.com"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            disabled={isConnecting}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="accessToken">Access Token</Label>
          <Input
            id="accessToken"
            type="password"
            placeholder="shpat_..."
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={isConnecting}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button 
          onClick={handleConnect} 
          disabled={isConnecting}
          className="w-full bg-teal-500 hover:bg-teal-600"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang kết nối...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Kết nối
            </>
          )}
        </Button>

        <div className="text-xs text-slate-500 space-y-1">
          <p>💡 Để lấy Access Token:</p>
          <p>1. Vào Shopify Admin → Apps → Develop apps</p>
          <p>2. Tạo private app với quyền read_orders</p>
          <p>3. Copy Admin API access token</p>
        </div>
      </CardContent>
    </Card>
  );
};
