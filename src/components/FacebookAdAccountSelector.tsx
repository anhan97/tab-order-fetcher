import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FacebookAdAccount } from '@/utils/facebookAdsApi';

interface FacebookAdAccountSelectorProps {
  accounts: FacebookAdAccount[];
  onSelect: (account: FacebookAdAccount) => void;
  onClose: () => void;
}

export const FacebookAdAccountSelector = ({
  accounts,
  onSelect,
  onClose
}: FacebookAdAccountSelectorProps) => {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Select Ad Account</DialogTitle>
          <DialogDescription>
            Choose the Facebook Ads account you want to connect
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[300px] mt-4">
          <div className="space-y-2">
            {accounts.map(account => (
              <Button
                key={account.id}
                variant="outline"
                className="w-full justify-start text-left p-4"
                onClick={() => onSelect(account)}
              >
                <div className="flex flex-col gap-1">
                  <div className="font-medium">{account.name}</div>
                  <div className="text-sm text-muted-foreground">
                    ID: {account.id}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={account.account_status === 1 ? "success" : "secondary"}>
                      {account.account_status === 1 ? 'Active' : 'Inactive'}
                    </Badge>
                    <Badge variant="outline">{account.currency}</Badge>
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}; 