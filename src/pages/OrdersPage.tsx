import { OrdersTable } from '@/components/OrdersTable';
import { useAppContext } from '@/context/AppContext';
import { useNavigate } from 'react-router-dom';

export const OrdersPage = () => {
    const {
        shopifyConfig,
        setOrders,
        minimalCogsConfig,
        isFacebookConnected,
        timezone,
        facebookAccounts,
        accountsSpend,
        dateRange,
        handleSpendUpdate
    } = useAppContext();

    const navigate = useNavigate();

    if (!shopifyConfig) return null;

    return (
        <OrdersTable
            shopifyConfig={shopifyConfig}
            onOrdersChange={setOrders}
            cogsConfig={minimalCogsConfig}
            isFacebookConnected={isFacebookConnected}
            timezone={timezone}
            onFacebookConnect={() => navigate('/facebook')}
            facebookAccounts={facebookAccounts}
            accountsSpend={accountsSpend}
            globalDateRange={dateRange}
            onAccountsSpendUpdate={handleSpendUpdate}
        />
    );
};
