import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ShopifyApiClient } from '@/utils/shopifyApi';

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
      setError('Please fill in every field.');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      console.log('Testing Shopify connection with CORS proxy...');
      const apiClient = new ShopifyApiClient({ storeUrl, accessToken });
      
      const isConnected = await apiClient.testConnection();
      
      if (isConnected) {
        console.log('Connection successful!');
        onConnectionSuccess({ storeUrl, accessToken });
        
        toast({
          title: "Connected",
          description: "Connected to your Shopify store through the CORS proxy.",
        });
      } else {
        throw new Error('Connection failed');
      }
      
    } catch (err) {
      console.error('Connection error:', err);
      setError('Could not connect. Check the Store URL and Access Token — it may be a CORS problem or bad credentials.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>Connect Shopify</span>
        </CardTitle>
        <CardDescription>
          Enter your store details to reach the API (via the CORS proxy)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            The app uses a CORS proxy to reach the Shopify API from the browser. Make sure the Store URL and Access Token are correct.
          </AlertDescription>
        </Alert>

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
              Connecting…
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Connect
            </>
          )}
        </Button>

        <div className="text-xs text-slate-500 space-y-1">
          <p>💡 To get an Access Token:</p>
          <p>1. Go to Shopify Admin → Apps → Develop apps</p>
          <p>2. Create a private app with the read_orders scope</p>
          <p>3. Copy Admin API access token</p>
        </div>
      </CardContent>
    </Card>
  );
};
