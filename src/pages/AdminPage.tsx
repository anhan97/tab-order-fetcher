import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Loader2, Search, ShieldCheck, Users, Store as StoreIcon, AppWindow, Link2,
  ChevronLeft, AlertCircle, Plus, Trash2
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';
import { FacebookAppsManager } from '@/components/FacebookAppsManager';
import { ShopifyAppConfigCard } from '@/components/ShopifyAppConfigCard';

interface AdminStats {
  users: number;
  admins: number;
  pendingUsers?: number;
  stores: number;
  fbApps: number;
  fbConnections: number;
}

interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string; // PENDING | ACTIVE | SUSPENDED
  isVerified: boolean;
  createdAt: string;
  storeCount: number;
  fbAppCount: number;
  fbConnectionCount: number;
}

interface AdminUserDetail {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    isVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  stores: Array<{
    id: string;
    storeDomain: string;
    name: string | null;
    isActive: boolean;
    defaultShippingCompany: string | null;
    defaultSupplier: string | null;
    createdAt: string;
  }>;
  fbApps: Array<{
    id: string;
    fbAppId: string;
    fbBmId: string | null;
    appName: string | null;
    isActive: boolean;
    isDefault: boolean;
    lastError: string | null;
    secretLength: number;
    createdAt: string;
  }>;
  fbConnections: Array<{
    id: string;
    fbAppId: string;
    fbUserId: string;
    fbUserName: string | null;
    expiresAt: string | null;
    lastRefreshedAt: string | null;
    lastUsedAt: string | null;
    lastError: string | null;
  }>;
}

interface AdminStoreRow {
  id: string;
  storeDomain: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  userLastName: string | null;
  userRole: string;
  orderCount: number;
}

type RoleValue = 'admin' | 'user' | 'cs' | 'finance';
const ROLE_OPTIONS: RoleValue[] = ['admin', 'user', 'cs', 'finance'];

