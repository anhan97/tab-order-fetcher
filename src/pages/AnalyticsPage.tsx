import { EnhancedAnalytics } from '@/components/EnhancedAnalytics';
import { Card } from '@/components/ui/card';
import { useAppContext } from '@/context/AppContext';
import { Link } from 'react-router-dom';

export const AnalyticsPage = () => {
    const {
        isFacebookConnected,
        facebookAccounts,
        orders,
        cogsConfigs,
        accountsSpend,
        dateRange
    } = useAppContext();

    if (isFacebookConnected && facebookAccounts.length > 0) {
        return (
            <EnhancedAnalytics
                orders={orders}
                cogsConfigs={cogsConfigs}
                facebookConfigs={facebookAccounts.filter(account => account.isEnabled).map(account => ({
                    id: account.id,
                    accessToken: account.accessToken,
                    adAccountId: account.id,
                    name: account.name,
                    spend: accountsSpend[account.id] || 0
                }))}
                globalDateRange={dateRange}
            />
        );
    }

    return (
        <Card className="p-6 text-center">
            <h3 className="text-lg font-semibold mb-4">Facebook Ads Connection Required</h3>
            <p className="text-slate-600 mb-4">
                To view ROAS and ad performance analytics, please connect to Facebook Ads first.
            </p>
            <p className="text-sm text-slate-500">
                Go to the <Link to="/facebook" className="text-teal-600 hover:underline">Facebook</Link> page to set up the connection.
            </p>
        </Card>
    );
};
