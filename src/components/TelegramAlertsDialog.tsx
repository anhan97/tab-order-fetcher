/**
 * New-order Telegram alerts for one store. Opened from the Stores page, so it
 * addresses the store explicitly (not the sidebar's active store).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2, Search, Send } from 'lucide-react';
import { apiFetch } from '@/utils/apiClient';
import { useToast } from '@/hooks/use-toast';

interface Settings {
  enabled: boolean;
  chatId: string | null;
  hasOwnBot: boolean;
  appBotAvailable: boolean;
  botUsername: string | null;
  error: string | null;
}

interface Chat { id: string; title: string; type: string }

export const TelegramAlertsDialog = ({ store, open, onOpenChange }: {
  store: { storeDomain: string; name: string | null };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) => {
  const { toast } = useToast();
  const headers = { 'X-Shopify-Store-Domain': store.storeDomain };
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [clearBot, setClearBot] = useState(false);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'detect' | null>(null);

  useEffect(() => {
    if (!open) return;
    setBotToken(''); setClearBot(false); setChats(null);
    setBusy('load');
    apiFetch<Settings>('/api/notifications/telegram', { headers })
      .then(s => { setSettings(s); setEnabled(s.enabled); setChatId(s.chatId ?? ''); })
      .catch(e => toast({ title: 'Could not load Telegram settings', description: e?.message, variant: 'destructive' }))
      .finally(() => setBusy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, store.storeDomain]);

  const typedToken = botToken.trim();
  const hasBot = !!typedToken || (!clearBot && !!settings?.hasOwnBot) || !!settings?.appBotAvailable;
  const body = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ chatId: chatId.trim(), ...(typedToken ? { botToken: typedToken } : {}), ...extra });

  const detect = async () => {
    setBusy('detect');
    try {
      const r = await apiFetch<{ chats: Chat[] }>('/api/notifications/telegram/detect-chats', { method: 'POST', headers, body: body() });
      setChats(r.chats);
    } catch (e: any) {
      toast({ title: 'Could not read chats', description: e?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const test = async () => {
    setBusy('test');
    try {
      await apiFetch('/api/notifications/telegram/test', { method: 'POST', headers, body: body() });
      toast({ title: 'Test message sent', description: 'Check your Telegram chat.' });
    } catch (e: any) {
      toast({ title: 'Test failed', description: e?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save');
    try {
      const botField = typedToken ? { botToken: typedToken } : clearBot ? { botToken: '' } : {};
      await apiFetch('/api/notifications/telegram', {
        method: 'PUT', headers,
        body: JSON.stringify({ enabled, chatId: chatId.trim(), ...botField })
      });
      toast({ title: enabled ? 'New-order alerts on' : 'Telegram settings saved', description: store.name || store.storeDomain });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Could not save', description: e?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const botLabel = settings?.botUsername ? `@${settings.botUsername}` : 'your bot';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Telegram order alerts</DialogTitle>
          <DialogDescription>
            Post a message to Telegram whenever {store.name || store.storeDomain} gets a new order.
          </DialogDescription>
        </DialogHeader>

        {busy === 'load' || !settings ? (
          <div className="py-10 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
        ) : (
          <div className="space-y-5">
            {settings.error && (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>The last alert failed: {settings.error}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label htmlFor="tg-enabled" className="text-sm font-medium">Send new-order alerts</Label>
              <Switch id="tg-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-token">Bot token</Label>
              <Input
                id="tg-token"
                type="password"
                autoComplete="off"
                value={botToken}
                onChange={e => { setBotToken(e.target.value); setClearBot(false); }}
                placeholder={
                  settings.hasOwnBot && !clearBot ? 'Saved — leave empty to keep it'
                    : settings.appBotAvailable ? "Optional — the app's shared bot is used otherwise"
                    : '123456789:AA… from @BotFather'
                }
              />
              <p className="text-xs text-slate-500">
                Create a bot with <b>@BotFather</b> on Telegram (/newbot) and paste its token.
                {settings.hasOwnBot && !typedToken && (
                  clearBot
                    ? <> The saved bot will be removed. <button className="underline" onClick={() => setClearBot(false)}>Undo</button></>
                    : settings.appBotAvailable && <> <button className="underline" onClick={() => setClearBot(true)}>Use the app's bot instead</button></>
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-chat">Chat ID</Label>
              <div className="flex gap-2">
                <Input id="tg-chat" value={chatId} onChange={e => setChatId(e.target.value)} placeholder="-1001234567890" />
                <Button variant="outline" onClick={() => void detect()} disabled={!hasBot || busy !== null} title="Find chats that messaged the bot">
                  {busy === 'detect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-1.5">Find</span>
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Add {botLabel} to your group (or open a chat with it) and send any message, then press <b>Find</b>.
              </p>
              {chats && (
                chats.length === 0 ? (
                  <p className="text-xs text-amber-700">No chats yet — send the bot a message first, then press Find again.</p>
                ) : (
                  <div className="rounded-md border divide-y">
                    {chats.map(c => (
                      <button key={c.id} onClick={() => { setChatId(c.id); setChats(null); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between gap-3">
                        <span className="truncate">{c.title}</span>
                        <span className="text-xs text-slate-400 shrink-0">{c.type} · {c.id}</span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => void test()} disabled={!settings || !hasBot || !chatId.trim() || busy !== null}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Send test
          </Button>
          <Button onClick={() => void save()} disabled={!settings || busy !== null} className="bg-teal-600 hover:bg-teal-700">
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
