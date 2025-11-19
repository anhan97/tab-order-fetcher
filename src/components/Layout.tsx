import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAppContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimezoneSelect } from '@/components/ui/timezone-select';
import { DatePreset } from "@/components/ui/date-range-picker";
import { cn } from '@/lib/utils';
import {
    ShoppingBag,
    Download,
    Settings,
    Upload,
    BarChart3,
    LogOut,
    DollarSign,
    PieChart as PieChartIcon,
    LayoutDashboard,
    Menu
} from 'lucide-react';
import { useState } from 'react';

export const Layout = () => {
    const {
        isShopifyConnected,
        isFacebookConnected,
        handleDisconnectShopify,
        handleDisconnectFacebook,
        selectedDatePreset,
        setSelectedDatePreset,
        setDateRange,
        timezone,
        setTimezone,
        loadAllAccountsSpend,
        facebookAccounts
    } = useAppContext();

    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleDatePresetChange = async (value: DatePreset) => {
        console.log('Date range picker changed to:', value);
        setSelectedDatePreset(value);
        const now = new Date();
        let from: Date;
        let newDateRange: { from: Date; to: Date };

        switch (value) {
            case 'today':
                from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                newDateRange = { from, to: from };
                break;
            case 'last7days':
                from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                newDateRange = { from, to: now };
                break;
            case 'last30days':
                from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                newDateRange = { from, to: now };
                break;
            default:
                from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                newDateRange = { from, to: now };
        }

        setDateRange(newDateRange);

        if (isFacebookConnected && facebookAccounts.length > 0) {
            loadAllAccountsSpend(newDateRange);
        }
    };

    const navItems = [
        { path: '/orders', label: 'Orders', icon: ShoppingBag },
        { path: '/tracking', label: 'Tracking', icon: Upload },
        { path: '/analytics', label: 'Analytics', icon: BarChart3 },
        { path: '/cogs', label: 'COGS', icon: DollarSign },
        { path: '/facebook', label: 'Facebook', icon: Settings },
        { path: '/content', label: 'Content', icon: PieChartIcon },
    ];

    return (
        <div className="min-h-screen bg-slate-50 flex">
            {/* Sidebar Navigation */}
            <aside className={cn(
                "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0",
                isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="h-16 flex items-center px-6 border-b border-slate-200">
                    <div className="p-2 bg-teal-500 rounded-lg mr-3">
                        <ShoppingBag className="h-5 w-5 text-white" />
                    </div>
                    <span className="font-bold text-lg text-slate-900">Order Manager</span>
                </div>

                <nav className="p-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={cn(
                                    "flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors",
                                    isActive
                                        ? "bg-teal-50 text-teal-700"
                                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                )}
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                <item.icon className={cn("h-5 w-5 mr-3", isActive ? "text-teal-500" : "text-slate-400")} />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200">
                    <div className="space-y-2">
                        {isShopifyConnected && (
                            <div className="flex items-center justify-between px-4 py-2 bg-teal-50 rounded-lg">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
                                    <span className="text-sm font-medium text-teal-700">Shopify</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-teal-700 hover:text-teal-800" onClick={handleDisconnectShopify}>
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                        {isFacebookConnected && (
                            <div className="flex items-center justify-between px-4 py-2 bg-blue-50 rounded-lg">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                                    <span className="text-sm font-medium text-blue-700">Facebook</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-700 hover:text-blue-800" onClick={handleDisconnectFacebook}>
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <div className="lg:hidden flex items-center justify-between bg-white border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center">
                        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                            <Menu className="h-6 w-6" />
                        </Button>
                        <span className="ml-3 font-bold text-slate-900">Order Manager</span>
                    </div>
                </div>

                {/* Top Bar */}
                <header className="bg-white border-b border-slate-200 px-8 py-4 hidden lg:flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-slate-900">
                        {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
                    </h1>

                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                            <Select value={selectedDatePreset} onValueChange={handleDatePresetChange}>
                                <SelectTrigger className="w-36">
                                    <SelectValue placeholder="Date Range" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="today">Today</SelectItem>
                                    <SelectItem value="last7days">Last 7 days</SelectItem>
                                    <SelectItem value="last30days">Last 30 days</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

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
            </div>
        </div>
    );
};
