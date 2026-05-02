import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAppContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { cn } from '@/lib/utils';
import {
    ShoppingBag,
    Settings,
    Upload,
    BarChart3,
    LogOut,
    DollarSign,
    PieChart as PieChartIcon,
    Menu,
    TrendingUp,
    LayoutDashboard
} from 'lucide-react';
import { useState } from 'react';

const PAGE_SUBTITLES: Record<string, string> = {
    Dashboard: 'KPIs, daily breakdown, and order list',
    Tracking: 'Bulk-upload tracking numbers to Shopify',
    Analytics: 'Cross-channel ROAS & ad performance',
    'P&L': 'Daily / period profit, costs, and operating expenses',
    COGS: 'Per-variant baseCost, supplier overrides, shipping tiers',
    Facebook: 'Ad accounts portfolio, campaigns, ad sets, ads',
    Content: 'Content performance & engagement breakdown'
};

export const Layout = () => {
    const {
        isShopifyConnected,
        isFacebookConnected,
        handleDisconnectShopify,
        handleDisconnectFacebook,
        timezone,
        setTimezone
    } = useAppContext();

    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const navItems = [
        // /orders is kept as the route for back-compat; the page itself is now
        // the merchant Dashboard (KPI cards, charts, full order list).
        { path: '/orders', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/tracking', label: 'Tracking', icon: Upload },
        { path: '/analytics', label: 'Analytics', icon: BarChart3 },
        { path: '/profit', label: 'P&L', icon: TrendingUp },
        { path: '/cogs', label: 'COGS', icon: DollarSign },
        { path: '/facebook', label: 'Facebook', icon: Settings },
        { path: '/content', label: 'Content', icon: PieChartIcon },
    ];

    const activeNavItem = navItems.find(i => i.path === location.pathname);
    const subtitle = activeNavItem ? PAGE_SUBTITLES[activeNavItem.label] : '';

    return (
        <div className="min-h-screen bg-slate-50 flex">
            {/* Sidebar Navigation */}
            <aside className={cn(
                "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200/80 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0 flex flex-col",
                isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="h-16 flex items-center px-6 border-b border-slate-200/80 shrink-0">
                    <div className="p-2 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl mr-3 shadow-sm shadow-teal-500/30">
                        <ShoppingBag className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold text-base text-slate-900 leading-tight">Order Manager</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Profit Suite</span>
                    </div>
                </div>

                <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={cn(
                                    "group relative flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all",
                                    isActive
                                        ? "bg-gradient-to-r from-teal-50 to-teal-50/40 text-teal-700"
                                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                )}
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                {isActive && (
                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 bg-teal-500 rounded-r-full" />
                                )}
                                <item.icon className={cn(
                                    "h-[18px] w-[18px] mr-3 transition-colors",
                                    isActive ? "text-teal-500" : "text-slate-400 group-hover:text-slate-600"
                                )} />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="border-t border-slate-200/80 p-3 space-y-1.5 shrink-0">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 px-2 pb-1">Connections</p>
                    <ConnectionPill
                        label="Shopify"
                        connected={isShopifyConnected}
                        accent="teal"
                        onDisconnect={handleDisconnectShopify}
                    />
                    <ConnectionPill
                        label="Facebook"
                        connected={isFacebookConnected}
                        accent="blue"
                        onDisconnect={handleDisconnectFacebook}
                    />
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <div className="lg:hidden flex items-center justify-between bg-white border-b border-slate-200/80 px-4 py-3">
                    <div className="flex items-center">
                        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                            <Menu className="h-6 w-6" />
                        </Button>
                        <span className="ml-3 font-bold text-slate-900">{activeNavItem?.label || 'Order Manager'}</span>
                    </div>
                </div>

                {/* Top Bar */}
                <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-8 py-4 hidden lg:flex items-center justify-between sticky top-0 z-30">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 leading-tight">
                            {activeNavItem?.label || 'Dashboard'}
                        </h1>
                        {subtitle && (
                            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                        )}
                    </div>

                    <div className="flex items-center space-x-3">
                        <TimezoneSelect
                            value={timezone}
                            onValueChange={setTimezone}
                            aria-label="Select timezone"
                        />
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto p-4 sm:p-8">
                    <Outlet />
                </main>

                {/* Footer */}
                <footer className="bg-white border-t border-slate-200/80 px-4 sm:px-8 py-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between text-sm text-slate-500">
                        <p>© {new Date().getFullYear()} Order Manager. All rights reserved.</p>
                        <div className="flex items-center space-x-4 mt-2 sm:mt-0">
                            <Link to="/privacy" className="hover:text-slate-700 transition-colors">
                                Privacy Policy
                            </Link>
                            <span className="text-slate-300">|</span>
                            <Link to="/terms" className="hover:text-slate-700 transition-colors">
                                Terms of Service
                            </Link>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
};

interface ConnectionPillProps {
    label: string;
    connected: boolean;
    accent: 'teal' | 'blue';
    onDisconnect: () => void;
}

function ConnectionPill({ label, connected, accent, onDisconnect }: ConnectionPillProps) {
    if (!connected) {
        return (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 border-dashed">
                <div className="w-2 h-2 bg-slate-300 rounded-full" />
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">Off</span>
            </div>
        );
    }
    const tone = accent === 'teal'
        ? { bg: 'from-teal-50 to-teal-50/40', border: 'border-teal-100', dot: 'bg-teal-500', text: 'text-teal-700', hover: 'hover:bg-teal-100', hoverText: 'hover:text-teal-900' }
        : { bg: 'from-blue-50 to-blue-50/40', border: 'border-blue-100', dot: 'bg-blue-500', text: 'text-blue-700', hover: 'hover:bg-blue-100', hoverText: 'hover:text-blue-900' };
    return (
        <div className={cn("flex items-center justify-between px-3 py-2 rounded-lg bg-gradient-to-r border", tone.bg, tone.border)}>
            <div className="flex items-center space-x-2 min-w-0">
                <div className="relative shrink-0">
                    <div className={cn("w-2 h-2 rounded-full animate-pulse", tone.dot)} />
                    <div className={cn("absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-50", tone.dot)} />
                </div>
                <span className={cn("text-xs font-semibold truncate", tone.text)}>{label}</span>
            </div>
            <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6 shrink-0", tone.text, tone.hover, tone.hoverText)}
                onClick={onDisconnect}
                title={`Disconnect ${label}`}
            >
                <LogOut className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}
