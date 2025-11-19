import { ContentAnalytics } from "@/components/ContentAnalytics";
import { useAppContext } from '@/context/AppContext';

export const ContentAnalyticsPage = () => {
    const {
        selectedAccount,
        orders,
        campaigns,
        adSets,
        ads,
        dateRange,
        setDateRange,
        selectedDatePreset,
        setSelectedDatePreset
    } = useAppContext();

    if (!selectedAccount) {
        return (
            <div className="text-center p-8 text-slate-500">
                Please select a Facebook Ad Account to view content analytics.
            </div>
        );
    }

    return (
        <ContentAnalytics
            orders={orders}
            campaigns={campaigns}
            adSets={adSets}
            ads={ads}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            selectedPreset={selectedDatePreset}
            onPresetChange={setSelectedDatePreset}
        />
    );
};
