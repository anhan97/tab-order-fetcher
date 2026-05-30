/**
 * Auto-launch ads — HTTP layer.
 *
 * Routes:
 *   GET    /api/ads/pages?adAccountId=…           — pages this ad account can promote
 *   GET    /api/ads/pixels?adAccountId=…          — pixels on the ad account
 *   GET    /api/ads/audiences?adAccountId=…       — custom + lookalike audiences
 *   GET    /api/ads/interests?q=cats&adAccountId= — interest search (FB targeting search)
 *   POST   /api/ads/bulk-launch   (multipart)     — launch + SSE progress
 *
 *   GET    /api/ads/templates                     — list saved wizard templates
 *   POST   /api/ads/templates                     — create
 *   PUT    /api/ads/templates/:id                 — update
 *   DELETE /api/ads/templates/:id                 — delete
 *
 *   GET    /api/ads/history                       — list past launches
 *   GET    /api/ads/history/:id                   — detail incl. per-file items
 *   POST   /api/ads/history/:id/rollback          — delete the FB campaign
 *
 * The route layer handles multipart parsing, SSE streaming, store /
 * token resolution. All FB-side logic lives in fb-ad-launch.service.ts.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { resolveStore } from '../middleware/resolve-store';
import {
  runBulkLaunch,
  listPromotablePages,
  listPixels,
  listCustomAudiences,
  searchInterests,
  ProgressEvent,
  AdCopy,
  UploadedCreative,
  AdSetSpec
} from '../services/fb-ad-launch.service';
import * as userToken from '../services/fb-user-token.service';
import * as templates from '../services/fb-ad-launch-template.service';
import * as history from '../services/fb-ad-launch-history.service';

async function resolveUserFbToken(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const t = await userToken.getRawToken(userId);
    return t || undefined;
  } catch {
    return undefined;
  }
}

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 50 }
});

// ─── Read endpoints powering the wizard ────────────────────────────────────

/**
 * GET /api/ads/diag?adAccountId=…
 *
 * One-shot diagnostic. Walks the same chain the wizard does and returns
 * every intermediate result so the operator can see exactly which step
 * fails: token scope, /me/permissions, /promote_pages, /me/accounts,
 * /adspixels. No data is filtered — raw FB responses (truncated to
 * keep payload small) are surfaced verbatim.
 *
 * Use when the Page/Pixel dropdown is mysteriously empty.
 */
