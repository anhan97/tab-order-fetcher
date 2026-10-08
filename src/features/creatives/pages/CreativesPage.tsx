/**
 * Creative library: upload creatives, browse them, pick some in order and
 * launch them (Quick launch or the full Ads Launcher); Posts tab to reuse
 * posts that already ran (spec §3.1, §10.2).
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Images, Loader2, Megaphone, Store, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { useProducts } from '@/features/ads-launcher/hooks/queries';
import { useUploadQueue } from '../hooks/use-upload-queue';
import { CreativeLibrary } from '../components/CreativeLibrary';
import { PostLibrary } from '../components/PostLibrary';
import { UploadCreativesDialog } from '../components/UploadCreativesDialog';

type Tab = 'creatives' | 'posts';

export function CreativesPage() {
  const { activeStore, canInStore } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'posts' ? 'posts' : 'creatives';
  const setTab = (t: Tab) =>
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (t === 'posts') next.set('tab', 'posts');
      else next.delete('tab');
      return next;
    }, { replace: true });

  // Keep a tab mounted once opened, so switching tabs keeps filters and selection.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

  const [productId, setProductId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const products = useProducts();
  const queue = useUploadQueue();

  if (!activeStore) {
    return (
      <div className="mx-auto mt-8 max-w-2xl">
        <Card className="p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
            <Store className="h-7 w-7" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-slate-900">No store selected</h2>
          <p className="text-slate-600">Pick or connect a store in the sidebar to see its creatives.</p>
        </Card>
      </div>
    );
  }

  if (!canInStore('read')) {
    return (
      <div className="mx-auto mt-8 max-w-2xl">
        <Card className="p-10 text-center">
          <h2 className="mb-2 text-xl font-bold text-slate-900">No access</h2>
          <p className="text-slate-600">Your role in this store does not include the creative library. Ask the store owner for access.</p>
        </Card>
      </div>
    );
  }

  const canManage = canInStore('manage');
  const uploading = queue.running;

  return (
    <div className="min-w-0 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 p-2 shadow-lg shadow-teal-500/30">
          <Images className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900">Creatives</h1>
          <p className="text-xs text-slate-500">
            Upload images and videos, pick them in the order you want, then launch them as Meta ads.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-700"
          onClick={() => setUploadOpen(true)}
          disabled={!canManage}
          title={canManage ? undefined : 'Needs manage access to this store'}
        >
          {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1.5 h-4 w-4" />}
          {uploading ? `Uploading ${queue.counts.done}/${queue.counts.total}…` : 'Upload creatives'}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as Tab)} className="min-w-0">
        <TabsList>
          <TabsTrigger value="creatives" className="gap-1.5">
            <Images className="h-4 w-4" /> Creatives
          </TabsTrigger>
          <TabsTrigger value="posts" className="gap-1.5">
            <Megaphone className="h-4 w-4" /> Posts
          </TabsTrigger>
        </TabsList>

        {visited.has('creatives') && (
          <TabsContent value="creatives" forceMount className="mt-3 data-[state=inactive]:hidden">
            <CreativeLibrary
              productId={productId}
              onProductChange={setProductId}
              canManage={canManage}
              onUpload={() => setUploadOpen(true)}
            />
          </TabsContent>
        )}
        {visited.has('posts') && (
          <TabsContent value="posts" forceMount className="mt-3 data-[state=inactive]:hidden">
            <PostLibrary />
          </TabsContent>
        )}
      </Tabs>

      <UploadCreativesDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        products={products.data}
        productsLoading={products.isLoading}
        defaultProductId={productId}
        queue={queue}
      />
    </div>
  );
}