function statusBadgeClasses(status: string): string {
  if (status === 'ACTIVE')    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'PENDING')   return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'SUSPENDED') return 'bg-rose-100 text-rose-700 border-rose-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function roleBadgeClasses(role: string): string {
  if (role === 'admin')   return 'bg-amber-100 text-amber-700 border-amber-200';
  if (role === 'finance') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (role === 'cs')      return 'bg-sky-100 text-sky-700 border-sky-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export const AdminPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [stores, setStores] = useState<AdminStoreRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [storesLoading, setStoresLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'stores' | 'apps'>('users');

  const loadUsers = async (q = '') => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        apiFetch<AdminStats>('/api/admin/stats'),
        apiFetch<{ users: AdminUserSummary[] }>(`/api/admin/users?q=${encodeURIComponent(q)}&limit=100`)
      ]);
      setStats(s);
      setUsers(u.users);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  };

  const loadStores = async (q = '') => {
    setStoresLoading(true);
    try {
      const r = await apiFetch<{ stores: AdminStoreRow[] }>(
        `/api/admin/stores?q=${encodeURIComponent(q)}&limit=200&includeInactive=1`
      );
      setStores(r.stores);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
      }
    } finally {
      setStoresLoading(false);
    }
  };

  // Approval gate action: duyệt (PENDING→ACTIVE), khoá (→SUSPENDED, thu hồi
  // toàn bộ phiên), mở khoá (→ACTIVE).
  const changeStatus = async (target: AdminUserSummary, status: 'ACTIVE' | 'SUSPENDED') => {
    if (status === 'SUSPENDED' && !confirm(`Khoá tài khoản ${target.email}? Mọi phiên đăng nhập của họ sẽ bị thu hồi.`)) return;
    try {
      await apiFetch(`/api/admin/users/${target.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      toast({
        title: status === 'ACTIVE'
          ? (target.status === 'PENDING' ? `Đã duyệt ${target.email}` : `Đã mở khoá ${target.email}`)
          : `Đã khoá ${target.email}`
      });
      await loadUsers(userSearch);
    } catch (e: any) {
      toast({ title: 'Đổi trạng thái thất bại', description: e.message, variant: 'destructive' });
    }
  };

  useEffect(() => { void loadUsers(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (activeTab === 'stores' && stores.length === 0) void loadStores();
    // eslint-disable-next-line
  }, [activeTab]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await apiFetch<AdminUserDetail>(`/api/admin/users/${id}`);
      setSelected(d);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!selected) return;
    const d = await apiFetch<AdminUserDetail>(`/api/admin/users/${selected.user.id}`);
    setSelected(d);
  };

  if (forbidden || (user && user.role && user.role !== 'admin')) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This page is restricted to admin users. Contact the system owner to grant
            access (set <code className="font-mono">ADMIN_EMAIL</code> on the backend
            and re-login).
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading admin dashboard…
      </div>
    );
  }

  if (selected) {
    return (
      <AdminUserDetailView
        detail={selected}
        onBack={() => setSelected(null)}
        onChanged={refreshDetail}
        onRoleChanged={() => { void loadUsers(userSearch); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard icon={<Users className="h-4 w-4 text-slate-400" />} label="Users" value={stats.users} />
          <StatCard icon={<ShieldCheck className="h-4 w-4 text-amber-500" />} label="Admins" value={stats.admins} />
          <StatCard icon={<Users className="h-4 w-4 text-rose-500" />} label="Chờ duyệt" value={stats.pendingUsers ?? 0} />
          <StatCard icon={<StoreIcon className="h-4 w-4 text-emerald-500" />} label="Stores" value={stats.stores} />
          <StatCard icon={<AppWindow className="h-4 w-4 text-blue-500" />} label="FB Apps" value={stats.fbApps} />
          <StatCard icon={<Link2 className="h-4 w-4 text-violet-500" />} label="FB Connections" value={stats.fbConnections} />
        </div>
      )}

      {/* Shopify App (OAuth) hệ thống — admin cấu hình 1 app dùng chung */}
      <ShopifyAppConfigCard />

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'users' | 'stores' | 'apps')}>
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" /> Users
          </TabsTrigger>
          <TabsTrigger value="stores" className="gap-2">
            <StoreIcon className="h-4 w-4" /> All stores
          </TabsTrigger>
          <TabsTrigger value="apps" className="gap-2">
            <AppWindow className="h-4 w-4" /> FB Apps
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Users</span>
                <div className="flex items-center gap-2 max-w-md flex-1">
                  <div className="relative flex-1">
                    <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void loadUsers(userSearch); }}
                      placeholder="Search by email…"
                      className="pl-8 h-9"
                    />
                  </div>
                  <Button size="sm" onClick={() => loadUsers(userSearch)} disabled={loading}>
                    Search
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2">Email</th>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-left px-4 py-2">Role</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Stores</th>
                      <th className="text-right px-4 py-2">FB Apps</th>
                      <th className="text-right px-4 py-2">Connections</th>
                      <th className="text-left px-4 py-2">Created</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-center py-10 text-slate-400">No users matched.</td>
                      </tr>
                    )}
                    {users.map(u => (
                      <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                        <td className="px-4 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-2">
                          <Badge className={roleBadgeClasses(u.role)}>{u.role}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge className={statusBadgeClasses(u.status)}>{u.status || 'ACTIVE'}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{u.storeCount}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{u.fbAppCount}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{u.fbConnectionCount}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{new Date(u.createdAt).toISOString().slice(0, 10)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {u.status === 'PENDING' && (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 mr-1"
                              onClick={() => changeStatus(u, 'ACTIVE')}
                            >
                              Duyệt
                            </Button>
                          )}
                          {u.status === 'ACTIVE' && u.id !== user?.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-rose-600 border-rose-200 hover:bg-rose-50 mr-1"
                              onClick={() => changeStatus(u, 'SUSPENDED')}
                            >
                              Khoá
                            </Button>
                          )}
                          {u.status === 'SUSPENDED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 mr-1"
                              onClick={() => changeStatus(u, 'ACTIVE')}
                            >
                              Mở khoá
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openDetail(u.id)}
                            disabled={detailLoading}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stores" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>All stores (cross-user)</span>
                <div className="flex items-center gap-2 max-w-md flex-1">
                  <div className="relative flex-1">
                    <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={storeSearch}
                      onChange={e => setStoreSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void loadStores(storeSearch); }}
                      placeholder="Search domain / email / name…"
                      className="pl-8 h-9"
                    />
                  </div>
                  <Button size="sm" onClick={() => loadStores(storeSearch)} disabled={storesLoading}>
                    {storesLoading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Search
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2">Domain</th>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-left px-4 py-2">Owner</th>
                      <th className="text-left px-4 py-2">Role</th>
                      <th className="text-right px-4 py-2">Orders</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-left px-4 py-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storesLoading && stores.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-10 text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading stores…
                      </td></tr>
                    )}
                    {!storesLoading && stores.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-10 text-slate-400">No stores matched.</td></tr>
                    )}
                    {stores.map(s => (
                      <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-2 font-mono text-xs">{s.storeDomain}</td>
                        <td className="px-4 py-2">{s.name || '—'}</td>
                        <td className="px-4 py-2">
                          <button
                            className="text-blue-600 hover:underline text-xs font-mono"
                            onClick={() => openDetail(s.userId)}
                          >
                            {s.userEmail}
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <Badge className={roleBadgeClasses(s.userRole)}>{s.userRole}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{s.orderCount}</td>
                        <td className="px-4 py-2">
                          {s.isActive
                            ? <Badge className="bg-emerald-100 text-emerald-700">active</Badge>
                            : <Badge variant="outline">inactive</Badge>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">{new Date(s.createdAt).toISOString().slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="apps" className="mt-4">
          {/* Admin-side FB Apps management lives here so it's reachable from
              one obvious place (/admin) instead of buried in /facebook.
              Same component runs in both spots — admins can use whichever
              entry point feels more natural. CRUD for apps + per-app
              "Users" dialog (multi-select with search) is inside. */}
          <Alert className="mb-3 border-blue-200 bg-blue-50/40">
            <AppWindow className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Register FB Apps you own on developers.facebook.com → paste the
              App ID + Secret here. Click <strong>Users</strong> on any app
              card to pick which non-admin users can connect Facebook through
              that app. Selected users see the Connect button on /facebook;
              unselected users see a "contact admin" message.
            </AlertDescription>
          </Alert>
          <FacebookAppsManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wider">
          {icon}{label}
        </div>
        <div className="text-2xl font-bold text-slate-900 mt-1">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function AdminUserDetailView({
  detail,
  onBack,
  onChanged,
  onRoleChanged
}: {
  detail: AdminUserDetail;
  onBack: () => void;
  onChanged: () => Promise<void> | void;
  onRoleChanged: () => void;
}) {
  const { toast } = useToast();
  const { user: me } = useAuth();
  const [updatingRole, setUpdatingRole] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const changeRole = async (newRole: RoleValue) => {
    if (newRole === detail.user.role) return;
    if (detail.user.id === me?.id && newRole !== 'admin') {
      toast({ title: 'Cannot demote yourself', variant: 'destructive' });
      return;
    }
    setUpdatingRole(true);
    try {
      await apiFetch(`/api/admin/users/${detail.user.id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });
      toast({ title: 'Role updated', description: `${detail.user.email} → ${newRole}` });
      await onChanged();
      onRoleChanged();
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    } finally {
      setUpdatingRole(false);
    }
  };

  const revokeApp = async (fbAppId: string) => {
    if (!confirm(`Revoke FB App ${fbAppId} from ${detail.user.email}?\nTheir FB connection for this app will be deleted too.`)) return;
    try {
      await apiFetch(`/api/admin/users/${detail.user.id}/fb-apps/${fbAppId}`, { method: 'DELETE' });
      toast({ title: 'Revoked', description: fbAppId });
      await onChanged();
    } catch (e: any) {
      toast({ title: 'Revoke failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to admin
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{detail.user.email}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div><span className="text-slate-500">Name:</span> {[detail.user.firstName, detail.user.lastName].filter(Boolean).join(' ') || '—'}</div>
          <div className="flex items-center gap-3">
            <span className="text-slate-500">Role:</span>
            <Select
              value={detail.user.role}
              onValueChange={v => changeRole(v as RoleValue)}
              disabled={updatingRole}
            >
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(r => (
                  <SelectItem key={r} value={r}>
                    <Badge className={roleBadgeClasses(r)}>{r}</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {updatingRole && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
            {detail.user.id === me?.id && (
              <span className="text-xs text-slate-400">(you — cannot demote yourself)</span>
            )}
          </div>
          <div><span className="text-slate-500">Verified:</span> {detail.user.isVerified ? 'yes' : 'no'}</div>
          <div><span className="text-slate-500">Created:</span> {new Date(detail.user.createdAt).toISOString()}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shopify stores</CardTitle></CardHeader>
        <CardContent className="p-0">
          {detail.stores.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No stores.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Domain</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Default supplier</th>
                  <th className="text-left px-4 py-2">Default shipper</th>
                </tr>
              </thead>
              <tbody>
                {detail.stores.map(s => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{s.storeDomain}</td>
                    <td className="px-4 py-2">{s.name || '—'}</td>
                    <td className="px-4 py-2">{s.isActive ? <Badge className="bg-emerald-100 text-emerald-700">active</Badge> : <Badge variant="outline">inactive</Badge>}</td>
                    <td className="px-4 py-2">{s.defaultSupplier || '—'}</td>
                    <td className="px-4 py-2">{s.defaultShippingCompany || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>FB Apps assigned</span>
            <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-1" />
                  Assign FB App
                </Button>
              </DialogTrigger>
              <AssignFbAppDialog
                userId={detail.user.id}
                userEmail={detail.user.email}
                onClose={() => setAssignOpen(false)}
                onAssigned={async () => { setAssignOpen(false); await onChanged(); }}
              />
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {detail.fbApps.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No FB apps. Click <strong>Assign FB App</strong> to provision one.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">FB App ID</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">BM ID</th>
                  <th className="text-left px-4 py-2">Default</th>
                  <th className="text-left px-4 py-2">Secret</th>
                  <th className="text-left px-4 py-2">Last error</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {detail.fbApps.map(a => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{a.fbAppId}</td>
                    <td className="px-4 py-2">{a.appName || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.fbBmId || '—'}</td>
                    <td className="px-4 py-2">{a.isDefault ? <Badge className="bg-emerald-100 text-emerald-700">default</Badge> : ''}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">len={a.secretLength}</td>
                    <td className="px-4 py-2 text-xs text-rose-600 max-w-xs truncate">{a.lastError || ''}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => revokeApp(a.fbAppId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>FB Connections</CardTitle></CardHeader>
        <CardContent className="p-0">
          {detail.fbConnections.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No connections.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">FB App</th>
                  <th className="text-left px-4 py-2">FB User</th>
                  <th className="text-left px-4 py-2">Expires</th>
                  <th className="text-left px-4 py-2">Last used</th>
                  <th className="text-left px-4 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {detail.fbConnections.map(c => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{c.fbAppId}</td>
                    <td className="px-4 py-2">{c.fbUserName || c.fbUserId}</td>
                    <td className="px-4 py-2 text-xs">{c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : '—'}</td>
                    <td className="px-4 py-2 text-xs">{c.lastUsedAt ? new Date(c.lastUsedAt).toISOString().slice(0, 16) : '—'}</td>
                    <td className="px-4 py-2 text-xs text-rose-600 max-w-xs truncate">{c.lastError || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignFbAppDialog({
  userId,
  userEmail,
  onClose,
  onAssigned
}: {
  userId: string;
  userEmail: string;
  onClose: () => void;
  onAssigned: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [fbAppId, setFbAppId] = useState('');
  const [fbAppSecret, setFbAppSecret] = useState('');
  const [fbBmId, setFbBmId] = useState('');
  const [appName, setAppName] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!/^\d{8,20}$/.test(fbAppId.trim())) {
      toast({ title: 'App ID must be numeric (8-20 digits)', variant: 'destructive' });
      return;
    }
    if (fbAppSecret.trim().length < 16) {
      toast({ title: 'Paste the full App Secret (32 hex chars from FB)', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/users/${userId}/fb-apps/assign`, {
        method: 'POST',
        body: JSON.stringify({
          fbAppId: fbAppId.trim(),
          fbAppSecret: fbAppSecret.trim(),
          fbBmId: fbBmId.trim() || null,
          appName: appName.trim() || null,
          makeDefault
        })
      });
      toast({ title: 'FB App assigned', description: `${fbAppId} → ${userEmail}` });
      await onAssigned();
    } catch (e: any) {
      toast({ title: 'Assign failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Assign FB App to {userEmail}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">App ID *</Label>
          <Input
            value={fbAppId}
            onChange={e => setFbAppId(e.target.value)}
            placeholder="1234567890123456"
            className="font-mono"
          />
        </div>
        <div>
          <Label className="text-xs">App Secret *</Label>
          <Input
            type="password"
            value={fbAppSecret}
            onChange={e => setFbAppSecret(e.target.value)}
            placeholder="Paste from developers.facebook.com → App Settings → Basic"
            className="font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">App name (optional)</Label>
            <Input value={appName} onChange={e => setAppName(e.target.value)} placeholder="Nick A" />
          </div>
          <div>
            <Label className="text-xs">Business Manager ID (optional)</Label>
            <Input value={fbBmId} onChange={e => setFbBmId(e.target.value)} placeholder="2741…" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={e => setMakeDefault(e.target.checked)}
          />
          Make this the user's default app
        </label>
        <Alert className="border-blue-200 bg-blue-50/50">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Use App ID + Secret from <strong>your</strong> developers.facebook.com console.
            The user's FB Login will exchange tokens through this app — they don't see
            the secret. To revoke, click the trash icon on the assigned-app row.
          </AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Assign
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
