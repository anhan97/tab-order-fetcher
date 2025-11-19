import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FacebookAdsConnection } from './FacebookAdsConnection';

interface FacebookReconnectDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReconnect: (config: { accessToken: string; adAccountId: string }) => void;
}

export function FacebookReconnectDialog({
  isOpen,
  onOpenChange,
  onReconnect
}: FacebookReconnectDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Facebook Session Expired</DialogTitle>
          <DialogDescription>
            Your Facebook session has expired. Please reconnect to continue using Facebook Ads features.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <FacebookAdsConnection 
            onConnectionSuccess={(config) => {
              onReconnect(config);
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
} 