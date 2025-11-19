import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ShopifyApiClient } from '@/utils/shopifyApi';
import { FacebookAdsApiClient, fetchUserAdAccounts, fetchAdAccountData } from '@/utils/facebookAdsApi';
import { COGSApiClient } from '@/utils/cogsApi';
import { Order, COGSConfig } from '@/types/order';
import { CogsConfig } from '@/types/minimalCogs';
import { FacebookAdAccount, FacebookCampaign, FacebookAdSet, FacebookAd } from '@/types/facebook';
import { DatePreset } from "@/components/ui/date-range-picker";

interface AppContextType {
    // Shopify State
    isShopifyConnected: boolean;
    shopifyConfig: { storeUrl: string; accessToken: string } | null;
    setShopifyConfig: (config: { storeUrl: string; accessToken: string } | null) => void;
    handleShopifyConnectionSuccess: (config: { storeUrl: string; accessToken: string }) => void;
    handleDisconnectShopify: () => void;

    // Facebook State
    isFacebookConnected: boolean;
    facebookAccounts: FacebookAdAccount[];
    selectedAccount: FacebookAdAccount | null;
    accountsSpend: { [key: string]: number };
    campaigns: FacebookCampaign[];
    adSets: FacebookAdSet[];
    ads: FacebookAd[];
    handleFacebookConnectionSuccess: (config: { accessToken: string; adAccountId: string }) => Promise<void>;
    handleDisconnectFacebook: () => void;
    handleFacebookAccountToggle: (accountId: string, enabled: boolean) => void;
    setSelectedAccount: (account: FacebookAdAccount | null) => void;
    handleSpendUpdate: (accountId: string, spend: number) => void;
    loadAllAccountsSpend: (customDateRange?: { from: Date; to: Date }) => Promise<void>;

    // Orders State
    orders: Order[];
    setOrders: (orders: Order[]) => void;

    // COGS State
    cogsConfigs: COGSConfig[];
    minimalCogsConfig: CogsConfig | null;
    handleUpdateCOGS: (newConfigs: COGSConfig[] | CogsConfig) => void;
    handleRefreshCOGS: () => Promise<void>;

    // Global Settings
    timezone: string;
    setTimezone: (timezone: string) => void;
    selectedDatePreset: DatePreset;
    setSelectedDatePreset: (preset: DatePreset) => void;
    dateRange: { from: Date; to: Date };
    setDateRange: (range: { from: Date; to: Date }) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
    // --- State Definitions ---
    const [isShopifyConnected, setIsShopifyConnected] = useState(() => {
        return !!localStorage.getItem('shopify_store_url');
    });
    const [shopifyConfig, setShopifyConfig] = useState<{ storeUrl: string; accessToken: string } | null>(null);

    const [isFacebookConnected, setIsFacebookConnected] = useState(false);
    const [facebookAccounts, setFacebookAccounts] = useState<FacebookAdAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<FacebookAdAccount | null>(null);
    const [accountsSpend, setAccountsSpend] = useState<{ [key: string]: number }>({});
    const [campaigns, setCampaigns] = useState<FacebookCampaign[]>([]);
    const [adSets, setAdSets] = useState<FacebookAdSet[]>([]);
    const [ads, setAds] = useState<FacebookAd[]>([]);

    const [orders, setOrders] = useState<Order[]>([]);

    const [cogsConfigs, setCogsConfigs] = useState<COGSConfig[]>([]);
    const [minimalCogsConfig, setMinimalCogsConfig] = useState<CogsConfig | null>(null);

    const [timezone, setTimezone] = useState(() => {
        return localStorage.getItem('preferred_timezone') || 'Etc/GMT+6';
    });

