import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** «يكتب…» عبر Realtime Broadcast (لا يمر بقاعدة البيانات) */
export interface Typist { user_id: string; name: string }
type Listener = (typists: Typist[]) => void;
interface Entry {
  channel: RealtimeChannel;
  refs: number;
  listeners: Set<Listener>;
  typists: Map<string, { name: string; until: number }>;
  timer?: ReturnType<typeof setTimeout>;
}

// قناة واحدة لكل محادثة يتشاركها كل من يستمع (القائمة والمحادثة): supabase.channel يعيد نفس القناة للاسم نفسه
const entries = new Map<string, Entry>();
const TTL = 5000; // بلا إشارة جديدة خلال ٥ ثوانٍ ← توقف عن الكتابة
const EVERY = 2500; // أقصى إشارة كل ٢٫٥ ثانية من الكاتب
const lastSent = new Map<string, number>();

function emit(e: Entry) {
  const now = Date.now();
  for (const [k, v] of e.typists) if (v.until <= now) e.typists.delete(k);
  const list = [...e.typists].map(([user_id, v]) => ({ user_id, name: v.name }));
  e.listeners.forEach((l) => l(list));
  if (e.timer) clearTimeout(e.timer);
  if (e.typists.size) {
    const next = Math.min(...[...e.typists.values()].map((v) => v.until)) - now + 50;
    e.timer = setTimeout(() => emit(e), Math.max(100, next));
  }
}

function open(conversationId: string): Entry {
  let e = entries.get(conversationId);
  if (!e) {
    const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } });
    const entry: Entry = { channel, refs: 0, listeners: new Set(), typists: new Map() };
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { user_id?: string; name?: string; stop?: boolean };
        if (!p?.user_id) return;
        if (p.stop) entry.typists.delete(p.user_id);
        else entry.typists.set(p.user_id, { name: p.name ?? '', until: Date.now() + TTL });
        emit(entry);
      })
      .subscribe();
    entries.set(conversationId, entry);
    e = entry;
  }
  e.refs++;
  return e;
}

/** يستمع لمن يكتب في المحادثة؛ يرجع دالة الإلغاء */
export function subscribeTyping(conversationId: string, listener: Listener): () => void {
  const e = open(conversationId);
  e.listeners.add(listener);
  return () => {
    e.listeners.delete(listener);
    e.refs--;
    if (e.refs <= 0) {
      if (e.timer) clearTimeout(e.timer);
      entries.delete(conversationId);
      supabase.removeChannel(e.channel);
    }
  };
}

/** الكاتب: true مع كل حرف (تُرسل مرة كل ٢٫٥ ثانية)، false عند الإرسال أو مسح النص */
export function sendTyping(conversationId: string, me: { id: string; name: string }, typing: boolean) {
  const e = entries.get(conversationId);
  if (!e) return;
  const now = Date.now();
  const last = lastSent.get(conversationId) ?? 0;
  if (typing && now - last < EVERY) return;
  if (!typing && !last) return;
  lastSent.set(conversationId, typing ? now : 0);
  e.channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: me.id, name: me.name, stop: !typing } }).catch(() => {});
}