router.get('/diag', resolveStore, async (req: Request, res: Response) => {
  const out: any = { steps: {} };
  try {
    const userId = req.resolved?.userId;
    const adAccountId = String(req.query.adAccountId || '');
    out.userId = userId;
    out.adAccountId = adAccountId;
    if (!userId) return res.status(401).json({ error: 'unauthenticated', ...out });
    if (!adAccountId) return res.status(400).json({ error: 'adAccountId required', ...out });

    // 1. Token in DB.
    const fetch = (await import('node-fetch')).default;
    const PrismaClient = (await import('@prisma/client')).PrismaClient;
    const prisma = new PrismaClient();
    const tokRows = await prisma.$queryRaw<Array<{
      fbAppId: string; fbUserName: string | null; scopes: string | null;
      expiresAt: Date | null; lastRefreshedAt: Date | null;
      lastError: string | null; tokLen: number;
    }>>`
      SELECT "fbAppId", "fbUserName", "scopes", "expiresAt",
             "lastRefreshedAt", "lastError", LENGTH("accessToken") AS "tokLen"
      FROM "UserFacebookConnection"
      WHERE "userId" = ${userId}
    `;
    out.steps.db_connections = tokRows;

    const token = await resolveUserFbToken(userId);
    out.steps.token_resolved = token ? `len=${token.length}` : null;

    if (!token) {
      out.diagnosis = 'No FB token in DB for this user. /facebook → Connect Facebook.';
      return res.json(out);
    }

    // 2. Live /me/permissions — what scopes FB ACTUALLY thinks the token has.
    const FB_BASE = 'https://graph.facebook.com/v21.0';
    try {
      const r = await fetch(`${FB_BASE}/me/permissions?access_token=${encodeURIComponent(token)}`);
      const text = await r.text();
      out.steps.me_permissions = { status: r.status, body: text.slice(0, 1500) };
    } catch (e: any) {
      out.steps.me_permissions = { error: e?.message };
    }

    // 3. /promote_pages
    const aid = adAccountId.replace(/^act_/, '');
    try {
      const r = await fetch(`${FB_BASE}/act_${aid}/promote_pages?fields=id,name,instagram_business_account&limit=10&access_token=${encodeURIComponent(token)}`);
      const text = await r.text();
      out.steps.promote_pages = { status: r.status, body: text.slice(0, 1500) };
    } catch (e: any) {
      out.steps.promote_pages = { error: e?.message };
    }

    // 4. /me/accounts fallback
    try {
      const r = await fetch(`${FB_BASE}/me/accounts?fields=id,name,instagram_business_account&limit=10&access_token=${encodeURIComponent(token)}`);
      const text = await r.text();
      out.steps.me_accounts = { status: r.status, body: text.slice(0, 1500) };
    } catch (e: any) {
      out.steps.me_accounts = { error: e?.message };
    }

    // 5. /adspixels
    try {
      const r = await fetch(`${FB_BASE}/act_${aid}/adspixels?fields=id,name&access_token=${encodeURIComponent(token)}`);
      const text = await r.text();
      out.steps.adspixels = { status: r.status, body: text.slice(0, 1500) };
    } catch (e: any) {
      out.steps.adspixels = { error: e?.message };
    }

    // Auto-diagnosis from accumulated steps.
    const perms = out.steps.me_permissions?.body || '';
    const hasShowList = /pages_show_list[\s\S]*?"granted"/i.test(perms);
    const hasReadEng = /pages_read_engagement[\s\S]*?"granted"/i.test(perms);
    const promotePagesBody = out.steps.promote_pages?.body || '';
    const meAccountsBody = out.steps.me_accounts?.body || '';
    const pixelsBody = out.steps.adspixels?.body || '';

    if (!hasShowList || !hasReadEng) {
      out.diagnosis = `Token thiếu scopes (granted? show_list=${hasShowList} read_engagement=${hasReadEng}). ` +
        `Vào fb.com/settings/?tab=business_tools → revoke app → /facebook → Disconnect → Connect lại.`;
    } else if (/"data":\s*\[\s*\]/.test(promotePagesBody) && /"data":\s*\[\s*\]/.test(meAccountsBody)) {
      out.diagnosis = `Token có scope đầy đủ NHƯNG cả /promote_pages và /me/accounts đều rỗng. ` +
        `Nghĩa là user FB này không quản lý page nào. Vào fb.com/pages — kiểm tra "Your Pages".`;
    } else if (/"data":\s*\[\s*\]/.test(pixelsBody)) {
      out.diagnosis = `Pages OK nhưng ad account này chưa link pixel nào. ` +
        `Ads Manager → Events Manager → Pixels → connect pixel với ad account.`;
    } else {
      out.diagnosis = 'OK — pages/pixels có data, kiểm tra frontend log nếu UI vẫn rỗng.';
    }
    res.json(out);
  } catch (e: any) {
    out.fatal = e?.message || String(e);
    res.status(500).json(out);
  }
});

