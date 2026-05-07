/**
 * End-of-day FB ad insight snapshots.
 *
 * Run once per day per assigned account. Pulls level=ad insights for the
 * previous calendar day and writes one row per ad. Lets the frontend serve
 * "yesterday/last week/historical" date ranges from DB without burning live
 * FB quota.
 *
 * Today's data is intentionally NOT snapshotted here — the dashboard polls
 * FB directly every 5 min for that. Snapshots are immutable history.
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import { FACEBOOK_CONFIG } from '../config/facebook';
import * as pool from './fb-system-token.service';

const prisma = new PrismaClient();
const FB_API = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}`;

const SNAPSHOT_FIELDS = [
  'ad_id', 'ad_name', 'adset_id', 'campaign_id',
  'spend', 'impressions', 'clicks', 'reach', 'frequency',
  'unique_clicks', 'ctr', 'cpc', 'cpm',
  'actions', 'action_values', 'cost_per_action_type',
  'purchase_roas'
].join(',');

function pickAction(rows: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!rows) return 0;
  const hit = rows.find(r => r.action_type === type);
  return hit ? parseFloat(hit.value) || 0 : 0;
}

/**
 * Aggregate ad-level rows up to campaign-level so the per-store P&L query
 * can sum by campaign without re-running insights at level=campaign.
 */
async function snapshotCampaignRollup(accountId: string, date: Date, adRows: any[]): Promise<number> {
  // Group ads by campaign_id, sum money/count metrics, recompute ratios.
  const byCampaign = new Map<string, { campaignName?: string; rows: any[] }>();
  for (const r of adRows) {
    if (!r.campaign_id) continue;
    const slot = byCampaign.get(r.campaign_id) || { campaignName: undefined, rows: [] };
    if (!slot.campaignName && r.campaign_name) slot.campaignName = r.campaign_name;
    slot.rows.push(r);
    byCampaign.set(r.campaign_id, slot);
  }

  // Wipe existing campaign-level rows for this account/date.
  await prisma.$executeRaw`
    DELETE FROM "FacebookAdInsightSnapshot"
    WHERE "accountId" = ${accountId}
      AND "date" = ${date}
      AND "level" = 'campaign'
  `;

  let written = 0;
  for (const [campaignId, slot] of byCampaign) {
    const sum = (k: string) => slot.rows.reduce((s, r) => s + (parseFloat(r[k] || '0') || 0), 0);
    const sumInt = (k: string) => slot.rows.reduce((s, r) => s + (parseInt(r[k] || '0', 10) || 0), 0);
    const sumAction = (rows: any[], type: string) => rows.reduce((s, r) => {
      const a = (r.actions || []).find((x: any) => x.action_type === type);
      return s + (a ? parseFloat(a.value) || 0 : 0);
    }, 0);
    const sumActionVal = (rows: any[], type: string) => rows.reduce((s, r) => {
      const a = (r.action_values || []).find((x: any) => x.action_type === type);
      return s + (a ? parseFloat(a.value) || 0 : 0);
    }, 0);

    const spend = sum('spend');
    const impressions = sumInt('impressions');
    const clicks = sumInt('clicks');
    const reach = sumInt('reach');
    const purchase = sumAction(slot.rows, 'purchase')
      || sumAction(slot.rows, 'offsite_conversion.fb_pixel_purchase');
    const purchaseValue = sumActionVal(slot.rows, 'purchase')
      || sumActionVal(slot.rows, 'offsite_conversion.fb_pixel_purchase');

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "FacebookAdInsightSnapshot" (
        "id", "accountId", "date", "level", "entityId", "entityName", "parentId",
        "spend", "impressions", "clicks", "reach", "uniqueClicks",
        "ctr", "cpc", "cpm", "frequency",
        "purchases", "purchaseValue", "addToCart", "initiateCheckout", "roas"
      ) VALUES (
        ${id}, ${accountId}, ${date}, 'campaign', ${campaignId}, ${slot.campaignName || null}, NULL,
        ${spend},
        ${BigInt(impressions)},
        ${BigInt(clicks)},
        ${BigInt(reach)},
        ${BigInt(0)},
        ${impressions ? (clicks / impressions) * 100 : null},
        ${clicks ? spend / clicks : null},
        ${impressions ? (spend / impressions) * 1000 : null},
        ${reach ? impressions / reach : null},
        ${Math.round(purchase)},
        ${purchaseValue},
        ${Math.round(sumAction(slot.rows, 'add_to_cart'))},
        ${Math.round(sumAction(slot.rows, 'initiate_checkout'))},
        ${spend ? purchaseValue / spend : null}
      )
    `;
    written++;
  }
  return written;
}

/**
 * Pull insights for an account on a single day, write rows to snapshot table.
 * Idempotent — re-running for the same date overwrites.
 */
export async function snapshotAccountDay(accountId: string, date: Date): Promise<{ rowsWritten: number; campaignsWritten: number }> {
  const dateStr = date.toISOString().slice(0, 10);
  const token = pool.tokenForAccount(accountId);

  const params = new URLSearchParams({
    level: 'ad',
    fields: SNAPSHOT_FIELDS,
    time_range: JSON.stringify({ since: dateStr, until: dateStr }),
    limit: '500',
    access_token: token
  });

  const all: any[] = [];
  let url: string | null = `${FB_API}/act_${accountId}/insights?${params}`;
  let pages = 0;
  while (url && pages < 200) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Snapshot fetch failed for ${accountId}: ${res.status} ${text.slice(0, 300)}`);
    }
    const json = await res.json() as { data?: any[]; paging?: { next?: string } };
    if (json.data) all.push(...json.data);
    url = json.paging?.next || null;
    pages++;
  }

  // Wipe existing rows for this account+date+level so re-runs replace cleanly.
  await prisma.$executeRaw`
    DELETE FROM "FacebookAdInsightSnapshot"
    WHERE "accountId" = ${accountId}
      AND "date" = ${date}
      AND "level" = 'ad'
  `;

  let rowsWritten = 0;
  for (const row of all) {
    const id = crypto.randomUUID();
    const purchase = pickAction(row.actions, 'purchase')
      || pickAction(row.actions, 'offsite_conversion.fb_pixel_purchase');
    const purchaseValue = pickAction(row.action_values, 'purchase')
      || pickAction(row.action_values, 'offsite_conversion.fb_pixel_purchase');
    const addToCart = pickAction(row.actions, 'add_to_cart');
    const initiateCheckout = pickAction(row.actions, 'initiate_checkout');

    await prisma.$executeRaw`
      INSERT INTO "FacebookAdInsightSnapshot" (
        "id", "accountId", "date", "level", "entityId", "entityName", "parentId",
        "spend", "impressions", "clicks", "reach", "uniqueClicks",
        "ctr", "cpc", "cpm", "frequency",
        "purchases", "purchaseValue", "addToCart", "initiateCheckout", "roas",
        "raw"
      ) VALUES (
        ${id}, ${accountId}, ${date}, 'ad', ${row.ad_id}, ${row.ad_name}, ${row.adset_id},
        ${parseFloat(row.spend || '0')},
        ${BigInt(parseInt(row.impressions || '0', 10))},
        ${BigInt(parseInt(row.clicks || '0', 10))},
        ${BigInt(parseInt(row.reach || '0', 10))},
        ${BigInt(parseInt(row.unique_clicks || '0', 10))},
        ${parseFloat(row.ctr || '0') || null},
        ${parseFloat(row.cpc || '0') || null},
        ${parseFloat(row.cpm || '0') || null},
        ${parseFloat(row.frequency || '0') || null},
        ${Math.round(purchase)},
        ${purchaseValue},
        ${Math.round(addToCart)},
        ${Math.round(initiateCheckout)},
        ${parseFloat(row.purchase_roas?.[0]?.value || '0') || null},
        ${JSON.stringify(row)}::jsonb
      )
    `;
    rowsWritten++;
  }

  // Roll up to campaign-level so per-store spend queries are O(1) instead
  // of having to re-aggregate from ad-level on every read.
  const campaignsWritten = await snapshotCampaignRollup(accountId, date, all);

  return { rowsWritten, campaignsWritten };
}

