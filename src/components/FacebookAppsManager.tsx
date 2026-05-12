import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from '@/components/ui/dialog';
import { Loader2, Plus, Trash2, Star, ExternalLink, Eye, EyeOff, AlertCircle, Save, CheckCircle2, LogIn, Users as UsersIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/utils/apiClient';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';

interface SafeFbApp {
  id: string;
  fbAppId: string;
  fbBmId: string | null;
  appName: string | null;
  isActive: boolean;
  isDefault: boolean;
  secretFingerprint: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionStatus {
  connected: boolean;
  fbAppId: string | null;
  fbUserId: string | null;
  fbUserName: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  lastError: string | null;
  needsReconnect: boolean;
}

/**
 * Multi-app per user.
 *
 * Each user can register N FB Apps (one per FB nick they manage). The
 * "default" app is the one used when the picker isn't explicit (legacy
 * /my-app endpoints, FB Login flow on the connect screen). Promoting a
 * different app updates the default flag server-side.
 *
 * The single-app MyFacebookAppCard still exists for back-compat — this
 * component is the new place to manage the full list.
 */
export function FacebookAppsManager() {
  const { toast } = useToast();
  const [apps, setApps] = useState<SafeFbApp[]>([]);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SafeFbApp | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingUsers, setManagingUsers] = useState<SafeFbApp | null>(null);
  const [usersByApp, setUsersByApp] = useState<Record<string, number>>({});

  // Load assignee counts for every app so the card can show "N users".
  const loadAssigneeCounts = async (apps: SafeFbApp[]) => {
    const entries = await Promise.all(apps.map(async a => {
      try {
        const r = await apiFetch<{ users: Array<unknown> }>(`/api/facebook/my-apps/${a.fbAppId}/users`);
        return [a.fbAppId, r.users.length] as const;
      } catch {
        return [a.fbAppId, 0] as const;
      }
    }));
    setUsersByApp(Object.fromEntries(entries));
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        apiFetch<{ apps: SafeFbApp[] }>('/api/facebook/my-apps'),
        apiFetch<{ connections: ConnectionStatus[] }>('/api/facebook/connections')
      ]);
      setApps(a.apps);
      setConnections(c.connections);
      // Fire-and-forget — assignee counts shouldn't block the main view.
      void loadAssigneeCounts(a.apps);
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const setDefault = async (fbAppId: string) => {
    try {
      await apiFetch(`/api/facebook/my-apps/${fbAppId}/default`, { method: 'PUT' });
      toast({ title: 'Default updated' });
      await load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  const remove = async (app: SafeFbApp) => {
    if (!confirm(`Delete app "${app.appName || app.fbAppId}"? This also drops the FB connection bound to it.`)) return;
    try {
      await apiFetch(`/api/facebook/my-apps/${app.fbAppId}`, { method: 'DELETE' });
      toast({ title: 'Deleted' });
      await load();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  const disconnectApp = async (fbAppId: string) => {
    if (!confirm('Disconnect this FB nick? The app credentials stay; you can reconnect later.')) return;
    try {
      await apiFetch(`/api/facebook/connections/${fbAppId}`, { method: 'DELETE' });
      toast({ title: 'Disconnected' });
      await load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  /**
   * Connect FB Login for a specific app. The FB SDK can only run with one
   * App ID per page load, so non-default apps need: 1) make default, 2)
   * reload, 3) connect. We do (1) automatically and prompt for (2).
   */
  const connectApp = async (app: SafeFbApp) => {
    const activeAppId = FacebookAdsApiClient.getActiveAppId();
    const sdkLoaded = !!(window as any).FB;

    // App not yet default + SDK already initialised with another app → reload.
    if (sdkLoaded && activeAppId && activeAppId !== app.fbAppId) {
      if (!confirm(`The Facebook SDK is loaded with app ${activeAppId}, but you want to connect ${app.fbAppId}. Make this app default and reload to connect?`)) return;
      try {
        await apiFetch(`/api/facebook/my-apps/${app.fbAppId}/default`, { method: 'PUT' });
        window.location.reload();
      } catch (e: any) {
        toast({ title: 'Failed', description: e.message, variant: 'destructive' });
      }
      return;
    }

    // SDK fresh / matching → drive a normal FB Login + post token to /connections.
    try {
      // Make sure SDK is configured for this app.
      FacebookAdsApiClient.configureAppId(app.fbAppId);
      const client = FacebookAdsApiClient.getInstance();
      const { accessToken } = await client.login({ rerequest: false });
      await apiFetch('/api/facebook/connections', {
        method: 'POST',
        body: JSON.stringify({ token: accessToken, fbAppId: app.fbAppId })
      });
      toast({ title: 'Connected', description: `${app.appName || app.fbAppId} connected to Facebook.` });
      await load();
    } catch (e: any) {
      toast({ title: 'Connect failed', description: e.message || String(e), variant: 'destructive' });
    }
  };

  const connByApp = new Map(connections.map(c => [c.fbAppId, c]));

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Facebook Apps</span>
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-1" />
                Add app
              </Button>
            </DialogTrigger>
            <AppDialog
              app={null}
              onClose={() => setCreating(false)}
              onSaved={async () => { setCreating(false); await load(); }}
            />
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {apps.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              No FB Apps registered yet. Click <strong>Add app</strong> to register your first.
              Each merchant should bring their OWN FB App so a policy issue on one app
              doesn't take down everyone's ads.
            </AlertDescription>
          </Alert>
        )}

        {apps.map(app => {
          const conn = connByApp.get(app.fbAppId);
          return (
            <div key={app.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{app.appName || `App ${app.fbAppId}`}</span>
                    {app.isDefault && (
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
                        <Star className="h-3 w-3 fill-current" />
                        Default
                      </Badge>
                    )}
                    {!app.isActive && <Badge variant="outline">Inactive</Badge>}
                    {conn?.connected ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                        Connected{conn.fbUserName ? ` · ${conn.fbUserName}` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-500">Not connected</Badge>
                    )}
                    {conn?.daysUntilExpiry != null && conn.daysUntilExpiry < 7 && (
                      <Badge variant="destructive">Expires in {conn.daysUntilExpiry}d</Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>App ID: {app.fbAppId}</span>
                    {app.fbBmId && <span>· BM: {app.fbBmId}</span>}
                    <a
                      href={`https://developers.facebook.com/apps/${app.fbAppId}/settings/basic/`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {app.lastError && (
                    <p className="text-xs text-rose-600 mt-1 font-mono break-all">{app.lastError}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!app.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault(app.fbAppId)} title="Make default">
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => connectApp(app)}
                    className="text-blue-700 border-blue-200 hover:bg-blue-50">
                    <LogIn className="h-3.5 w-3.5 mr-1" />
                    {conn?.connected ? 'Reconnect' : 'Connect'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setManagingUsers(app)}
                    title="Assign which users can connect through this app">
                    <UsersIcon className="h-4 w-4 mr-1" />
                    Users
                    {usersByApp[app.fbAppId] > 0 && (
                      <Badge className="ml-1 bg-slate-100 text-slate-700 text-[10px] h-4 px-1.5">
                        {usersByApp[app.fbAppId]}
                      </Badge>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(app)}>
                    Edit
                  </Button>
                  {conn && (
                    <Button size="sm" variant="ghost" onClick={() => disconnectApp(app.fbAppId)}
                      className="text-amber-700 hover:text-amber-800">
                      Disconnect
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(app)}
                    className="text-rose-600 hover:text-rose-700">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
          <AppDialog
            app={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load(); }}
          />
        </Dialog>

        <Dialog open={!!managingUsers} onOpenChange={(open) => { if (!open) setManagingUsers(null); }}>
          {managingUsers && (
            <AppUsersDialog
              app={managingUsers}
              onClose={() => setManagingUsers(null)}
              onSaved={async () => { setManagingUsers(null); await load(); }}
            />
          )}
        </Dialog>

        <p className="text-xs text-slate-500 leading-relaxed pt-1">
          Required redirects in your FB App settings:{' '}
          <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{window.location.origin}</code>{' '}
          (Site URL, App Domain, Allowed Domains for the JS SDK).
        </p>
      </CardContent>
    </Card>
  );
}

function AppDialog({
  app, onClose, onSaved
}: {
  app: SafeFbApp | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [appId, setAppId] = useState(app?.fbAppId || '');
  const [appSecret, setAppSecret] = useState('');
  const [bmId, setBmId] = useState(app?.fbBmId || '');
  const [appName, setAppName] = useState(app?.appName || '');
  const [makeDefault, setMakeDefault] = useState(app?.isDefault || false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const isEdit = !!app;

  const save = async () => {
    if (!appId.trim()) { toast({ title: 'App ID required', variant: 'destructive' }); return; }
    if (!isEdit && (!appSecret.trim() || appSecret.length < 16)) {
      toast({ title: 'App Secret required', description: 'Paste the full secret (16+ chars).', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        fbAppId: appId.trim(),
        fbBmId: bmId.trim() || null,
        appName: appName.trim() || null,
        makeDefault
      };
      if (appSecret.trim()) payload.fbAppSecret = appSecret.trim();
      const path = isEdit ? `/api/facebook/my-apps/${app!.fbAppId}` : '/api/facebook/my-apps';
      const method = isEdit ? 'PUT' : 'POST';
      await apiFetch(path, { method, body: JSON.stringify(payload) });
      toast({ title: isEdit ? 'Updated' : 'Saved' });
      await onSaved();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Quick credential check — calls /my-app/test which exercises the user's
  // *default* app credentials. Useful right after editing the default.
  const test = async () => {
    setTesting(true);
    try {
      const j = await apiFetch<{ ok: boolean; error?: string }>('/api/facebook/my-app/test', { method: 'POST' });
      if (j.ok) toast({ title: 'Credentials valid' });
      else toast({ title: 'Test failed', description: j.error, variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${app?.appName || app?.fbAppId}` : 'Register Facebook App'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">App name (optional)</Label>
          <Input value={appName} onChange={e => setAppName(e.target.value)} placeholder="e.g. Nick A" />
        </div>
        <div>
          <Label className="text-xs">FB App ID *</Label>
          <Input
            value={appId}
            onChange={e => setAppId(e.target.value)}
            disabled={isEdit}
            placeholder="1234567890123456"
            className="font-mono"
          />
          {isEdit && <p className="text-xs text-slate-400 mt-1">App ID is the natural key — create a new app to change it.</p>}
        </div>
        <div>
          <Label className="text-xs">App Secret {isEdit ? '(leave blank to keep)' : '*'}</Label>
          <div className="flex gap-2">
            <Input
              type={showSecret ? 'text' : 'password'}
              value={appSecret}
              onChange={e => setAppSecret(e.target.value)}
              placeholder={isEdit ? (app?.secretFingerprint || '••••') : 'Paste from FB Dev Console'}
              className="font-mono"
            />
            <Button variant="ghost" size="icon" type="button" onClick={() => setShowSecret(s => !s)}>
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-xs">Business Manager ID (optional)</Label>
          <Input value={bmId} onChange={e => setBmId(e.target.value)} placeholder="2741..." />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={e => setMakeDefault(e.target.checked)}
          />
          Make this my default app
        </label>
        {isEdit && app?.lastError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs font-mono break-all">{app.lastError}</AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter className="gap-2">
        {isEdit && app?.isDefault && (
          <Button variant="outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Test
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isEdit ? 'Update' : 'Save'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Manage which users (besides admin) can connect FB through this app.
 *
 * Loads the full user list via /api/admin/users and the current assignees
 * via /api/facebook/my-apps/:fbAppId/users. Saving sends the new full
 * assignee set with PUT — backend reconciles add/remove atomically. The
 * admin themselves is never an assignee (they own the app), so we hide
 * the admin row from the picker.
 */
function AppUsersDialog({
  app, onClose, onSaved
}: {
  app: SafeFbApp;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  interface UserRow {
    id: string; email: string; firstName: string | null; lastName: string | null; role: string;
  }
  interface AssignedRow { assignedUserId: string }

  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Pull users + current assignees in parallel.
        const [u, a] = await Promise.all([
          apiFetch<{ users: UserRow[] }>('/api/admin/users?limit=500'),
          apiFetch<{ users: AssignedRow[] }>(`/api/facebook/my-apps/${app.fbAppId}/users`)
        ]);
        if (cancelled) return;
        setAllUsers(u.users);
        setSelected(new Set(a.users.map(r => r.assignedUserId)));
      } catch (e: any) {
        toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [app.fbAppId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/facebook/my-apps/${app.fbAppId}/users`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: Array.from(selected) })
      });
      toast({ title: 'Users updated', description: `${selected.size} user(s) can connect via ${app.appName || app.fbAppId}` });
      await onSaved();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Hide admins from the assignee picker — admins use their OWN registered
  // apps, they don't get pivot rows. The dialog header makes that clear.
  const candidates = allUsers
    .filter(u => u.role !== 'admin')
    .filter(u => !search || u.email.toLowerCase().includes(search.toLowerCase())
              || `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          Assign users to {app.appName || `App ${app.fbAppId}`}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <Alert>
          <UsersIcon className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Selected users see a <strong>Connect</strong> button on /facebook
            and log in through this app's credentials. The App Secret stays
            on your row — they never see it. Admins are not listed (they
            already access their own apps directly).
          </AlertDescription>
        </Alert>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="h-9"
        />
        <div className="border border-slate-200 rounded-md max-h-80 overflow-y-auto">
          {loading && (
            <div className="p-6 flex items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading users…
            </div>
          )}
          {!loading && candidates.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">
              No matching non-admin users.
            </div>
          )}
          {!loading && candidates.map(u => (
            <label
              key={u.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggle(u.id)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{u.email}</div>
                <div className="text-xs text-slate-500 truncate">
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'} · {u.role}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          {selected.size} user{selected.size === 1 ? '' : 's'} selected
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || loading} className="bg-blue-600 hover:bg-blue-700">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
