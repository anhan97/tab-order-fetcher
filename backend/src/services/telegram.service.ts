/**
 * New-order alerts to Telegram, per store.
 *
 * Each store picks a chat (a person, group or channel) and optionally its own
 * bot; without one the app-wide TELEGRAM_BOT_TOKEN bot is used. Alerts fire
 * only for orders that are NEW to us and were placed recently, so a backfill
 * or a store's first sync never floods the chat with old orders.
 *
 * Exactly once: the order row is claimed (telegramNotifiedAt) before sending.
 * The webhook and the periodic sync can both see the same new order; only the
 * one that wins the claim sends. A failed send is not retried — a missed alert
 * is better than a duplicate — and the reason is kept on the store for the UI.
 */
import { PrismaClient } from '@prisma/client';
import { decryptToken } from '../lib/token-crypto';

const prisma = new PrismaClient();

/** Orders placed longer ago than this are never announced. */
export const ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const API = 'https://api.telegram.org';

export class TelegramError extends Error {}

export function botTokenFor(store: { telegramBotToken: string | null }): string | null {
  if (store.telegramBotToken) return decryptToken(store.telegramBotToken);
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

async function call<T = any>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new TelegramError(json.description || `Telegram ${method} failed (HTTP ${res.status})`);
  }
  return json.result as T;
}

export function sendMessage(token: string, chatId: string, html: string) {
  return call(token, 'sendMessage', {
    chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true
  });
}

export function getBotInfo(token: string) {
  return call<{ username: string; first_name: string }>(token, 'getMe', {});
}

/**
 * Chats that recently messaged the bot — lets the user find their chat id by
 * sending the bot a message instead of hunting for it. Only works while the
 * bot has no webhook set (Telegram's rule for getUpdates).
 */
export async function recentChats(token: string): Promise<Array<{ id: string; title: string; type: string }>> {
  const updates = await call<any[]>(token, 'getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
  const seen = new Map<string, { id: string; title: string; type: string }>();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
    if (!chat) continue;
    const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    seen.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
  }
  return [...seen.values()].reverse();
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function money(amount: unknown, currency: string | null | undefined): string {
  const n = Number(amount);
  const v = Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(amount ?? '');
  return currency ? `${v} ${currency}` : v;
}

const MAX_ITEMS = 10;

/** The alert text for a Shopify order payload (Telegram HTML). */
export function formatOrderAlert(order: any, store: { name: string | null; storeDomain: string }): string {
  const storeName = store.name || store.storeDomain;
  const number = order.name || `#${order.order_number ?? order.id}`;
  const addr = order.shipping_address ?? order.billing_address ?? null;
  const items: any[] = Array.isArray(order.line_items) ? order.line_items : [];
  const units = items.reduce((s, li) => s + (Number(li.quantity) || 0), 0);

  const lines = [
    `🛒 <b>New order ${esc(number)}</b> · ${esc(storeName)}`,
    `💰 <b>${esc(money(order.total_price, order.currency))}</b>${order.financial_status ? ` · ${esc(order.financial_status)}` : ''}`,
    ''
  ];
  for (const li of items.slice(0, MAX_ITEMS)) {
    const variant = li.variant_title && li.variant_title !== 'Default Title' ? ` — ${esc(li.variant_title)}` : '';
    lines.push(`• ${esc(li.title || li.name)}${variant} × ${esc(li.quantity)}`);
  }
  if (items.length > MAX_ITEMS) lines.push(`• …and ${items.length - MAX_ITEMS} more`);
  if (items.length) lines.push(`<i>${units} unit${units === 1 ? '' : 's'}</i>`);

  const place = addr ? [addr.city, addr.province_code || addr.province, addr.country_code || addr.country].filter(Boolean).join(', ') : '';
  const customer = addr?.name || [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ');
  if (customer || place) lines.push('', `📍 ${esc([customer, place].filter(Boolean).join(' · '))}`);

  const source = order.landing_site && /utm_source=([^&]+)/.exec(order.landing_site)?.[1];
  if (source) lines.push(`📣 ${esc(decodeURIComponent(source))}`);

  if (order.id) lines.push('', `<a href="https://${esc(store.storeDomain)}/admin/orders/${esc(order.id)}">Open in Shopify</a>`);
  return lines.join('\n');
}

/**
 * Announce a just-created order if the store wants alerts. Never throws —
 * order ingestion must not fail because Telegram is down.
 */
export async function notifyNewOrder(storeId: string, orderId: string, payload: any): Promise<void> {
  try {
    const store = await prisma.shopifyStore.findUnique({
      where: { id: storeId },
      select: { name: true, storeDomain: true, telegramEnabled: true, telegramChatId: true, telegramBotToken: true, telegramError: true }
    });
    if (!store?.telegramEnabled || !store.telegramChatId) return;
    const token = botTokenFor(store);
    if (!token) return;

    const placed = new Date(payload?.created_at ?? payload?.processed_at ?? 0).getTime();
    if (!Number.isFinite(placed) || Date.now() - placed > ALERT_MAX_AGE_MS) return;

    const claimed = await prisma.order.updateMany({
      where: { id: orderId, telegramNotifiedAt: null },
      data: { telegramNotifiedAt: new Date() }
    });
    if (claimed.count === 0) return;

    try {
      await sendMessage(token, store.telegramChatId, formatOrderAlert(payload, store));
      if (store.telegramError) {
        await prisma.shopifyStore.update({ where: { id: storeId }, data: { telegramError: null } });
      }
    } catch (e: any) {
      const reason = (e?.message || String(e)).slice(0, 300);
      console.warn(`[telegram] ${store.storeDomain}: ${reason}`);
      await prisma.shopifyStore.update({ where: { id: storeId }, data: { telegramError: reason } });
    }
  } catch (e: any) {
    console.warn('[telegram] notify failed:', e?.message || e);
  }
}
