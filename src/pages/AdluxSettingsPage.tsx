import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Plus, Trash2, RefreshCw, ExternalLink, Key, Database, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ConfigResponse {
  fbAppId: string | null;
  fbAppSecret: string | null;  // masked
  adluxBmId: string | null;
  hasSecret: boolean;
  source: { fbAppId: 'db' | 'env' | 'none'; fbAppSecret: 'db' | 'env' | 'none'; adluxBmId: 'db' | 'env' | 'none' };
}

interface TokenRow {
  id: string;
  poolIndex: number;
  name: string;
  tokenTail: string;
  systemUserId: string | null;
  isActive: boolean;
  lastError: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  scopes: string[];
  tokenType: string | null;
  infoCheckedAt: string | null;
}

/**
 * Render a "remaining lifetime" string for a token timestamp. System-user
 * tokens typically have null expiresAt (never expire), but data-access
 * still does — that's why both are surfaced separately in the UI.
 */
function formatRemaining(iso: string | null, neverLabel: string = 'Never'): { text: string; tone: 'green' | 'amber' | 'red' | 'neutral' } {
  if (!iso) return { text: neverLabel, tone: 'green' };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: 'Expired', tone: 'red' };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  let text: string;
  if (days >= 30) text = `${days} days`;
  else if (days >= 1) text = `${days}d ${hours}h`;
  else text = `${hours}h`;
  const tone: 'green' | 'amber' | 'red' = days < 7 ? 'red' : days < 30 ? 'amber' : 'green';
  return { text, tone };
}

const TONE_CLASSES: Record<'green' | 'amber' | 'red' | 'neutral', string> = {
  green: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  amber: 'text-amber-700 bg-amber-50 border-amber-200',
  red: 'text-red-700 bg-red-50 border-red-200',
  neutral: 'text-slate-600 bg-slate-50 border-slate-200'
};

const SourceBadge = ({ src }: { src: 'db' | 'env' | 'none' }) => {
  if (src === 'db')   return <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">DB</Badge>;
  if (src === 'env')  return <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200">.env</Badge>;
  return <Badge variant="secondary" className="bg-slate-100 text-slate-500">unset</Badge>;
};

