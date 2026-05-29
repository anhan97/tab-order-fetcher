/**
 * Wrapper for the auto-launch ads feature.
 *
 * Two inner tabs: the campaign-builder wizard (default) and the launch
 * history. FacebookPage mounts this under its "Auto-launch" tab.
 *
 * State lives inside the children — this component is purely a layout
 * shell so the parent's facebookAccounts prop is its only input.
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Rocket, History } from 'lucide-react';
import { CampaignWizard } from './campaign-builder/CampaignWizard';
import { LaunchHistory } from './campaign-builder/LaunchHistory';

interface AutoLaunchAdsProps {
  adAccounts: Array<{ id: string; name: string }>;
}

export const AutoLaunchAds = ({ adAccounts }: AutoLaunchAdsProps) => {
  return (
    <Tabs defaultValue="wizard" className="space-y-4">
      <TabsList>
        <TabsTrigger value="wizard" className="gap-2">
          <Rocket className="h-4 w-4" />
          New launch
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-2">
          <History className="h-4 w-4" />
          History
        </TabsTrigger>
      </TabsList>

      <TabsContent value="wizard" className="m-0">
        <CampaignWizard adAccounts={adAccounts} />
      </TabsContent>

      <TabsContent value="history" className="m-0">
        <LaunchHistory />
      </TabsContent>
    </Tabs>
  );
};
