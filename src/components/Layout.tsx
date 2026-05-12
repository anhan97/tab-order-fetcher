import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { useAppContext } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
    LayoutDashboard,
    Store as StoreIcon,
    Plus,
    User as UserIcon,
    LogOut as SignOutIcon,
    ShieldCheck
} from 'lucide-react';
import { useState } from 'react';

const PAGE_SUBTITLES: Record<string, string> = {
    Dashboard: 'KPIs, daily breakdown, and order list',
    Tracking: 'Bulk-upload tracking numbers to Shopify',
    Analytics: 'Cross-channel ROAS & ad performance',
    'P&L': 'Daily / period profit, costs, and operating expenses',
    COGS: 'Per-variant baseCost, supplier overrides, shipping tiers',
    Facebook: 'Ad accounts portfolio, campaigns, ad sets, ads',
    Content: 'Content performance & engagement breakdown',
    Admin: 'Users, FB apps, and system-wide health'
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

    const { user, stores, activeStore, setActiveStoreByDomain, logout } = useAuth();

    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    const userDisplayName = user
        ? (user.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : user.email)
        : '';
    const userInitials = (user?.firstName?.[0] || user?.email?.[0] || '?').toUpperCase();

    // Role-aware nav. Each item tags which roles can SEE it; the menu is
    // filtered at render time. Server endpoints are still the source of
    // truth — hiding a link only cleans up the UI, it doesn't grant access.
    //
    //   admin    — all
    //   user     — merchant (their stores + ads)
    //   cs       — fulfillment only (orders + tracking)
    //   finance  — money only (P&L / COGS, no ads management)
    const role = (user?.role || 'user') as 'admin' | 'user' | 'cs' | 'finance';
    const ALL_ROLES = ['admin', 'user', 'cs', 'finance'] as const;
    type NavRole = typeof ALL_ROLES[number];
    const navCatalog: Array<{ path: string; label: string; icon: typeof LayoutDashboard; roles: NavRole[] }> = [
        { path: '/orders',   label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'user', 'cs', 'finance'] },
        { path: '/tracking', label: 'Tracking',  icon: Upload,          roles: ['admin', 'user', 'cs'] },
        { path: '/cogs',     label: 'COGS',      icon: DollarSign,      roles: ['admin', 'user', 'finance'] },
        { path: '/facebook', label: 'Facebook',  icon: BarChart3,       roles: ['admin', 'user'] },
        { path: '/content',  label: 'Content',   icon: PieChartIcon,    roles: ['admin', 'user'] },
        { path: '/admin',    label: 'Admin',     icon: ShieldCheck,     roles: ['admin'] }
    ];
    const navItems = navCatalog.filter(i => i.roles.includes(role));

    const activeNavItem = navItems.find(i => i.path === location.pathname);
    const subtitle = activeNavItem ? PAGE_SUBTITLES[activeNavItem.label] : '';

    return (
        // h-screen (not min-h-screen) so only the inner <main> scrolls — was
        // creating a double scrollbar on tall pages like Adlux Settings.
        <div className="h-screen bg-slate-50 flex overflow-hidden">
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

                {/* Active store switcher — visible whenever the user has at
                    least one store. Picking a different store rebinds every
                    downstream API call to that store's domain. */}
                {user && stores.length > 0 && (
                    <div className="border-t border-slate-200/80 p-3 space-y-1.5 shrink-0">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 px-2 pb-1 flex items-center gap-1">
                            <StoreIcon className="h-3 w-3" />
                            Active store
                        </p>
                        <Select
                            value={activeStore?.storeDomain || ''}
                            onValueChange={(v) => setActiveStoreByDomain(v)}
                        >
                            <SelectTrigger className="w-full h-9 text-xs">
                                <SelectValue placeholder="Pick store..." />
                            </SelectTrigger>
                            <SelectContent>
                                {stores.map(s => (
                                    <SelectItem key={s.id} value={s.storeDomain}>
                                        <div className="truncate max-w-[180px]">
                                            {s.name || s.storeDomain}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-xs text-slate-600 hover:text-slate-900"
                            onClick={() => navigate('/connect')}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Add another store
                        </Button>
                    </div>
                )}

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
                        {user && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-9 px-2 gap-2">
                                        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white text-xs font-semibold flex items-center justify-center">
                                            {userInitials}
                                        </div>
                                        <span className="hidden md:inline text-sm text-slate-700 max-w-[140px] truncate">{userDisplayName}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuLabel className="font-normal">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-xs text-slate-500">Signed in as</span>
                                            <span className="text-sm font-medium truncate">{user.email}</span>
                                            <span className={cn(
                                                "text-[10px] uppercase tracking-wider font-semibold mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded w-fit",
                                                role === 'admin'   ? "bg-amber-100 text-amber-700"   :
                                                role === 'finance' ? "bg-violet-100 text-violet-700" :
                                                role === 'cs'      ? "bg-sky-100 text-sky-700"       :
                                                                     "bg-slate-100 text-slate-600"
                                            )}>
                                                {role === 'admin' && <ShieldCheck className="h-3 w-3" />}
                                                {role}
                                            </span>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                        <Link to="/connect" className="cursor-pointer">
                                            <UserIcon className="h-4 w-4 mr-2" />
                                            Manage stores
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={handleLogout} className="text-rose-600 focus:text-rose-700 cursor-pointer">
                                        <SignOutIcon className="h-4 w-4 mr-2" />
                                        Sign out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
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
