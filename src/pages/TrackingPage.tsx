import { TrackingUpload } from '@/components/TrackingUpload';
import { useAppContext } from '@/context/AppContext';

export const TrackingPage = () => {
    const { shopifyConfig } = useAppContext();

    if (!shopifyConfig) return null;

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-semibold text-slate-900">Tracking Upload</h2>
            <TrackingUpload shopifyConfig={shopifyConfig} />
        </div>
    );
};
