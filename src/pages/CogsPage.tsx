import { MinimalCOGSManagement } from '@/components/MinimalCOGSManagement';
import { useAppContext } from '@/context/AppContext';

export const CogsPage = () => {
    const { handleUpdateCOGS } = useAppContext();

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-semibold text-slate-900">COGS Management</h2>
            <MinimalCOGSManagement onUpdateCOGS={handleUpdateCOGS} />
        </div>
    );
};
