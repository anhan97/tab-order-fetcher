/**
 * Admin panel: delegate one store to people who don't own it.
 *
 * Ownership never moves — ShopifyStore.userId stays put. This only edits
 * StoreMember rows, so revoking is instant and complete: a member never held
 * the store's Shopify token, only the right to ask our API on its behalf.
 *
 * Roles mirror backend/src/lib/store-access.ts. Keep the two lists in step.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Loader2, Trash2, UserPlus, Crown } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

export const STORE_ROLES = ['manager', 'cs', 'finance', 'viewer'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

/** One line each, so the admin picks a role without reading the source. */
const ROLE_HELP: Record<StoreRole, string> = {
  manager: 'Toàn quyền trong store này (trừ xoá store và cấp quyền cho người khác)',
  cs:      'Xem mọi thứ + xử lý đơn: đổi trạng thái, nhập tracking, export',
  finance: 'Xem mọi thứ + sửa chi phí: COGS, pricebook, chi phí vận hành',
  viewer:  'Chỉ xem, không sửa được gì'
};

const ROLE_BADGE: Record<string, string> = {
  manager: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cs:      'bg-sky-100 text-sky-700 border-sky-200',
  finance: 'bg-violet-100 text-violet-700 border-violet-200',
  viewer:  'bg-slate-100 text-slate-600 border-slate-200'
};

interface Member {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  role: string;
  capabilities: string[];
  createdAt: string;
}

interface Owner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface Props {
  storeId: string | null;
  storeLabel: string;
  onClose: () => void;
}

export const StoreMembersDialog = ({ storeId, storeLabel, onClose }: Props) => {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StoreRole>('cs');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const r = await apiFetch<{ owner: Owner; members: Member[] }>(
        `/api/admin/stores/${storeId}/members`
      );
      setMembers(r.members || []);
      setOwner(r.owner || null);
    } catch (e: any) {
      toast({ title: 'Không tải được danh sách', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => { void load(); }, [load]);

  const grant = async (targetEmail: string, targetRole: StoreRole) => {
    if (!storeId || !targetEmail.trim()) return;
    setBusy('grant');
    try {
      await apiFetch(`/api/admin/stores/${storeId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ email: targetEmail.trim(), role: targetRole })
      });
      toast({ title: 'Đã cấp quyền', description: `${targetEmail} → ${targetRole}` });
      setEmail('');
      await load();
    } catch (e: any) {
      toast({ title: 'Cấp quyền thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (userId: string, label: string) => {
    if (!storeId) return;
    if (!confirm(`Thu hồi quyền của ${label} trên store này?`)) return;
    setBusy(userId);
    try {
      await apiFetch(`/api/admin/stores/${storeId}/members/${userId}`, { method: 'DELETE' });
      toast({ title: 'Đã thu hồi', description: label });
      await load();
    } catch (e: any) {
      toast({ title: 'Thu hồi thất bại', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!storeId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Phân quyền store</DialogTitle>
          <DialogDescription className="font-mono text-xs">{storeLabel}</DialogDescription>
        </DialogHeader>

        {owner && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <Crown className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-slate-700">Chủ sở hữu:</span>
            <span className="font-mono text-xs">{owner.email}</span>
            <span className="text-xs text-slate-500 ml-auto">Toàn quyền, không thể thu hồi</span>
          </div>
        )}

        {/* Grant / re-grant. The endpoint upserts, so entering an existing
            member's email simply changes their role. */}
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <Label className="text-xs uppercase tracking-wide text-slate-500">Cấp quyền cho người khác</Label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void grant(email, role); }}
                placeholder="email@dathangky.com"
                className="h-9"
              />
            </div>
            <Select value={role} onValueChange={v => setRole(v as StoreRole)}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STORE_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9" disabled={busy === 'grant' || !email.trim()}
                    onClick={() => void grant(email, role)}>
              {busy === 'grant'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <UserPlus className="h-3.5 w-3.5 mr-1" />}
              Cấp
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">{ROLE_HELP[role]}</p>
          <p className="text-[11px] text-slate-400">
            Người nhận phải đã đăng ký tài khoản. Nhập email của người đã là member để đổi vai trò.
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Đang tải…
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Chưa cấp cho ai. Chỉ chủ sở hữu vào được store này.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Người dùng</th>
                  <th className="text-left px-3 py-2">Vai trò</th>
                  <th className="text-left px-3 py-2">Làm được gì</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.userId} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{m.email}</div>
                      {m.status !== 'ACTIVE' && (
                        <Badge variant="outline" className="mt-0.5 text-[10px]">{m.status}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={m.role}
                        onValueChange={v => void grant(m.email, v as StoreRole)}
                      >
                        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STORE_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {m.capabilities.map(c => (
                          <Badge key={c} variant="outline" className={`text-[10px] ${ROLE_BADGE[m.role] || ''}`}>
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        disabled={busy === m.userId}
                        onClick={() => void revoke(m.userId, m.email)}
                        title="Thu hồi quyền"
                      >
                        {busy === m.userId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
