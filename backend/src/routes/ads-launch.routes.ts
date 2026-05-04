/**
 * Bulk-launch ads endpoints. Backed by fb-ad-launch.service which encapsulates
 * the campaign / ad set / ad / media-upload pipeline. This route layer only
 * deals with HTTP — multipart parsing, SSE streaming, store resolution.
 *
 * Routes:
 *   GET  /api/ads/pages?adAccountId=…    — pages this ad account can promote
 *   GET  /api/ads/pixels?adAccountId=…   — pixels on the ad account
 *   POST /api/ads/bulk-launch (multipart) — launch the campaign and stream
 *                                           progress events as SSE.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { resolveStore } from '../middleware/resolve-store';
import {
  runBulkLaunch,
  listPromotablePages,
  listPixels,
  ProgressEvent,
  AdCopy,
  UploadedCreative
} from '../services/fb-ad-launch.service';
import * as userToken from '../services/fb-user-token.service';

/**
 * Pull the caller's stored long-lived FB token from UserFacebookConnection.
 * Used as the fallback for service-layer calls so user-token mode reaches
 * FB instead of silently falling through to the Adlux pool. Returns
 * undefined when the user has no FB connection (system-bm mode path).
 */
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

// Per-file 500 MB hard cap (matches the FB video limit) — multer rejects
// anything larger before the handler runs. Files are kept in memory because
// the FB upload happens immediately and we never persist them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 50 }
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

    const required = ['adAccountId', 'campaignName', 'pageId', 'pixelId', 'linkUrl', 'dailyBudget'];
    for (const k of required) {
      if (!body[k]) return res.status(400).json({ error: `${k} is required` });
    }

    // Per-file ad copy override map: filename → { primary_texts, headlines, descriptions }
    let perFileCopy: Record<string, AdCopy> = {};
    if (body.perFileCopy) {
      try {
        perFileCopy = JSON.parse(body.perFileCopy);
      } catch {
        return res.status(400).json({ error: 'perFileCopy must be valid JSON' });
      }
    }

    let globalCopy: AdCopy | undefined;
    if (body.globalCopy) {
      try {
        globalCopy = JSON.parse(body.globalCopy);
      } catch {
        return res.status(400).json({ error: 'globalCopy must be valid JSON' });
      }
    }

    // SSE setup — flush headers immediately so the browser opens the stream.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
    res.flushHeaders();

    const send = (e: ProgressEvent) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    // Map multer files → service input shape, attaching per-file copy when supplied.
    const creatives: UploadedCreative[] = files.map(f => ({
      filename: f.originalname,
      buffer: f.buffer,
      mimetype: f.mimetype,
      copy: perFileCopy[f.originalname]
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
          dailyBudget: parseInt(String(body.dailyBudget), 10) || 5000,
          bidStrategy: (body.bidStrategy as any) || 'bid_cap',
          bidAmount: body.bidAmount ? parseInt(String(body.bidAmount), 10) : 1000,
          callToAction: body.callToAction ? String(body.callToAction) : undefined,
          countries: body.countries ? String(body.countries).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
          globalCopy,
          fallbackAccessToken: await resolveUserFbToken(req.resolved?.userId)
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