/**
 * Snapshot every assigned account for a given date. Sequential to avoid
 * hammering app-level rate limit. Errors per-account don't abort the run.
 */
export async function snapshotAllAccounts(date: Date): Promise<{
  totalAccounts: number;
  accountsDone: number;
  totalRows: number;
  errors: Array<{ accountId: string; error: string }>;
}> {
  const accounts = await prisma.$queryRaw<Array<{ accountId: string }>>`
    SELECT "accountId" FROM "FacebookAdAccountAssignment"
    WHERE "status" = 'assigned'
  `;

  const result = {
    totalAccounts: accounts.length,
    accountsDone: 0,
    totalRows: 0,
    errors: [] as Array<{ accountId: string; error: string }>
  };

  for (const { accountId } of accounts) {
    try {
      const r = await snapshotAccountDay(accountId, date);
      result.accountsDone++;
      result.totalRows += r.rowsWritten;
    } catch (err: any) {
      result.errors.push({ accountId, error: err.message || String(err) });
    }
  }

  return result;
}

/**
 * Query historical insights for a date range from snapshots. Used by
 * /account-data when the requested range doesn't include today.
 */
export async function queryHistoricalSnapshots(
  accountId: string,
  since: Date,
  until: Date
): Promise<Array<any>> {
  return prisma.$queryRaw<Array<any>>`
    SELECT "entityId" as ad_id, "entityName" as ad_name, "parentId" as adset_id,
           "spend", "impressions"::text, "clicks"::text, "reach"::text,
           "uniqueClicks"::text as unique_clicks,
           "ctr", "cpc", "cpm", "frequency",
           "purchases", "purchaseValue", "addToCart", "initiateCheckout", "roas",
           "raw", "date"
    FROM "FacebookAdInsightSnapshot"
    WHERE "accountId" = ${accountId}
      AND "level" = 'ad'
      AND "date" >= ${since}
      AND "date" <= ${until}
    ORDER BY "date" ASC
  `;
}
