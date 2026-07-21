import { useState } from 'react';
import { CogsMatrix } from '@/components/CogsMatrix';
import { MinimalCOGSManagement } from '@/components/MinimalCOGSManagement';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/context/AppContext';
import { Grid3X3, History } from 'lucide-react';

/**
 * COGS page. Default view = the Excel-style price matrix (rows = products,
 * columns = ship lines × set sizes). The legacy editor stays reachable behind
 * a toggle until the team fully migrates.
 */
export const CogsPage = () => {
    const { handleUpdateCOGS } = useAppContext();
    const [legacy, setLegacy] = useState(false);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-slate-900">
                    {legacy ? 'COGS (giao diện cũ)' : 'Bảng giá vốn (COGS)'}
                </h2>
                {!legacy && (
                    <p className="text-xs text-slate-500 hidden md:block">
                        Điền giá như Excel — mỗi cột là 1 line ship, mỗi ô là tổng giá vốn của set
                    </p>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setLegacy(v => !v)} className="text-slate-500">
                    {legacy ? <Grid3X3 className="h-4 w-4 mr-1.5" /> : <History className="h-4 w-4 mr-1.5" />}
                    {legacy ? 'Về bảng giá mới' : 'Giao diện cũ'}
                </Button>
            </div>
            {legacy
                ? <MinimalCOGSManagement onUpdateCOGS={handleUpdateCOGS} />
                : <CogsMatrix />}
        </div>
    );
};
