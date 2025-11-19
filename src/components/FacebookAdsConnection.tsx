
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';

interface FacebookAdsConnectionProps {
  onConnectionSuccess: (config: { accessToken: string; adAccountId: string }) => void;
}

export function FacebookAdsConnection({ onConnectionSuccess }: FacebookAdsConnectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const client = FacebookAdsApiClient.getInstance();
      const { accessToken } = await client.login();

      // After successful login, fetch ad accounts
      const accounts = await client.getAdAccounts();
      
      if (accounts.length === 0) {
        throw new Error('No Facebook Ad accounts found. Please make sure you have access to at least one ad account.');
      }

      // Use the first account by default
      const firstAccount = accounts[0];
      onConnectionSuccess({
        accessToken,
        adAccountId: firstAccount.id
      });
    } catch (error) {
      console.error('Facebook login error:', error);
      setError(error instanceof Error ? error.message : 'Failed to connect to Facebook');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleLogin}
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect Facebook Ads'
        )}
      </Button>
    </div>
  );
}
