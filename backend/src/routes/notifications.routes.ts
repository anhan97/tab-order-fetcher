/**
 * Per-store notification settings — mounted at /api/notifications.
 *
 *   GET  /telegram               current settings (the bot token is never returned)
 *   PUT  /telegram               save { enabled, chatId, botToken? }
 *   POST /telegram/test          send a test message
 *   POST /telegram/detect-chats  chats that recently messaged the bot
 *
 * botToken: omitted = keep the saved one, '' = clear it (fall back to the
 * app-wide TELEGRAM_BOT_TOKEN bot), anything else = replace (checked with
 * Telegram before saving). Changing settings needs the 'manage' capability.
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore, requireStoreCapability } from '../middleware/resolve-store';
import { encryptToken } from '../lib/token-crypto';
import { audit } from '../lib/audit';
import { botTokenFor, getBotInfo, recentChats, sendMessage, TelegramError } from '../services/telegram.service';

const router = Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireActive, resolveStore);

const SELECT = {
  name: true, storeDomain: true,
  telegramEnabled: true, telegramChatId: true, telegramBotToken: true, telegramError: true
} as const;

const loadStore = (req: Request) =>
  prisma.shopifyStore.findUnique({ where: { id: req.resolved!.storeId }, select: SELECT });

const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/;
const BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

/** Token for a request: a freshly typed one wins over the saved / app bot. */
function tokenFrom(body: any, store: { telegramBotToken: string | null }): string | null {
  const typed = typeof body?.botToken === 'string' ? body.botToken.trim() : '';
  return typed || botTokenFor(store);
}

async function botName(token: string | null): Promise<string | null> {
  if (!token) return null;
  try { return (await getBotInfo(token)).username; } catch { return null; }
}

router.get('/telegram', async (req: Request, res: Response) => {
  try {
    const store = await loadStore(req);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({
      enabled: store.telegramEnabled,
      chatId: store.telegramChatId,
      hasOwnBot: !!store.telegramBotToken,
      appBotAvailable: !!process.env.TELEGRAM_BOT_TOKEN,
      botUsername: await botName(botTokenFor(store)),
      error: store.telegramError
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load Telegram settings' });
  }
});

router.put('/telegram', requireStoreCapability('manage'), async (req: Request, res: Response) => {
  try {
    const store = await loadStore(req);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const enabled = !!req.body?.enabled;
    const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId.trim() || null : null;
    if (chatId && !CHAT_ID.test(chatId)) {
      return res.status(400).json({ error: 'Chat ID must be a number (e.g. -1001234567890) or a @channel name' });
    }

    const data: Record<string, unknown> = { telegramEnabled: enabled, telegramChatId: chatId, telegramError: null };
    if (typeof req.body?.botToken === 'string') {
      const typed = req.body.botToken.trim();
      if (typed) {
        if (!BOT_TOKEN.test(typed)) return res.status(400).json({ error: 'That does not look like a bot token from @BotFather' });
        try { await getBotInfo(typed); } catch (e: any) {
          return res.status(400).json({ error: `Telegram rejected the bot token: ${e?.message}` });
        }
        data.telegramBotToken = encryptToken(typed);
      } else {
        data.telegramBotToken = null;
      }
    }

    const willHaveBot = data.telegramBotToken !== undefined ? !!data.telegramBotToken || !!process.env.TELEGRAM_BOT_TOKEN : !!botTokenFor(store);
    if (enabled && (!chatId || !willHaveBot)) {
      return res.status(400).json({ error: !chatId ? 'Enter a chat ID to turn alerts on' : 'Add a bot token to turn alerts on' });
    }

    await prisma.shopifyStore.update({ where: { id: req.resolved!.storeId }, data });
    await audit({
      userId: req.resolved!.userId,
      actorUserId: req.resolved!.actorId,
      action: 'store.telegram_updated',
      target: req.resolved!.storeId,
      metadata: { enabled, chatId, botChanged: data.telegramBotToken !== undefined }
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to save Telegram settings' });
  }
});

router.post('/telegram/test', requireStoreCapability('manage'), async (req: Request, res: Response) => {
  try {
    const store = await loadStore(req);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const token = tokenFrom(req.body, store);
    const chatId = (typeof req.body?.chatId === 'string' && req.body.chatId.trim()) || store.telegramChatId;
    if (!token) return res.status(400).json({ error: 'No bot token — add one first' });
    if (!chatId) return res.status(400).json({ error: 'Enter a chat ID first' });

    await sendMessage(token, chatId,
      `✅ <b>Test alert</b> from ${(store.name || store.storeDomain).replace(/[<>&]/g, '')}\nNew orders on this store will be posted here.`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(e instanceof TelegramError ? 400 : 500).json({ error: e?.message || 'Failed to send the test message' });
  }
});

router.post('/telegram/detect-chats', requireStoreCapability('manage'), async (req: Request, res: Response) => {
  try {
    const store = await loadStore(req);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const token = tokenFrom(req.body, store);
    if (!token) return res.status(400).json({ error: 'No bot token — add one first' });
    res.json({ chats: await recentChats(token), botUsername: await botName(token) });
  } catch (e: any) {
    res.status(e instanceof TelegramError ? 400 : 500).json({ error: e?.message || 'Failed to read chats' });
  }
});

export default router;
