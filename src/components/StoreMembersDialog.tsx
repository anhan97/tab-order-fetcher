/**
 * Admin panel: delegate one store to people who don't own it.
 *
 * Ownership never moves — ShopifyStore.userId stays put. This only edits
 * StoreMember rows, so revoking is instant and complete: a member never held
 * the store's Shopify token, only the right to ask our API on its behalf.
 *
 * A member gets a role (orders / fulfillment / costs) plus ads-side
 * permissions ticked one by one: Creatives, Ads Launcher and Facebook are in
 * no role, so nobody sees them until they are ticked here. Roles and
 * permissions mirror backend/src/lib/store-access.ts (via lib/permissions.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { ChevronDown, ChevronUp, Loader2, Trash2, UserPlus, Crown } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';
import type { StorePermission } from '@/context/AuthContext';
import {
  PERMISSION_GROUPS, PERMISSION_LABEL, ROLE_HELP, STORE_ROLES,
  effectivePermissions, impliedBy, type StoreRole
} from '@/lib/permissions';

export { STORE_ROLES, type StoreRole };

const ROLE_BADGE: Record<string, string> = {
  manager:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  cs:       'bg-sky-100 text-sky-700 border-sky-200',
  finance:  'bg-violet-100 text-violet-700 border-violet-200',
  viewer:   'bg-slate-100 text-slate-600 border-slate-200',
  creative: 'bg-pink-100 text-pink-700 border-pink-200'
};
const PERMISSION_BADGE = 'bg-teal-50 text-teal-700 border-teal-200';

interface Member {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  role: string;
  permissions?: StorePermission[];
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

const asRole = (r: string): StoreRole => ((STORE_ROLES as readonly string[]).includes(r) ? r as StoreRole : 'viewer');

/**
 * Ads-side permission ticks. What the role (or another tick) already includes
 * shows ticked and locked, with the reason, so the admin sees the real result.
 */
