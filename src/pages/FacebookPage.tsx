import { FacebookAdsConnection } from '@/components/FacebookAdsConnection';
import { FacebookAccountsTable } from '@/components/FacebookAccountsTable';
import { FacebookAdsManager } from '@/components/FacebookAdsManager';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, LogOut } from 'lucide-react';
import { useAppContext } from '@/context/AppContext';

export const FacebookPage = () => {
    const {
        isFacebookConnected,
        handleFacebookConnectionSuccess,
        handleDisconnectFacebook,
        facebookAccounts,
        handleFacebookAccountToggle,
        accountsSpend,
        selectedAccount,
        setSelectedAccount,
        handleSpendUpdate,
        dateRange,
        setDateRange,
        selectedDatePreset,
        setSelectedDatePreset
    } = useAppContext();

    if (!isFacebookConnected) {
        return (
            <div className="max-w-2xl mx-auto mt-8">
                <Card className="p-10 text-center bg-gradient-to-br from-white to-blue-50/30 border-blue-100">
                    <div className="mb-6">
                        <div className="p-5 bg-gradient-to-br from-blue-500 to-violet-600 rounded-2xl w-20 h-20 mx-auto flex items-center justify-center shadow-lg shadow-blue-500/30">
                            <BarChart3 className="h-10 w-10 text-white" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect Facebook Ads</h2>
                    <p className="text-slate-600 mb-8">
                        Connect to manage all your ad accounts in one place — track spend, ROAS, and ad performance.
                    </p>
                    <FacebookAdsConnection onConnectionSuccess={handleFacebookConnectionSuccess} />
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold">Ad Accounts Portfolio</h2>
                    <p className="text-sm text-slate-500 mt-0.5">Toggle accounts on or off to include them in spend totals across the app.</p>
                </div>
                <Button onClick={handleDisconnectFacebook} variant="outline">
                    <LogOut className="mr-2 h-4 w-4" />
                    Disconnect
                </Button>
            </div>

            <FacebookAccountsTable
                accounts={facebookAccounts}
                onAccountToggle={handleFacebookAccountToggle}
                accountsSpend={accountsSpend}
                selectedAccountId={selectedAccount?.id}
                onSelectAccount={(account) => setSelectedAccount(account)}
            />

            {selectedAccount && (
                <FacebookAdsManager
                    account={selectedAccount}
                    onSpendUpdate={(spend) => handleSpendUpdate(selectedAccount.id, spend)}
                    dateRange={dateRange}
                    onDateRangeChange={setDateRange}
                    selectedPreset={selectedDatePreset}
                    onPresetChange={setSelectedDatePreset}
                />
            )}
        </div>
    );
};
