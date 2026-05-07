import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ShieldCheck, Users, Store as StoreIcon, AppWindow, Link2, ChevronLeft, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, ApiError } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

interface AdminStats {
  users: number;
  admins: number;
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

export const AdminPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async (q = '') => {
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

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

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
    return <AdminUserDetailView detail={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard icon={<Users className="h-4 w-4 text-slate-400" />} label="Users" value={stats.users} />
          <StatCard icon={<ShieldCheck className="h-4 w-4 text-amber-500" />} label="Admins" value={stats.admins} />
          <StatCard icon={<StoreIcon className="h-4 w-4 text-emerald-500" />} label="Stores" value={stats.stores} />
          <StatCard icon={<AppWindow className="h-4 w-4 text-blue-500" />} label="FB Apps" value={stats.fbApps} />
          <StatCard icon={<Link2 className="h-4 w-4 text-violet-500" />} label="FB Connections" value={stats.fbConnections} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Users</span>
            <div className="flex items-center gap-2 max-w-md flex-1">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void load(search); }}
                  placeholder="Search by email…"
                  className="pl-8 h-9"
                />
              </div>
              <Button size="sm" onClick={() => load(search)} disabled={loading}>
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
                    <td colSpan={8} className="text-center py-10 text-slate-400">No users matched.</td>
                  </tr>
                )}
                {users.map(u => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 py-2">
                      {u.role === 'admin'
                        ? <Badge className="bg-amber-100 text-amber-700 border-amber-200">admin</Badge>
                        : <span className="text-slate-500">user</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.storeCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.fbAppCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.fbConnectionCount}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(u.createdAt).toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-2 text-right">
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

function AdminUserDetailView({ detail, onBack }: { detail: AdminUserDetail; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to users
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{detail.user.email}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-slate-500">Name:</span> {[detail.user.firstName, detail.user.lastName].filter(Boolean).join(' ') || '—'}</div>
          <div><span className="text-slate-500">Role:</span> {detail.user.role}</div>
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
        <CardHeader><CardTitle>FB Apps registered</CardTitle></CardHeader>
        <CardContent className="p-0">
          {detail.fbApps.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No FB apps.</p>
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
                </tr>
              </thead>
              <tbody>
                {detail.fbApps.map(a => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{a.fbAppId}</td>
                    <td className="px-4 py-2">{a.appName || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.fbBmId || '—'}</td>
                    <td className="px-4 py-2">{a.isDefault ? 'yes' : ''}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">len={a.secretLength}</td>
                    <td className="px-4 py-2 text-xs text-rose-600 max-w-xs truncate">{a.lastError || ''}</td>
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