function PermissionPicker({ idPrefix, role, value, onChange, disabled }: {
  idPrefix: string;
  role: StoreRole;
  value: StorePermission[];
  onChange: (next: StorePermission[]) => void;
  disabled?: boolean;
}) {
  const effective = effectivePermissions(role, value);
  const toggle = (p: StorePermission, on: boolean) =>
    onChange(on ? [...value.filter(v => v !== p), p] : value.filter(v => v !== p));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {PERMISSION_GROUPS.map(group => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
          {group.items.map(item => {
            const why = value.includes(item.id) ? null : impliedBy(role, value, item.id);
            const checked = effective.has(item.id);
            const id = `${idPrefix}-${item.id}`;
            return (
              <div key={item.id} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={checked}
                  disabled={disabled || !!why}
                  onCheckedChange={v => toggle(item.id, v === true)}
                />
                <label htmlFor={id} className="cursor-pointer leading-tight">
                  <span className="text-xs font-medium text-slate-800">{item.label}</span>
                  <span className="block text-[10px] text-slate-500">{why ? `${item.help} · ${why}` : item.help}</span>
                </label>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export const StoreMembersDialog = ({ storeId, storeLabel, onClose }: Props) => {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StoreRole>('cs');
  const [permissions, setPermissions] = useState<StorePermission[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

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
      toast({ title: 'Could not load members', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => { void load(); }, [load]);

  const grant = async (targetEmail: string, targetRole: StoreRole, targetPermissions: StorePermission[], busyKey = 'grant') => {
    if (!storeId || !targetEmail.trim()) return false;
    setBusy(busyKey);
    try {
      await apiFetch(`/api/admin/stores/${storeId}/members`, {
        method: 'PUT',
        body: JSON.stringify({ email: targetEmail.trim(), role: targetRole, permissions: targetPermissions })
      });
      await load();
      return true;
    } catch (e: any) {
      toast({ title: 'Could not save access', description: e?.message, variant: 'destructive' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const grantNew = async () => {
    const who = email.trim();
    if (await grant(who, role, permissions)) {
      toast({ title: 'Access granted', description: `${who} → ${role}` });
      setEmail('');
      setPermissions([]);
    }
  };

  const revoke = async (userId: string, label: string) => {
    if (!storeId) return;
    if (!confirm(`Revoke ${label}'s access to this store?`)) return;
    setBusy(userId);
    try {
      await apiFetch(`/api/admin/stores/${storeId}/members/${userId}`, { method: 'DELETE' });
      toast({ title: 'Access revoked', description: label });
      await load();
    } catch (e: any) {
      toast({ title: 'Could not revoke access', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!storeId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Store access</DialogTitle>
          <DialogDescription className="font-mono text-xs">{storeLabel}</DialogDescription>
        </DialogHeader>

        {owner && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <Crown className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-slate-700">Owner:</span>
            <span className="font-mono text-xs">{owner.email}</span>
            <span className="text-xs text-slate-500 ml-auto">Full access, cannot be revoked</span>
          </div>
        )}

        {/* Grant / re-grant. The endpoint upserts, so entering an existing
            member's email simply changes their role and permissions. */}
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <Label className="text-xs uppercase tracking-wide text-slate-500">Grant access</Label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void grantNew(); }}
                placeholder="teammate@example.com"
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
                    onClick={() => void grantNew()}>
              {busy === 'grant'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <UserPlus className="h-3.5 w-3.5 mr-1" />}
              Grant
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">{ROLE_HELP[role]}</p>
          <div className="rounded-md bg-slate-50 p-2.5">
            <p className="mb-2 text-[11px] font-medium text-slate-600">
              Extra permissions — off unless ticked, whatever the role
            </p>
            <PermissionPicker idPrefix="grant" role={role} value={permissions} onChange={setPermissions} disabled={busy === 'grant'} />
          </div>
          <p className="text-[11px] text-slate-400">
            They must already have an account. To change someone's access, use the table below (or enter their email again).
          </p>
        </div>

        <div>
          {loading ? (
            <div className="py-8 text-center text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Nobody has been granted access. Only the owner can open this store.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">Can do</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const mRole = asRole(m.role);
                  const mPerms = m.permissions ?? [];
                  const open = editing === m.userId;
                  return (
                    <MemberRows
                      key={m.userId}
                      member={m}
                      role={mRole}
                      permissions={mPerms}
                      open={open}
                      busy={busy === m.userId}
                      onToggle={() => setEditing(open ? null : m.userId)}
                      onRole={r => void grant(m.email, r, mPerms, m.userId)}
                      onPermissions={p => void grant(m.email, mRole, p, m.userId)}
                      onRevoke={() => void revoke(m.userId, m.email)}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function MemberRows({ member: m, role, permissions, open, busy, onToggle, onRole, onPermissions, onRevoke }: {
  member: Member;
  role: StoreRole;
  permissions: StorePermission[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRole: (r: StoreRole) => void;
  onPermissions: (p: StorePermission[]) => void;
  onRevoke: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-3 py-2">
          <div className="font-mono text-xs">{m.email}</div>
          {m.status !== 'ACTIVE' && (
            <Badge variant="outline" className="mt-0.5 text-[10px]">{m.status}</Badge>
          )}
        </td>
        <td className="px-3 py-2">
          <Select value={role} onValueChange={v => onRole(v as StoreRole)} disabled={busy}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STORE_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {m.capabilities.map(c => {
              const label = PERMISSION_LABEL[c as StorePermission];
              return (
                <Badge key={c} variant="outline" className={`text-[10px] ${label ? PERMISSION_BADGE : ROLE_BADGE[role] || ''}`}>
                  {label ?? c}
                </Badge>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-teal-700 hover:underline"
            onClick={onToggle}
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Permissions
          </button>
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
            disabled={busy}
            onClick={onRevoke}
            title="Revoke access"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td colSpan={4} className="px-3 pb-3 pt-1">
            <p className="mb-2 text-[11px] text-slate-500">{ROLE_HELP[role]} Changes save right away.</p>
            <PermissionPicker idPrefix={`member-${m.userId}`} role={role} value={permissions} onChange={onPermissions} disabled={busy} />
          </td>
        </tr>
      )}
    </>
  );
}