    const [selectedDatePreset, setSelectedDatePreset] = useState<DatePreset>("last30days");
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return { from: thirtyDaysAgo, to: now };
    });

    // --- Effects ---

    // Initial Load
    useEffect(() => {
        const savedShopifyClient = ShopifyApiClient.fromLocalStorage();
        const savedFacebookClient = FacebookAdsApiClient.fromLocalStorage();
        const savedCogsConfigs = localStorage.getItem('cogs_configs');
        const savedFacebookAccounts = localStorage.getItem('facebook_accounts');

        if (savedShopifyClient) {
            const storeUrl = localStorage.getItem('shopify_store_url') || '';
            const accessToken = localStorage.getItem('shopify_access_token') || '';
            setShopifyConfig({ storeUrl, accessToken });
            setIsShopifyConnected(true);

            if (storeUrl) {
                const userId = 'default-user';
                const storeId = storeUrl.replace('.myshopify.com', '');
                COGSApiClient.saveToLocalStorage(userId, storeId);
            }
        }

        if (savedFacebookClient) {
            setIsFacebookConnected(true);
            if (savedFacebookAccounts) {
                const accounts = JSON.parse(savedFacebookAccounts);
                setFacebookAccounts(accounts);
                const enabledAccount = accounts.find((a: FacebookAdAccount) => a.isEnabled);
                if (enabledAccount) {
                    setSelectedAccount(enabledAccount);
                }
            }
        }

        if (savedCogsConfigs) {
            setCogsConfigs(JSON.parse(savedCogsConfigs));
        }

        const savedMinimalCogsConfig = localStorage.getItem('minimal_cogs_config');
        if (savedMinimalCogsConfig) {
            try {
                setMinimalCogsConfig(JSON.parse(savedMinimalCogsConfig));
            } catch (error) {
                console.warn('Failed to parse minimal COGS config:', error);
            }
        }
    }, []);

    // Load Facebook Data for Selected Account
    useEffect(() => {
        if (selectedAccount) {
            const loadData = async () => {
                try {
                    const data = await fetchAdAccountData(
                        selectedAccount.id,
                        selectedAccount.accessToken,
                        dateRange
                    );
                    setCampaigns(data.campaigns);
                    setAdSets(data.adsets);
                    setAds(data.ads);
                } catch (error) {
                    console.error('Error loading Facebook data:', error);
                }
            };
            loadData();
        }
    }, [selectedAccount, dateRange]);

    // Load Orders
    useEffect(() => {
        const loadOrders = async () => {
            try {
                // Use stored config if available, otherwise fallback to env (dev mode)
                const storeUrl = shopifyConfig?.storeUrl || import.meta.env.VITE_SHOPIFY_SHOP_DOMAIN || '';
                const accessToken = shopifyConfig?.accessToken || import.meta.env.VITE_SHOPIFY_ACCESS_TOKEN || '';

                if (!storeUrl || !accessToken) return;

                const client = new ShopifyApiClient({ storeUrl, accessToken });
                const response = await client.getOrders({
                    created_at_min: dateRange.from.toISOString(),
                    created_at_max: dateRange.to.toISOString(),
                });
                setOrders(response.orders);
            } catch (error) {
                console.error('Error loading orders:', error);
            }
        };
        loadOrders();
    }, [dateRange, shopifyConfig]);

    // Save Timezone
    useEffect(() => {
        localStorage.setItem('preferred_timezone', timezone);
    }, [timezone]);

    // Load All Accounts Spend
    useEffect(() => {
        if (isFacebookConnected && facebookAccounts.length > 0) {
            loadAllAccountsSpend();
        }
    }, [facebookAccounts, dateRange, isFacebookConnected]);


    // --- Handlers ---

    const handleShopifyConnectionSuccess = (config: { storeUrl: string; accessToken: string }) => {
        setShopifyConfig(config);
        setIsShopifyConnected(true);
    };

    const handleDisconnectShopify = () => {
        ShopifyApiClient.clearLocalStorage();
        setShopifyConfig(null);
        setIsShopifyConnected(false);
        setOrders([]);
    };

    const handleFacebookConnectionSuccess = async (config: { accessToken: string; adAccountId: string }) => {
        try {
            const accounts = await fetchUserAdAccounts(config.accessToken);
            const adAccounts = accounts.map(account => ({
                ...account,
                accessToken: config.accessToken,
                isEnabled: account.id === config.adAccountId
            }));

            setFacebookAccounts(adAccounts);
            localStorage.setItem('facebook_accounts', JSON.stringify(adAccounts));

            const initialAccount = adAccounts.find(a => a.id === config.adAccountId);
            if (initialAccount) {
                setSelectedAccount(initialAccount);
            }

            setIsFacebookConnected(true);
        } catch (error) {
            console.error('Error fetching Facebook ad accounts:', error);
        }
    };

    const handleDisconnectFacebook = () => {
        FacebookAdsApiClient.clearLocalStorage();
        localStorage.removeItem('facebook_accounts');
        setFacebookAccounts([]);
        setSelectedAccount(null);
        setAccountsSpend({});
        setIsFacebookConnected(false);
    };

    const handleFacebookAccountToggle = (accountId: string, enabled: boolean) => {
        setFacebookAccounts(prev => {
            const accounts = prev.map(account =>
                account.id === accountId ? { ...account, isEnabled: enabled } : account
            );
            localStorage.setItem('facebook_accounts', JSON.stringify(accounts));
            return accounts;
        });

        if (enabled) {
            const account = facebookAccounts.find(a => a.id === accountId);
            if (account) {
                setSelectedAccount(account);
            }
            loadAllAccountsSpend();
        } else if (selectedAccount?.id === accountId) {
            const nextEnabledAccount = facebookAccounts.find(a => a.isEnabled && a.id !== accountId);
            setSelectedAccount(nextEnabledAccount || null);
        }

        setTimeout(() => loadAllAccountsSpend(), 100);
    };

    const handleSpendUpdate = (accountId: string, spend: number) => {
        setAccountsSpend(prev => ({
            ...prev,
            [accountId]: spend
        }));
    };

    const loadAllAccountsSpend = async (customDateRange?: { from: Date; to: Date }) => {
        const enabledAccounts = facebookAccounts.filter(account => account.isEnabled);
        const currentDateRange = customDateRange || dateRange;

        if (enabledAccounts.length === 0) return;

        for (const account of enabledAccounts) {
            try {
                const data = await fetchAdAccountData(account.id, account.accessToken, currentDateRange);
                const totalSpend = data.campaigns.reduce((sum, campaign) => sum + (campaign.spend || 0), 0);

                setAccountsSpend(prev => ({ ...prev, [account.id]: totalSpend }));
            } catch (error) {
                console.error(`Failed to load spend for account ${account.id}:`, error);
                setAccountsSpend(prev => ({ ...prev, [account.id]: 0 }));
            }
        }
    };

    const handleUpdateCOGS = (newConfigs: COGSConfig[] | CogsConfig) => {
        if (Array.isArray(newConfigs)) {
            setCogsConfigs(newConfigs);
            localStorage.setItem('cogs_configs', JSON.stringify(newConfigs));
        } else {
            setMinimalCogsConfig(newConfigs);
            localStorage.setItem('minimal_cogs_config', JSON.stringify(newConfigs));
        }
    };

    const handleRefreshCOGS = async () => {
        try {
            const client = COGSApiClient.fromLocalStorage();
            if (client) {
                const configs = await client.getCOGSConfigs();
                setCogsConfigs(configs);
                localStorage.setItem('cogs_configs', JSON.stringify(configs));
            }
        } catch (error) {
            console.error('Error refreshing COGS from database:', error);
        }
    };

    return (
        <AppContext.Provider value={{
            isShopifyConnected,
            shopifyConfig,
            setShopifyConfig,
            handleShopifyConnectionSuccess,
            handleDisconnectShopify,
            isFacebookConnected,
            facebookAccounts,
            selectedAccount,
            accountsSpend,
            campaigns,
            adSets,
            ads,
            handleFacebookConnectionSuccess,
            handleDisconnectFacebook,
            handleFacebookAccountToggle,
            setSelectedAccount,
            handleSpendUpdate,
            loadAllAccountsSpend,
            orders,
            setOrders,
            cogsConfigs,
            minimalCogsConfig,
            handleUpdateCOGS,
            handleRefreshCOGS,
            timezone,
            setTimezone,
            selectedDatePreset,
            setSelectedDatePreset,
            dateRange,
            setDateRange,
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useAppContext must be used within an AppContextProvider');
    }
    return context;
};
