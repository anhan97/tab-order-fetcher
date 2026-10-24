/**
 * "Are payment fees being deducted, and if not, why?" — for whoever may see
 * fees (fees.view). Shopify reports fees only through the Shopify Payments
 * balance ledger (read_shopify_payments_payouts scope); the P&L scheduler
 * pulls it every 30 minutes and records failures on the store.
 */
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Info, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FeeStatus, ProfitApiClient } from '@/utils/profitApi';
import { cn } from '@/lib/utils';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const gatewayLabel = (g: string | null) => (g ? g.replace(/_/g, ' ') : 'unknown');

export function FeeStatusCard({ client, from, to }: { client: ProfitApiClient; from: Date; to: Date }) {
  const [status, setStatus] = useState<FeeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    client.feeStatus(from, to)
      .then(s => { if (alive) { setStatus(s); setError(null); } })
      .catch(e => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [client, from.getTime(), to.getTime()]);

  if (error) return null;
  if (!status) return null;

  const missingScope = status.payoutsScope === false || status.feeSyncError?.startsWith('missing_scope');
  const notPayments = !missingScope && status.feeSyncError?.startsWith('not_shopify_payments');
  const otherError = !missingScope && !notPayments && status.feeSyncError ? status.feeSyncError.replace(/^error:\s*/, '') : null;
  const ok = !missingScope && !notPayments && !otherError;
  const tone = missingScope ? 'rose' : notPayments || otherError ? 'amber' : status.feeSyncAt ? 'emerald' : 'slate';
  const Icon = missingScope || notPayments || otherError ? AlertTriangle : status.feeSyncAt ? CheckCircle2 : Info;

  return (
    <Card className={cn('border-l-4', {
      'border-l-rose-500': tone === 'rose', 'border-l-amber-500': tone === 'amber',
      'border-l-emerald-500': tone === 'emerald', 'border-l-slate-300': tone === 'slate'
    })}>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-slate-500" /> Payment fees
          <span className="ml-auto text-[11px] font-normal text-slate-400">shown only to people allowed to see payment fees</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 text-sm">
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', {
            'text-rose-600': tone === 'rose', 'text-amber-600': tone === 'amber',
            'text-emerald-600': tone === 'emerald', 'text-slate-400': tone === 'slate'
          })} />
          <div className="min-w-0 space-y-1">
            {missingScope ? (
              <>
                <p className="font-medium text-rose-700">Not deducted: the store's Shopify connection may not read Shopify Payments payouts.</p>
                <p className="text-slate-600">
                  Shopify only gives per-order fees through the payouts ledger, which needs the{' '}
                  <code className="break-all rounded bg-slate-100 px-1 text-[12px]">read_shopify_payments_payouts</code> scope.
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                  <li><b>Connected with the Connect button (Shopify app):</b> reconnect the store from <i>Stores</i> and approve the new permission.</li>
                  <li>
                    <b>Connected with an Admin API token (custom app):</b> Shopify admin → Settings → Apps and sales channels → Develop apps → your app →
                    Configuration → Admin API scopes → tick <i>read_shopify_payments_payouts</i> → Save → reinstall the app, then paste the new token in <i>Stores</i>.
                  </li>
                </ul>
                <p className="text-slate-500">Fees are then pulled automatically within 30 minutes; use <i>Deep re-sync (90d)</i> to fill older days.</p>
              </>
            ) : notPayments ? (
              <p className="text-amber-800">
                This store does not use Shopify Payments, so Shopify reports no processing fees. Fees of other gateways (PayPal…) are not in Shopify.
              </p>
            ) : otherError ? (
              <p className="text-amber-800">The last fee sync failed: <span className="break-words">{otherError}</span></p>
            ) : status.feeSyncAt ? (
              <p className="text-emerald-700">
                Deducted. Fees come from Shopify Payments, refreshed every 30 minutes — last {formatDistanceToNow(new Date(status.feeSyncAt), { addSuffix: true })}.
              </p>
            ) : (
              <p className="text-slate-600">Not synced yet: fees are pulled every 30 minutes, or now with <i>Sync + recompute</i>.</p>
            )}
          </div>
        </div>

        {status.gateways.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-3 font-medium">Gateway (orders in range)</th>
                  <th className="py-1 pr-3 text-right font-medium">Orders</th>
                  <th className="py-1 pr-3 text-right font-medium">With a fee</th>
                  <th className="py-1 text-right font-medium">Fees</th>
                </tr>
              </thead>
              <tbody>
                {status.gateways.map(g => (
                  <tr key={g.gateway ?? 'none'} className="border-t border-slate-100">
                    <td className="py-1 pr-3 capitalize text-slate-700">
                      {gatewayLabel(g.gateway)}
                      {ok && g.gateway !== 'shopify_payments' && g.withFee === 0 && (
                        <span className="ml-1 normal-case text-[11px] text-slate-400">— no fee data in Shopify</span>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-right">{g.orders}</td>
                    <td className="py-1 pr-3 text-right">{g.withFee}</td>
                    <td className="py-1 text-right">{usd.format(g.fees)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
