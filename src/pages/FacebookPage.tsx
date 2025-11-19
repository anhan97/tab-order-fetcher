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
        handleSpendUpdate,
        dateRange,
        setDateRange,
        selectedDatePreset,
        setSelectedDatePreset
    } = useAppContext();

    if (!isFacebookConnected) {
        return (
            <div className="max-w-2xl mx-auto mt-8">
                <Card className="p-8 text-center">
                    <div className="mb-6">
                        <div className="p-4 bg-blue-50 rounded-full w-20 h-20 mx-auto flex items-center justify-center">
                            <BarChart3 className="h-10 w-10 text-blue-500" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Connect Facebook Ads</h2>
                    <p className="text-slate-600 mb-8">
                        Connect to analyze ROAS and ad performance
                    </p>
                    <FacebookAdsConnection onConnectionSuccess={handleFacebookConnectionSuccess} />
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Facebook Ads</h2>
                <Button onClick={handleDisconnectFacebook} variant="outline">
                    <LogOut className="mr-2 h-4 w-4" />
                    Disconnect Facebook Ads
                </Button>
            </div>

            <FacebookAccountsTable
                accounts={facebookAccounts}
                onAccountToggle={handleFacebookAccountToggle}
                accountsSpend={accountsSpend}
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