export const AdluxSettingsPage = () => {
  const { toast } = useToast();

  // Config state
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editAppId, setEditAppId] = useState('');
  const [editAppSecret, setEditAppSecret] = useState('');
  const [editBmId, setEditBmId] = useState('');

  // Tokens state
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState('');
  const [addingToken, setAddingToken] = useState(false);

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch('/api/facebook/admin/config');
      if (!res.ok) throw new Error(`${res.status}`);
      const cfg: ConfigResponse = await res.json();
      setConfig(cfg);
      setEditAppId(cfg.fbAppId || '');
      setEditBmId(cfg.adluxBmId || '');
      // Don't pre-fill secret — user must re-enter to change.
    } catch (e: any) {
      toast({ title: 'Failed to load config', description: e.message, variant: 'destructive' });
    } finally {
      setLoadingConfig(false);
    }
  };

  const loadTokens = async () => {
    setLoadingTokens(true);
    try {
      const res = await fetch('/api/facebook/admin/tokens');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (e: any) {
      toast({ title: 'Failed to load tokens', description: e.message, variant: 'destructive' });
    } finally {
      setLoadingTokens(false);
    }
  };

  const refreshAllInfo = async () => {
    try {
      toast({ title: 'Refreshing token info...' });
      const res = await fetch('/api/facebook/admin/tokens/refresh-info-all', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      const result = await res.json();
      toast({ title: 'Refreshed', description: `${result.done} ok, ${result.failed} failed` });
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    }
  };

  const refreshOneInfo = async (id: string) => {
    try {
      const res = await fetch(`/api/facebook/admin/tokens/${id}/refresh-info`, { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    loadConfig();
    loadTokens();
  }, []);

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const body: any = {};
      if (editAppId !== (config?.fbAppId || '')) body.fbAppId = editAppId;
      if (editBmId !== (config?.adluxBmId || '')) body.adluxBmId = editBmId;
      if (editAppSecret) body.fbAppSecret = editAppSecret;

      if (Object.keys(body).length === 0) {
        toast({ title: 'No changes' });
        return;
      }

      const res = await fetch('/api/facebook/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      toast({ title: 'Config saved', description: 'Backend will pick up new values within 60s' });
      setEditAppSecret('');
      await loadConfig();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSavingConfig(false);
    }
  };

  const addToken = async () => {
    if (!newTokenName.trim() || !newTokenValue.trim()) {
      toast({ title: 'Name + token required', variant: 'destructive' });
      return;
    }
    setAddingToken(true);
    try {
      const res = await fetch('/api/facebook/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim(), token: newTokenValue.trim() })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      const result = await res.json();
      toast({ title: 'Token added', description: `Pool slot ${result.poolIndex}` });
      setNewTokenName('');
      setNewTokenValue('');
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Add failed', description: e.message, variant: 'destructive' });
    } finally {
      setAddingToken(false);
    }
  };

  const removeToken = async (id: string, name: string) => {
    if (!confirm(`Remove token "${name}"? Accounts assigned to this slot will need to be re-assigned.`)) return;
    try {
      const res = await fetch(`/api/facebook/admin/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      toast({ title: 'Token removed' });
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Remove failed', description: e.message, variant: 'destructive' });
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/facebook/admin/tokens/${id}/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive })
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Toggle failed', description: e.message, variant: 'destructive' });
    }
  };

  const testToken = async (id: string) => {
    try {
      const res = await fetch(`/api/facebook/admin/tokens/${id}/test`, { method: 'POST' });
      const result = await res.json();
      if (result.ok) {
        toast({ title: 'Token OK', description: `System user: ${result.systemUserId}` });
      } else {
        toast({ title: 'Token failed', description: result.error || 'Unknown error', variant: 'destructive' });
      }
      await loadTokens();
    } catch (e: any) {
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Adlux Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Configure the Facebook app credentials and Business Manager that powers Adlux multi-tenant ad tracking.</p>
      </div>

      {/* Section 1: BM Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            BM Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConfig ? (
            <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="flex items-center gap-2">
                    Adlux Business Manager ID
                    {config && <SourceBadge src={config.source.adluxBmId} />}
                  </Label>
                  <Input
                    value={editBmId}
                    onChange={e => setEditBmId(e.target.value)}
                    placeholder="1234567890"
                    className="font-mono mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Find at{' '}
                    <a href="https://business.facebook.com/settings/info" target="_blank" rel="noopener" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                      Business Settings → Info <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </div>

                <div>
                  <Label className="flex items-center gap-2">
                    Facebook App ID
                    {config && <SourceBadge src={config.source.fbAppId} />}
                  </Label>
                  <Input
                    value={editAppId}
                    onChange={e => setEditAppId(e.target.value)}
                    placeholder="1718504505456131"
                    className="font-mono mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    From <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" className="text-blue-600 hover:underline">developers.facebook.com/apps</a> → your app → Basic Settings
                  </p>
                </div>

                <div className="md:col-span-2">
                  <Label className="flex items-center gap-2">
                    Facebook App Secret
                    {config && <SourceBadge src={config.source.fbAppSecret} />}
                    {config?.hasSecret && <Badge variant="outline" className="text-xs">currently: {config.fbAppSecret}</Badge>}
                  </Label>
                  <Input
                    type="password"
                    value={editAppSecret}
                    onChange={e => setEditAppSecret(e.target.value)}
                    placeholder={config?.hasSecret ? 'Enter new secret to change (leave blank to keep)' : 'Enter app secret'}
                    className="font-mono mt-1"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    From the same Basic Settings page. Click "Show" on Facebook app dashboard, copy here. Stored encrypted-at-rest is recommended for production.
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  Save configuration
                </Button>
              </div>

              {config?.source && Object.values(config.source).includes('env') && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Some values are still loaded from <code className="px-1 py-0.5 rounded bg-slate-100 text-xs">.env</code>. Save them here to migrate to DB and centralize management.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 2: System User Tokens */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            System User Token Pool
            <Badge variant="secondary">{tokens.filter(t => t.isActive).length} active / {tokens.length} total</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription className="text-sm">
              <strong>Why a pool?</strong> Facebook caps app-level rate limit at <code>200 calls × users_active</code>. With N system-user tokens, FB sees N distinct users → app budget grows N×. Recommended: <strong>5-10 tokens</strong> for most agencies.
            </AlertDescription>
          </Alert>

          {/* Add new token */}
          <div className="border rounded-md p-4 bg-slate-50 space-y-3">
            <Label className="text-sm font-medium">Add new token</Label>
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2">
              <Input
                placeholder="Name (e.g. adlux-pool-1)"
                value={newTokenName}
                onChange={e => setNewTokenName(e.target.value)}
                disabled={addingToken}
              />
              <Input
                type="password"
                placeholder="EAA... (system user token)"
                value={newTokenValue}
                onChange={e => setNewTokenValue(e.target.value)}
                disabled={addingToken}
                className="font-mono text-sm"
              />
              <Button onClick={addToken} disabled={addingToken}>
                {addingToken ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add & validate
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              We'll validate by calling <code>/me</code> before saving. Generate at{' '}
              <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                Business Settings → System Users <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          {/* Token list */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {tokens.length > 0 && tokens.some(t => t.infoCheckedAt) && (
                <>Info last refreshed {new Date(Math.max(...tokens.filter(t => t.infoCheckedAt).map(t => new Date(t.infoCheckedAt!).getTime()))).toLocaleTimeString()}</>
              )}
            </span>
            {tokens.length > 0 && (
              <Button size="sm" variant="outline" onClick={refreshAllInfo}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh expiry info
              </Button>
            )}
          </div>

          {loadingTokens ? (
            <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No tokens configured yet. Add your first system-user token above.
            </div>
          ) : (
            <div className="space-y-2">
              {tokens.map(t => {
                const tokenLife = formatRemaining(t.expiresAt, 'Never expires');
                const dataAccessLife = formatRemaining(t.dataAccessExpiresAt, '—');
                return (
                  <div key={t.id} className="border rounded-md hover:bg-slate-50">
                    <div className="flex items-start gap-3 p-3">
                      <Badge variant="outline" className="font-mono w-12 justify-center mt-0.5">#{t.poolIndex}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{t.name}</span>
                          {t.tokenType && <Badge variant="secondary" className="text-[10px] uppercase">{t.tokenType}</Badge>}
                          {t.systemUserId && <span className="text-xs text-slate-400 font-mono">id: {t.systemUserId}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                          <span className="font-mono">EAA...{t.tokenTail}</span>
                          {t.lastError ? (
                            <span className="text-red-600 truncate max-w-md">⚠️ {t.lastError}</span>
                          ) : t.lastUsedAt ? (
                            <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> last used {new Date(t.lastUsedAt).toLocaleString()}</span>
                          ) : (
                            <span>never used</span>
                          )}
                        </div>

                        {/* Expiry strip — the headline info admins need */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={cn('text-xs font-medium px-2 py-1 rounded border', TONE_CLASSES[tokenLife.tone])}>
                            Token: {tokenLife.text}
                          </span>
                          <span className={cn('text-xs font-medium px-2 py-1 rounded border', TONE_CLASSES[t.dataAccessExpiresAt ? dataAccessLife.tone : 'neutral'])}>
                            Data access: {dataAccessLife.text}
                          </span>
                          {t.scopes && t.scopes.length > 0 && (
                            <span className="text-xs text-slate-500 font-mono truncate max-w-md" title={t.scopes.join(', ')}>
                              {t.scopes.length} scope{t.scopes.length !== 1 ? 's' : ''}: {t.scopes.slice(0, 3).join(', ')}{t.scopes.length > 3 ? `, +${t.scopes.length - 3}` : ''}
                            </span>
                          )}
                          {!t.infoCheckedAt && (
                            <span className="text-xs text-slate-400 italic">info never fetched</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch checked={t.isActive} onCheckedChange={(v) => toggleActive(t.id, v)} />
                        <Button size="sm" variant="ghost" onClick={() => refreshOneInfo(t.id)} title="Refresh expiry info">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => testToken(t.id)} title="Test /me">
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeToken(t.id, t.name)} title="Remove">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
