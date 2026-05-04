import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ShopifyApiClient } from '@/utils/shopifyApi';
import { FacebookAdsApiClient, fetchUserAdAccounts, fetchAdAccountData } from '@/utils/facebookAdsApi';
import { COGSApiClient } from '@/utils/cogsApi';
import { Order, COGSConfig } from '@/types/order';
import { CogsConfig } from '@/types/minimalCogs';
import { FacebookAdAccount, FacebookCampaign, FacebookAdSet, FacebookAd } from '@/types/facebook';
import { DatePreset } from "@/components/ui/date-range-picker";
import { safeTimezone, isValidTimezone, DEFAULT_TZ, todayInTz, tzDayBoundsUtc } from '@/utils/dateUtils';
import { useAuth } from '@/context/AuthContext';

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
    // Bridge from AuthContext: shopifyConfig now derives from the user's
    // active store record (which is loaded from the backend). Falling back
    // to legacy localStorage keeps existing sessions working until they
    // re-login. Once the user goes through /login → /connect, AuthContext
    // owns the truth.
    const { activeStore } = useAuth();
    const [isShopifyConnected, setIsShopifyConnected] = useState(() => {
        return !!localStorage.getItem('shopify_store_url');
    });
    const [shopifyConfig, setShopifyConfig] = useState<{ storeUrl: string; accessToken: string } | null>(null);

    // Re-sync shopifyConfig + connection flag whenever the active store changes.
    useEffect(() => {
        if (activeStore) {
            setShopifyConfig({ storeUrl: activeStore.storeDomain, accessToken: activeStore.accessToken });
            setIsShopifyConnected(true);
        }
    }, [activeStore]);

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
        // Default to the merchant's Shopify store timezone (LA). The app
        // shipped earlier versions with a bad Etc/GMT+6 default and an
        // older picker that stored display labels (e.g. "GMT+6:00") rather
        // than IANA names — both fail Intl.DateTimeFormat. Validate and
        // fall back to LA so the calendar helpers can never throw.
        const stored = localStorage.getItem('preferred_timezone');
        if (!stored || stored === 'Etc/GMT+6' || !isValidTimezone(stored)) {
            return DEFAULT_TZ;
        }
        return stored;
    });

    // Default to TODAY across the app — matches the dashboard "what's
    // happening right now" mental model. The "today" window is anchored to
    // the STORE timezone (read from localStorage at boot), NOT the browser
    // tz, so a VN merchant viewing a US store sees the same calendar day
    // the store would. This keeps the dashboard, P&L and Shopify aligned.
    const [selectedDatePreset, setSelectedDatePreset] = useState<DatePreset>("today");
    const [dateRange, setDateRange] = useState(() => {
        const tz = safeTimezone(localStorage.getItem('preferred_timezone'));
        const today = todayInTz(tz);
        return tzDayBoundsUtc(today, tz);
    });

    // When the user changes timezone, re-anchor the "today" range so KPIs
    // refetch in the new tz. Only auto-shift if the picked preset is "today"
    // — custom ranges they explicitly chose should be preserved.
    useEffect(() => {
        if (selectedDatePreset !== 'today') return;
        const today = todayInTz(timezone);
        setDateRange(tzDayBoundsUtc(today, timezone));
    }, [timezone, selectedDatePreset]);

    // --- Effects ---

    // Initial Load
    useEffect(() => {
        const savedShopifyClient = ShopifyApiClient.fromLocalStorage();
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

            // Check FB state from the backend. There are two valid "connected"
            // shapes:
            //   (a) per-user FB SDK login → row in UserFacebookConnection
            //   (b) Adlux pool mode → claimed access via FacebookAdAccountAccess
            // The user is "connected" if EITHER produces accounts. Without this,
            // adlux-pool users (who never went through FB SDK login) had no
            // logout pill in the sidebar — making it impossible to disconnect.
            (async () => {
                const fbHeaders = {
                    'X-Shopify-Store-Domain': storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                    'X-Shopify-Access-Token': accessToken
                };
                try {
                    // /connection-accounts returns adlux-managed first, then
                    // falls back to /me/adaccounts via FB SDK token. So a single
                    // call covers both shapes.
                    const accRes = await fetch('/api/facebook/connection-accounts', { headers: fbHeaders });
                    if (accRes.ok) {
                        const { accounts: dbAccounts } = await accRes.json();
                        const fbAccts = (dbAccounts || []).map((a: any) => ({
                            id: a.accountId,
                            name: a.name,
                            accessToken: '',  // token lives in DB only
                            isEnabled: true
                        }));
                        if (fbAccts.length > 0) {
                            setFacebookAccounts(fbAccts);
                            setSelectedAccount(fbAccts[0]);
                            setIsFacebookConnected(true);
                        }
                    }
                } catch { /* offline / backend down — leave disconnected */ }
            })();
        }

        // Stale localStorage cleanup — old code paths used to persist FB
        // tokens here. Wipe so they don't get re-read.
        try {
            localStorage.removeItem('facebook_access_token');
            localStorage.removeItem('facebook_user_id');
        } catch { /* ignore */ }

        // Legacy: read facebook_accounts cache so the dashboard renders
        // immediately while connection-status is in flight. Backend will
        // overwrite with the authoritative list once it answers.
        if (savedFacebookAccounts) {
            try {
                const accounts = JSON.parse(savedFacebookAccounts);
                // Strip any stale accessToken from cached entries.
                const sanitized = accounts.map((a: any) => ({ ...a, accessToken: '' }));
                setFacebookAccounts(sanitized);
            } catch { /* ignore corrupt cache */ }
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

    // Save Timezone — coerce just in case some legacy code calls setTimezone
    // with an invalid value, so the persisted state stays self-healing.
    useEffect(() => {
        const safe = safeTimezone(timezone);
        localStorage.setItem('preferred_timezone', safe);
        if (safe !== timezone) {
            setTimezone(safe);
        }
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

    const handleDisconnectFacebook = async () => {
        // Two backend states to clear so F5 doesn't auto-reconnect:
        //   (a) UserFacebookConnection — DELETE /connection
        //   (b) Adlux access rows — DELETE /unclaim-account per accountId
        // Without (b), an adlux-pool user logs out, F5, and /connection-accounts
        // happily returns their claimed accounts again → instant re-login.
        if (shopifyConfig?.storeUrl && shopifyConfig?.accessToken) {
            const fbHeaders = {
                'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                'X-Shopify-Access-Token': shopifyConfig.accessToken
            };
            try {
                await fetch('/api/facebook/connection', { method: 'DELETE', headers: fbHeaders });
            } catch (err) {
                console.warn('Backend FB disconnect failed:', err);
            }
            // Bulk-unclaim adlux accounts. Best-effort: if any one call fails,
            // keep going so the user isn't half-logged-out.
            await Promise.all(
                facebookAccounts.map(acc =>
                    fetch(`/api/facebook/unclaim-account?accountId=${encodeURIComponent(acc.id)}`, {
                        method: 'DELETE',
                        headers: fbHeaders
                    }).catch(err => console.warn(`Unclaim ${acc.id} failed:`, err))
                )
            );
        }

        // Best-effort FB SDK logout so the user's FB session cookie is
        // released too. Wrapped in try/catch because the SDK may not be
        // loaded (if user never clicked Connect this session).
        try {
            if (typeof window !== 'undefined' && (window as any).FB?.logout) {
                (window as any).FB.logout();
            }
        } catch { /* SDK not loaded — fine */ }

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
