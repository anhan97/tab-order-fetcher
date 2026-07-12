/**
 * Fulfillment view (ShipBob-style) — DB-backed orders whose whole shipping
 * lifecycle syncs automatically from Shopify (webhooks + scheduler +
 * fulfillment shipment_status). READ-ONLY by design: no manual status
 * changes or cancellations here — manage the order on Shopify and it
 * reflects back. Actions: search, detail, CSV export for fulfillment.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Loader2, Search, Download, RefreshCw,
  ChevronLeft, ChevronRight, Eye, PackageOpen
} from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { OrderExportDialog } from '@/components/OrderExportDialog';

interface FulfillOrder {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  totalAmount: number;
  currency: string;
  status: string;            // Shopify financial status
  fulfillStatus: string;     // internal lifecycle
  deliveryStatus: string | null;
  trackingNumber: string | null;
  shippingCompany: string | null;
  shippingAddress: Record<string, string | null> | null;
  processedAt: string | null;
  lineItems: Array<{ id: string; title: string | null; sku: string | null; quantity: number; price: string | number }>;
}

const STATUS_TABS = ['ALL', 'PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'UNPAID'] as const;

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SHIPPED: 'bg-violet-100 text-violet-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700'
};

const PAGE_SIZE = 50;

export const FulfillmentPage = () => {
  const { activeStore } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [orders, setOrders] = useState<FulfillOrder[]>([]);
  const [tabs, setTabs] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<FulfillOrder | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (q) params.set('q', q);
      if (tab === 'UNPAID') params.set('paymentStatus', 'unpaid');
      else if (tab !== 'ALL') params.set('fulfillStatus', tab);
      const r = await apiFetch<{ orders: FulfillOrder[]; total: number; tabs: Record<string, number> }>(
        `/api/orders?${params}`
      );
      setOrders(r.orders);
      setTotal(r.total);
      setTabs(r.tabs || {});
    } catch (e: any) {
      toast({ title: 'Không tải được đơn hàng', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeStore, tab, q, offset, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setOffset(0); }, [tab, q]);

  const handleSync = async () => {
    if (!activeStore) return;
    setSyncing(true);
    try {
      await apiFetch(`/api/shopify/stores/${activeStore.id}/sync`, { method: 'POST' });
      toast({ title: 'Đã đồng bộ đơn từ Shopify' });
      await load();
    } catch (e: any) {
      toast({ title: 'Đồng bộ thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const addressLine = (o: FulfillOrder): string => {
    const a = o.shippingAddress || {};
    return [a.address1, a.city, a.province, a.country].filter(Boolean).join(', ');
  };

  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  if (!activeStore) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Card className="p-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Chưa chọn store</h2>
          <p className="text-slate-600">Kết nối / chọn store ở sidebar trước khi quản lý fulfillment.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/30">
          <PackageOpen className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Fulfillment</h1>
          <p className="text-xs text-slate-500">
            Đơn + trạng thái giao hàng tự đồng bộ từ Shopify (webhook + 10 phút/lần) — quản lý đơn trên Shopify, ở đây chỉ xem &amp; export
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Đồng bộ ngay
        </Button>
        <Button size="sm" onClick={() => setExportOpen(true)} className="bg-teal-600 hover:bg-teal-700">
          <Download className="h-4 w-4 mr-1.5" />
          Export
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {STATUS_TABS.map(t => (
            <TabsTrigger key={t} value={t} className="gap-1.5">
              {t === 'ALL' ? 'Tất cả' : t === 'UNPAID' ? 'Chưa thanh toán' : t}
              <Badge variant="secondary" className="text-[10px] px-1.5">{tabs[t] ?? 0}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Tìm số đơn / tên / SĐT / tracking…"
            value={qDraft}
            onChange={e => setQDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qDraft.trim()); }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setQ(qDraft.trim())}>Tìm</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Đơn</TableHead>
                <TableHead>Ngày</TableHead>
                <TableHead>Khách hàng</TableHead>
                <TableHead>Sản phẩm</TableHead>
                <TableHead className="text-right">Tổng</TableHead>
                <TableHead>Thanh toán</TableHead>
                <TableHead>Fulfillment</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right">Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Đang tải…
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-slate-400">
                    Không có đơn nào. Bấm "Đồng bộ ngay" nếu vừa kết nối store.
                  </TableCell>
                </TableRow>
              ) : orders.map(o => (
                <TableRow key={o.id} className="hover:bg-slate-50/60">
                  <TableCell className="font-semibold">#{o.orderNumber}</TableCell>
                  <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                    {o.processedAt ? new Date(o.processedAt).toLocaleDateString('vi-VN') : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{o.customerName || '—'}</div>
                    <div className="text-xs text-slate-500">{o.customerPhone || o.customerEmail || ''}</div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="text-xs truncate">
                      {o.lineItems.map(li => `${li.quantity}× ${li.title ?? li.sku ?? '?'}`).join(', ') || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {o.totalAmount.toLocaleString()} {o.currency}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={o.status === 'paid' ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700'}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[o.fulfillStatus] || ''}>{o.fulfillStatus}</Badge>
                    {o.deliveryStatus && o.fulfillStatus !== 'DELIVERED' && (
                      <div className="text-[10px] text-slate-400 mt-0.5">{o.deliveryStatus}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{o.trackingNumber || '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {/* Read-only by design: trạng thái tự sync từ Shopify,
                        không có nút đổi trạng thái / huỷ / gắn tracking ở đây. */}
                    <Button variant="ghost" size="sm" onClick={() => setDetail(o)} title="Chi tiết">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total} đơn · trang {page}/{pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Đơn #{detail?.orderNumber}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="flex gap-2">
                <Badge className={STATUS_BADGE[detail.fulfillStatus] || ''}>{detail.fulfillStatus}</Badge>
                <Badge variant="outline">{detail.status}</Badge>
                {detail.deliveryStatus && <Badge variant="outline">{detail.deliveryStatus}</Badge>}
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Khách hàng</div>
                <div>{detail.customerName || '—'}</div>
                <div className="text-slate-500">{detail.customerEmail}</div>
                <div className="text-slate-500">{detail.customerPhone}</div>
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Địa chỉ giao hàng</div>
                <div className="text-slate-600">{addressLine(detail) || '—'}</div>
                {detail.shippingAddress?.zip && <div className="text-slate-500">Zip: {detail.shippingAddress.zip}</div>}
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Sản phẩm</div>
                {detail.lineItems.map(li => (
                  <div key={li.id} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{li.quantity}× {li.title ?? li.sku ?? '?'}</span>
                    <span className="text-slate-500">{li.price}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold pt-1.5">
                  <span>Tổng</span>
                  <span>{detail.totalAmount.toLocaleString()} {detail.currency}</span>
                </div>
              </div>
              {detail.trackingNumber && (
                <div>
                  <div className="font-semibold text-slate-900 mb-1">Tracking</div>
                  <div className="font-mono">{detail.trackingNumber}</div>
                  <div className="text-slate-500">{detail.shippingCompany}</div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <OrderExportDialog open={exportOpen} onOpenChange={setExportOpen} q={q} tab={tab} />
    </div>
  );
};
