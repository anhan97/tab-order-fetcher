import * as React from 'react';
import { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Search, Wallet, BarChart3, CheckCircle2, PauseCircle, Copy, ExternalLink, Activity } from 'lucide-react';
import { FacebookAdAccount } from '@/types/facebook';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface FacebookAccountsTableProps {
  accounts: FacebookAdAccount[];
  onAccountToggle: (accountId: string, enabled: boolean) => void;
  accountsSpend: { [key: string]: number };
  onSelectAccount?: (account: FacebookAdAccount) => void;
  selectedAccountId?: string;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';

export function FacebookAccountsTable(props: FacebookAccountsTableProps) {
  const { accounts, onAccountToggle, accountsSpend, onSelectAccount, selectedAccountId } = props;
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const stats = useMemo(() => {
    const enabledAccounts = accounts.filter(a => a.isEnabled);
    const totalSpend = enabledAccounts.reduce((sum, a) => sum + (accountsSpend[a.id] || 0), 0);
    const accountsWithSpend = enabledAccounts.filter(a => (accountsSpend[a.id] || 0) > 0).length;
    return {
      totalAccounts: accounts.length,
      enabledAccounts: enabledAccounts.length,
      disabledAccounts: accounts.length - enabledAccounts.length,
      totalSpend,
      avgSpend: enabledAccounts.length > 0 ? totalSpend / enabledAccounts.length : 0,
      activeWithSpend: accountsWithSpend
    };
  }, [accounts, accountsSpend]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter(account => {
      // status filter
      if (statusFilter === 'enabled' && !account.isEnabled) return false;
      if (statusFilter === 'disabled' && account.isEnabled) return false;
      // search filter
      if (q && !account.name.toLowerCase().includes(q) && !account.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [accounts, statusFilter, searchQuery]);

  // Sort: enabled first, then by spend desc within each group
  const sortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a, b) => {
      if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
      const aSpend = accountsSpend[a.id] || 0;
      const bSpend = accountsSpend[b.id] || 0;
      return bSpend - aSpend;
    });
  }, [filteredAccounts, accountsSpend]);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: 'Account ID copied', description: id, duration: 2000 });
    } catch {
      // Clipboard API can fail in non-secure contexts — silently swallow
    }
  };

  const handleBulkToggle = (enable: boolean) => {
    const targets = sortedAccounts.filter(a => a.isEnabled !== enable);
    if (targets.length === 0) return;
    targets.forEach(a => onAccountToggle(a.id, enable));
    toast({
      title: enable ? 'All visible accounts enabled' : 'All visible accounts disabled',
      description: `${targets.length} account${targets.length === 1 ? '' : 's'} updated`,
      duration: 2500
    });
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={<BarChart3 className="h-4 w-4 text-blue-500" />}
            label="Total Accounts"
            value={`${stats.totalAccounts}`}
            subtext={`${stats.enabledAccounts} enabled · ${stats.disabledAccounts} off`}
          />
          <StatTile
            icon={<Activity className="h-4 w-4 text-emerald-500" />}
            label="Active w/ Spend"
            value={`${stats.activeWithSpend}`}
            subtext={`of ${stats.enabledAccounts} enabled`}
          />
          <StatTile
            icon={<Wallet className="h-4 w-4 text-amber-500" />}
            label="Total Spend"
            value={formatCurrency(stats.totalSpend)}
            subtext="From enabled accounts"
          />
          <StatTile
            icon={<Wallet className="h-4 w-4 text-violet-500" />}
            label="Avg / Account"
            value={formatCurrency(stats.avgSpend)}
            subtext="Across enabled"
          />
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name or account ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex items-center gap-2">
                <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                  All <span className="ml-1.5 text-xs opacity-70">({stats.totalAccounts})</span>
                </FilterChip>
                <FilterChip active={statusFilter === 'enabled'} onClick={() => setStatusFilter('enabled')}>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Enabled <span className="ml-1.5 text-xs opacity-70">({stats.enabledAccounts})</span>
                </FilterChip>
                <FilterChip active={statusFilter === 'disabled'} onClick={() => setStatusFilter('disabled')}>
                  <PauseCircle className="h-3 w-3 mr-1" />
                  Off <span className="ml-1.5 text-xs opacity-70">({stats.disabledAccounts})</span>
                </FilterChip>

                <div className="border-l border-slate-200 pl-2 ml-1 flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => handleBulkToggle(true)} disabled={sortedAccounts.every(a => a.isEnabled)}>
                    Enable all
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleBulkToggle(false)} disabled={sortedAccounts.every(a => !a.isEnabled)}>
                    Disable all
                  </Button>
                </div>
              </div>
            </div>

            {/* Table */}
            {sortedAccounts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500 font-medium">No ad accounts match the current filters</p>
                <p className="text-xs text-slate-400 mt-1">Try clearing the search or switching the status filter</p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="hidden md:table-cell">Account ID</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-20 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAccounts.map(account => {
                      const spend = accountsSpend[account.id] || 0;
                      const isSelected = selectedAccountId === account.id;
                      const initials = getInitials(account.name);
                      const spendShare = stats.totalSpend > 0 ? (spend / stats.totalSpend) * 100 : 0;

                      return (
                        <TableRow
                          key={account.id}
                          className={cn(
                            "transition-colors cursor-pointer",
                            isSelected && "bg-blue-50/50 hover:bg-blue-50/70",
                            !isSelected && "hover:bg-slate-50/60",
                            !account.isEnabled && "opacity-60"
                          )}
                          onClick={() => onSelectAccount?.(account)}
                        >
                          <TableCell>
                            <div className={cn(
                              "h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold",
                              account.isEnabled
                                ? "bg-gradient-to-br from-blue-500 to-violet-600 text-white"
                                : "bg-slate-200 text-slate-500"
                            )}>
                              {initials}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-slate-900">{account.name}</div>
                            <div className="md:hidden font-mono text-xs text-slate-500 mt-0.5">{account.id}</div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell font-mono text-xs text-slate-500">
                            {account.id}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-semibold text-slate-900 tabular-nums">{formatCurrency(spend)}</div>
                            {account.isEnabled && stats.totalSpend > 0 && (
                              <div className="flex items-center justify-end gap-1.5 mt-1">
                                <div className="w-12 h-1 rounded-full bg-slate-200 overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                                    style={{ width: `${Math.min(100, spendShare)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-500 tabular-nums w-9 text-right">
                                  {spendShare.toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={account.isEnabled}
                                onCheckedChange={(checked) => onAccountToggle(account.id, checked)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Toggle ${account.name}`}
                              />
                              {account.isEnabled ? (
                                <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200">Off</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-0.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopyId(account.id)}>
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy account ID</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    asChild
                                  >
                                    <a
                                      href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${account.id.replace(/^act_/, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open in Ads Manager</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
}

function StatTile({ icon, label, value, subtext }: StatTileProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</p>
        </div>
        <h3 className="text-xl font-bold mt-1.5 tabular-nums text-slate-900">{value}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>
      </CardContent>
    </Card>
  );
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterChip({ active, onClick, children }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
        active
          ? "bg-blue-50 border-blue-200 text-blue-700"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
