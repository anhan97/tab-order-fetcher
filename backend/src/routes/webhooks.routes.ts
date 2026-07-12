/**
 * POST /api/webhooks/shopify — inbound Shopify webhooks.
 *
 * Auth = HMAC signature over the raw body (captured by the express.json
 * verify hook in server.ts). Production rejects bad signatures; dev logs a
 * warning and continues to ease manual testing with curl.
 */
import { Router, Request, Response } from 'express';
import { processShopifyWebhook, verifyWebhookHmac } from '../services/shopify-webhooks.service';

const router = Router();

router.post('/shopify', async (req: Request, res: Response) => {
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const shop = req.get('X-Shopify-Shop-Domain');
    const topic = req.get('X-Shopify-Topic');
    const webhookId = req.get('X-Shopify-Webhook-Id');

    if (!hmac || !shop || !topic || !webhookId) {
      return res.status(400).json({ error: 'Missing required Shopify webhook headers' });
    }

    const rawBody = (req as any).rawBody as string | undefined;
    if (!(await verifyWebhookHmac(shop, rawBody || '', hmac))) {
      console.warn(`[webhooks] HMAC verification failed for ${shop} (${topic})`);
      if (process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Invalid HMAC signature' });
      }
    }

    const { duplicate } = await processShopifyWebhook(webhookId, topic, shop, req.body);
    res.json({ received: true, duplicate });
  } catch (e: any) {
    // Reaching here means the ledger write itself failed (DB down etc.) —
    // return 500 so Shopify retries the delivery. Per-order processing
    // failures are already swallowed into the WebhookEvent row and get 200.
    console.error('[webhooks] handler error:', e);
    res.status(500).json({ error: 'webhook processing failed' });
  }
});

export default router;
