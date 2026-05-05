/**
 * FB asset enumeration + enrollment.
 *
 * "Assets" = the merchant's Facebook things we can manage in this app:
 *   - Ad accounts  (track for spend/insights syncing)
 *   - Pages        (used as the publisher when launching ads)
 *   - Businesses   (BMs the merchant has access to — context only)
 *
 * `listAssets` queries FB Graph for the live state and joins the result
 * against our DB to mark which ad accounts are already enrolled. Pages
 * and BMs are listed read-only because we don't sync data per-page or
 * per-BM — they just inform UI dropdowns.
 *
 * Enrollment uses the existing `FacebookAdAccountAssignment` +
 * `FacebookAdAccountAccess` pair. Originally those tables were Adlux pool
 * specific, but they map cleanly to "FB account exists in the system"
 * + "this user can see it" without any Adlux involvement. Sentinel
 * values (poolIndex=-1, systemUserId='user-token') mark rows that came
 * in via user-token mode rather than the retired pool flow.
 */

import { PrismaClient } from '@prisma/client';
import { FACEBOOK_CONFIG } from '../config/facebook';

const prisma = new PrismaClient();
const FB_BASE = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

const USER_TOKEN_POOL_INDEX = -1;
const USER_TOKEN_SYSTEM_USER_ID = 'user-token';

export interface AdAccountAsset {
  accountId: string;
  name: string;
  accountStatus: number | null;
  accountStatusLabel: string;
  accountType: 'business' | 'personal';
  currency: string | null;
  timezone: string | null;
  business: { id: string; name: string } | null;
  enrolled: boolean;
  enrolledAt: Date | null;
}

export interface PageAsset {
  pageId: string;
  name: string;
  category: string | null;
  hasInstagram: boolean;
}

export interface BusinessAsset {
  businessId: string;
  name: string;
}

export interface AssetSnapshot {
  adAccounts: AdAccountAsset[];
  pages: PageAsset[];
  businesses: BusinessAsset[];
}

const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Hoạt động',
  2: 'Vô hiệu hoá',
  3: 'Chưa thanh toán',
  7: 'Đang xác thực',
  8: 'Khoá vĩnh viễn',
  9: 'Hạn chế tạm thời',
  100: 'Đóng',
  101: 'Bị khoá',
  201: 'Khoá để bảo mật',
  202: 'Khoá để bảo mật'
};

export async function listAssets(userId: string, token: string): Promise<AssetSnapshot> {
  const [adAccountsRaw, pagesRaw, businessesRaw, enrolled] = await Promise.all([
    fbList<RawAdAccount>(`/me/adaccounts?fields=id,name,account_status,currency,timezone_name,business,owner&limit=200`, token),
    fbList<RawPage>(`/me/accounts?fields=id,name,category,instagram_business_account&limit=200`, token),
    fbList<RawBusiness>(`/me/businesses?fields=id,name&limit=200`, token),
    prisma.facebookAdAccountAccess.findMany({
      where: { userId },
      select: { accountId: true, createdAt: true }
    })
  ]);
  const enrolledMap = new Map<string, Date>();
  for (const e of enrolled) enrolledMap.set(e.accountId, e.createdAt);

  const adAccounts: AdAccountAsset[] = adAccountsRaw.map(a => {
    const accountId = (a.id || '').replace(/^act_/, '');
    const enrolledAt = enrolledMap.get(accountId);
    return {
      accountId,
      name: a.name || `act_${accountId}`,
      accountStatus: a.account_status ?? null,
      accountStatusLabel: a.account_status ? (ACCOUNT_STATUS_LABELS[a.account_status] || `status=${a.account_status}`) : 'Unknown',
      accountType: a.business ? 'business' : 'personal',
      currency: a.currency || null,
      timezone: a.timezone_name || null,
      business: a.business ? { id: a.business.id, name: a.business.name } : null,
      enrolled: !!enrolledAt,
      enrolledAt: enrolledAt || null
    };
  });

  const pages: PageAsset[] = pagesRaw.map(p => ({
    pageId: p.id,
    name: p.name || p.id,
    category: p.category || null,
    hasInstagram: !!p.instagram_business_account?.id
  }));

  const businesses: BusinessAsset[] = businessesRaw.map(b => ({
    businessId: b.id,
    name: b.name || b.id
  }));

  return { adAccounts, pages, businesses };
}

/**
 * Enroll an ad account — creates the Assignment row (with user-token
 * sentinels) if absent, then the per-user Access row. Idempotent.
 */
export async function enrollAdAccount(userId: string, accountId: string, name: string): Promise<{ enrolled: true }> {
  const id = accountId.replace(/^act_/, '');
  await prisma.facebookAdAccountAssignment.upsert({
    where: { accountId: id },
    create: {
      accountId: id,
      accountName: name,
      poolIndex: USER_TOKEN_POOL_INDEX,
      systemUserId: USER_TOKEN_SYSTEM_USER_ID
    },
    update: { accountName: name }
  });
  await prisma.facebookAdAccountAccess.upsert({
    where: { userId_accountId: { userId, accountId: id } },
    create: { userId, accountId: id, role: 'viewer' },
    update: {}
  });
  return { enrolled: true };
}

/** Unenroll an ad account = drop the per-user Access row. The Assignment
 *  row is left in place because other users may still have access to it. */
export async function unenrollAdAccount(userId: string, accountId: string): Promise<{ enrolled: false }> {
  const id = accountId.replace(/^act_/, '');
  await prisma.facebookAdAccountAccess.deleteMany({ where: { userId, accountId: id } });
  return { enrolled: false };
}

// ─── FB Graph helpers ─────────────────────────────────────────────────────

interface RawAdAccount {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  business?: { id: string; name: string };
  owner?: string;
}
interface RawPage {
  id: string;
  name?: string;
  category?: string;
  instagram_business_account?: { id: string };
}
interface RawBusiness { id: string; name?: string; }

async function fbList<T>(path: string, token: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = `${FB_BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  for (let i = 0; i < 10 && url; i++) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FB ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    const json: any = await res.json();
    if (Array.isArray(json.data)) all.push(...json.data);
    url = json.paging?.next ?? null;
  }
  return all;
}
