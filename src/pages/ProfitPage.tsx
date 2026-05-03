import { ProfitView } from '@/components/ProfitView';

/**
 * P&L page — single merged view (Daily + Period collapsed into one).
 * Date range, period grouping, sync, recompute, COGS tools, CSV import,
 * and margin alerts all live inside ProfitView.
 */
export const ProfitPage = () => {
  return <ProfitView />;
};
