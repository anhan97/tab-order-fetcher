import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/context/AppContext';
import { CheckCircle2, AlertTriangle, AlertOctagon, ExternalLink, RefreshCw, Loader2, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';

type DiagnosisKind =
  | 'ok'
  | 'app_not_in_bm'
  | 'app_not_advanced_access'
  | 'account_disabled'
  | 'account_unsettled'
  | 'access_denied'
  | 'token_expired'
  | 'unknown_error';

interface DiagnosisRow {
  accountId: string;
  name: string;
  accountStatus: number | null;
  disableReason: number | null;
  ownerType: 'personal' | 'business' | 'unknown';
  business: { id: string; name: string } | null;
  currency: string | null;
  timezone: string | null;
  accessible: boolean;
  fbErrorCode: number | null;
  fbErrorMessage: string | null;
  kind: DiagnosisKind;
  suggestion: string;
  fixUrl: string | null;
}

interface DiagnoseResponse {
  fbAppId: string;
  total: number;
  ok: number;
  issues: number;
  rows: DiagnosisRow[];
}

const KIND_META: Record<DiagnosisKind, { label: string; tone: 'ok' | 'warn' | 'crit'; }> = {
  ok: { label: 'OK', tone: 'ok' },
  app_not_in_bm: { label: 'App not assigned in BM', tone: 'warn' },
  app_not_advanced_access: { label: 'App needs Advanced Access', tone: 'warn' },
  account_disabled: { label: 'Account disabled', tone: 'crit' },
  account_unsettled: { label: 'Billing unsettled', tone: 'warn' },
  access_denied: { label: 'Access denied', tone: 'crit' },
  token_expired: { label: 'Token expired', tone: 'crit' },
  unknown_error: { label: 'Unknown error', tone: 'crit' }
};

export const FacebookDiagnostics = () => {
  const { shopifyConfig } = useAppContext();
  const { toast } = useToast();
  const [data, setData] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = () => {
    if (!shopifyConfig) return {};
    return {
      'X-Shopify-Store-Domain': shopifyConfig.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      'X-Shopify-Access-Token': shopifyConfig.accessToken
    } as Record<string, string>;
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/facebook/diagnose-accounts', { headers: headers() });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || `${res.status}`);
      }
      setData(body);
      toast({ title: 'Diagnose complete', description: `${body.ok} ok · ${body.issues} need attention` });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto-run once on mount so the user lands on data immediately.
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-emerald-500" />
            Account diagnostics
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Per-account check answering "tại sao account này load được, account kia không". Calls Facebook directly using your stored token — read-only, safe to re-run.
          </p>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
          {loading ? 'Diagnosing...' : 'Re-run'}
        </Button>
      </div>

      {error && (
        <Card className="border-rose-200 bg-rose-50/40">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-rose-700">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {!data && loading && (
        <Card>
          <CardContent className="p-8 flex items-center justify-center text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Probing your ad accounts...
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Total accounts" value={data.total} tone="neutral" />
            <SummaryCard label="OK" value={data.ok} tone="ok" />
            <SummaryCard label="Need attention" value={data.issues} tone={data.issues > 0 ? 'warn' : 'neutral'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Per-account breakdown</span>
                <span className="text-xs font-normal text-slate-500 font-mono">
                  FB App: {data.fbAppId || '(none)'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Diagnosis</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-400 py-6">
                          No ad accounts visible to this token.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.rows.map(r => <DiagnosisRowView key={r.accountId} row={r} />)}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

function DiagnosisRowView({ row }: { row: DiagnosisRow }) {
  const meta = KIND_META[row.kind];
  return (
    <TableRow className={cn(
      meta.tone === 'crit' && 'bg-rose-50/40',
      meta.tone === 'warn' && 'bg-amber-50/40'
    )}>
      <TableCell>
        <div className="font-medium text-slate-900 max-w-[200px] truncate" title={row.name}>{row.name}</div>
        <div className="text-xs text-slate-500 font-mono">act_{row.accountId}</div>
      </TableCell>
      <TableCell>
        {row.business ? (
          <div>
            <div className="font-medium text-slate-900 truncate max-w-[160px]" title={row.business.name}>{row.business.name}</div>
            <div className="text-xs text-slate-500">BM</div>
          </div>
        ) : row.ownerType === 'personal' ? (
          <span className="text-sm text-slate-600">Personal</span>
        ) : (
          <span className="text-sm text-slate-400">unknown</span>
        )}
      </TableCell>
      <TableCell>
        <StatusPill kind={row.kind} accountStatus={row.accountStatus} />
      </TableCell>
      <TableCell>
        <div className="text-sm text-slate-700 max-w-[420px]">{row.suggestion}</div>
        {row.fbErrorCode != null && row.kind !== 'ok' && (
          <div className="text-[10px] text-slate-400 font-mono mt-0.5">FB code {row.fbErrorCode}</div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {row.fixUrl ? (
          <Button variant="outline" size="sm" asChild>
            <a href={row.fixUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Fix
            </a>
          </Button>
        ) : row.kind === 'ok' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusPill({ kind, accountStatus }: { kind: DiagnosisKind; accountStatus: number | null }) {
  const meta = KIND_META[kind];
  const Icon = meta.tone === 'ok' ? CheckCircle2 : meta.tone === 'warn' ? AlertTriangle : AlertOctagon;
  const tone = meta.tone === 'ok'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : meta.tone === 'warn'
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-rose-700 bg-rose-50 border-rose-200';
  return (
    <div className="space-y-1">
      <Badge variant="outline" className={cn('gap-1 font-medium', tone)}>
        <Icon className="h-3 w-3" />
        {meta.label}
      </Badge>
      {accountStatus !== null && accountStatus !== 1 && (
        <div className="text-[10px] text-slate-400 font-mono">status={accountStatus}</div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'neutral' }) {
  const color = tone === 'ok'
    ? 'text-emerald-600'
    : tone === 'warn'
      ? 'text-amber-600'
      : 'text-slate-900';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">{label}</div>
        <div className={cn('text-3xl font-bold mt-1 tabular-nums', color)}>{value}</div>
      </CardContent>
    </Card>
  );
}