router.get('/pages', resolveStore, async (req: Request, res: Response) => {
  try {
    const adAccountId = String(req.query.adAccountId || '');
    if (!adAccountId) return res.status(400).json({ error: 'adAccountId is required' });
    const fallback = await resolveUserFbToken(req.resolved?.userId);
    const pages = await listPromotablePages(adAccountId, fallback);
    res.json({ pages });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/pixels', resolveStore, async (req: Request, res: Response) => {
  try {
    const adAccountId = String(req.query.adAccountId || '');
    if (!adAccountId) return res.status(400).json({ error: 'adAccountId is required' });
    const fallback = await resolveUserFbToken(req.resolved?.userId);
    const pixels = await listPixels(adAccountId, fallback);
    res.json({ pixels });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/audiences', resolveStore, async (req: Request, res: Response) => {
  try {
    const adAccountId = String(req.query.adAccountId || '');
    if (!adAccountId) return res.status(400).json({ error: 'adAccountId is required' });
    const fallback = await resolveUserFbToken(req.resolved?.userId);
    const audiences = await listCustomAudiences(adAccountId, fallback);
    res.json({ audiences });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/interests', resolveStore, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ interests: [] });
    const adAccountId = req.query.adAccountId ? String(req.query.adAccountId) : undefined;
    const fallback = await resolveUserFbToken(req.resolved?.userId);
    const interests = await searchInterests(q, fallback, adAccountId);
    res.json({ interests });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// ─── Templates ─────────────────────────────────────────────────────────────

router.get('/templates', resolveStore, async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    res.json({ templates: await templates.listTemplates(userId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.post('/templates', resolveStore, express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const { name, config, isDefault } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config (object) is required' });
    const row = await templates.createTemplate(userId, { name, config, isDefault: !!isDefault });
    res.status(201).json({ template: row });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.put('/templates/:id', resolveStore, express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const { name, config, isDefault } = req.body || {};
    const row = await templates.updateTemplate(userId, req.params.id, {
      name, config, isDefault: typeof isDefault === 'boolean' ? isDefault : undefined
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: row });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.delete('/templates/:id', resolveStore, async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const ok = await templates.deleteTemplate(userId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// ─── History ───────────────────────────────────────────────────────────────

router.get('/history', resolveStore, async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const accountId = req.query.accountId ? String(req.query.accountId).replace(/^act_/, '') : undefined;
    res.json({ history: await history.listHistory(userId, { limit, accountId }) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.get('/history/:id', resolveStore, async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const row = await history.getHistoryDetail(userId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Launch not found' });
    res.json({ history: row });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

router.post('/history/:id/rollback', resolveStore, async (req: Request, res: Response) => {
  try {
    const userId = req.resolved?.userId;
    if (!userId) return res.status(401).json({ error: 'Auth required' });
    const fallback = await resolveUserFbToken(userId);
    const r = await history.rollbackHistory(userId, req.params.id, fallback);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

// ─── Bulk launch (multipart + SSE) ────────────────────────────────────────

router.post(
  '/bulk-launch',
  resolveStore,
  upload.array('files', 50),
  async (req: Request, res: Response) => {
    const body = req.body || {};
    const files = (req.files as Express.Multer.File[] | undefined) || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one creative file is required' });
    }

    const required = ['adAccountId', 'campaignName', 'pageId', 'pixelId', 'linkUrl'];
    for (const k of required) {
      if (!body[k]) return res.status(400).json({ error: `${k} is required` });
    }

    let perFileCopy: Record<string, AdCopy> = {};
    if (body.perFileCopy) {
      try { perFileCopy = JSON.parse(body.perFileCopy); }
      catch { return res.status(400).json({ error: 'perFileCopy must be valid JSON' }); }
    }

    let globalCopy: AdCopy | undefined;
    if (body.globalCopy) {
      try { globalCopy = JSON.parse(body.globalCopy); }
      catch { return res.status(400).json({ error: 'globalCopy must be valid JSON' }); }
    }

    let adSets: AdSetSpec[] = [];
    if (body.adSets) {
      try { adSets = JSON.parse(body.adSets); }
      catch { return res.status(400).json({ error: 'adSets must be valid JSON' }); }
    }
    // Backwards-compat: if the legacy "countries" field came in, synthesise
    // a single ad set so old callers (and quick-launch UIs) still work.
    if (!adSets.length) {
      const legacyCountries = body.countries
        ? String(body.countries).split(',').map((s: string) => s.trim()).filter(Boolean)
        : ['US', 'GB', 'CA', 'AU'];
      adSets = [{
        name: 'Ad Set',
        audience: { name: 'Default', countries: legacyCountries }
      }];
    }
    if (adSets.length > 20) {
      return res.status(400).json({ error: 'Too many ad sets — cap is 20 per launch' });
    }

    let perFileAdSetIndexes: Record<string, number[]> = {};
    if (body.perFileAdSetIndexes) {
      try { perFileAdSetIndexes = JSON.parse(body.perFileAdSetIndexes); }
      catch { return res.status(400).json({ error: 'perFileAdSetIndexes must be valid JSON' }); }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (e: ProgressEvent) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    const creatives: UploadedCreative[] = files.map(f => ({
      filename: f.originalname,
      buffer: f.buffer,
      mimetype: f.mimetype,
      copy: perFileCopy[f.originalname],
      adSetIndexes: perFileAdSetIndexes[f.originalname]
    }));

    try {
      await runBulkLaunch(
        {
          adAccountId: String(body.adAccountId),
          campaignName: String(body.campaignName),
          pageId: String(body.pageId),
          pixelId: String(body.pixelId),
          instagramActorId: body.instagramActorId ? String(body.instagramActorId) : undefined,
          linkUrl: String(body.linkUrl),
          urlParams: body.urlParams ? String(body.urlParams) : undefined,
          campaignDailyBudget: body.campaignDailyBudget
            ? parseInt(String(body.campaignDailyBudget), 10)
            : (body.dailyBudget ? parseInt(String(body.dailyBudget), 10) : undefined),
          bidStrategy: body.bidStrategy as any,
          bidAmount: body.bidAmount ? parseInt(String(body.bidAmount), 10) : undefined,
          objective: body.objective ? String(body.objective) : undefined,
          callToAction: body.callToAction ? String(body.callToAction) : undefined,
          startTime: body.startTime ? parseInt(String(body.startTime), 10) : undefined,
          status: (body.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'),
          adSets,
          globalCopy,
          fallbackAccessToken: await resolveUserFbToken(req.resolved?.userId),
          userId: req.resolved?.userId
        },
        creatives,
        send
      );
    } catch (e: any) {
      send({ step: 'error', status: 'failed', message: e?.message || String(e), error: e?.message || String(e) });
    } finally {
      res.end();
    }
  }
);

export default router;
