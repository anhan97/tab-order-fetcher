import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { FacebookAdAccount } from '@/types/facebook';
import { formatCurrency } from '@/utils/format';

interface FacebookAccountsTableProps {
  accounts: FacebookAdAccount[];
  onAccountToggle: (accountId: string, enabled: boolean) => void;
  accountsSpend: { [key: string]: number };
}

export function FacebookAccountsTable(props: FacebookAccountsTableProps) {
  const { accounts, onAccountToggle, accountsSpend } = props;
  const totalSpend = React.useMemo(() => 
    Object.values(accountsSpend).reduce((sum, spend) => sum + spend, 0),
    [accountsSpend]
  );

  const handleToggle = React.useCallback((accountId: string, checked: boolean) => {
    onAccountToggle(accountId, checked);
  }, [onAccountToggle]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-xl font-bold">
          Facebook Ad Accounts
          <span className="ml-4 text-sm font-normal text-slate-500">
            Total Spend: {formatCurrency(totalSpend)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead>Account ID</TableHead>
              <TableHead className="text-right">Total Spend</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map(account => (
              <TableRow key={account.id}>
                <TableCell className="font-medium">{account.name}</TableCell>
                <TableCell>{account.id}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(accountsSpend[account.id] || 0)}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={account.isEnabled}
                    onCheckedChange={(checked) => handleToggle(account.id, checked)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
} 