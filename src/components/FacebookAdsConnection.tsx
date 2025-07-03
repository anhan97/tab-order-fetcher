
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';

interface FacebookAdsConnectionProps {
  onConnectionSuccess: (config: { accessToken: string; adAccountId: string }) => void;
}

export const FacebookAdsConnection = ({ onConnectionSuccess }: FacebookAdsConnectionProps) => {
  const [accessToken, setAccessToken] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const handleConnect = async () => {
    if (!accessToken || !adAccountId) {
      setError('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      console.log('Testing Facebook Ads connection...');
      const apiClient = new FacebookAdsApiClient({ accessToken, adAccountId });
      
      const isConnected = await apiClient.testConnection();
      
      if (isConnected) {
        console.log('Facebook Ads connection successful!');
        onConnectionSuccess({ accessToken, adAccountId });
        
        toast({
          title: "Kết nối Facebook Ads thành công!",
          description: "Đã kết nối với tài khoản quảng cáo Facebook của bạn.",
        });
      } else {
        throw new Error('Kết nối thất bại');
      }
      
    } catch (err) {
      console.error('Facebook Ads connection error:', err);
      setError('Không thể kết nối. Vui lòng kiểm tra lại Access Token và Ad Account ID.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>Kết nối Facebook Ads</span>
        </CardTitle>
        <CardDescription>
          Nhập thông tin để truy cập Facebook Ads API
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Cần Access Token với quyền ads_read và Ad Account ID để lấy dữ liệu quảng cáo.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="accessToken">Access Token</Label>
          <Input
            id="accessToken"
            type="password"
            placeholder="EAAxxxxx..."
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={isConnecting}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="adAccountId">Ad Account ID</Label>
          <Input
            id="adAccountId"
            placeholder="123456789"
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
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
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang kết nối...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Kết nối Facebook Ads
            </>
          )}
        </Button>

        <div className="text-xs text-slate-500 space-y-1">
          <p>💡 Để lấy Access Token và Ad Account ID:</p>
          <p>1. Vào Facebook Developers → My Apps</p>
          <p>2. Tạo app với Marketing API</p>
          <p>3. Lấy Access Token với scope ads_read</p>
          <p>4. Tìm Ad Account ID trong Ads Manager</p>
        </div>
      </CardContent>
    </Card>
  );
};
