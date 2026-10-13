import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Message } from '@saey/shared';
import { isNetworkError } from './offline-fetch';
import { isOffline, onOnline } from './offline';
import { supabase } from './supabase';

/**
 * صندوق الصادر: رسالة نصية كُتبت بلا إنترنت لا تضيع — تظهر في المحادثة بعلامة «بانتظار الإنترنت»
 * وتُرسل وحدها عند عودة الاتصال (حتى لو أُغلقت المحادثة أو التطبيق). لكل رسالة معرّف ثابت يُولَّد على الهاتف،
 * فإن وصلت للخادم وضاع الرد ثم أُعيد إرسالها لا تتكرر (الخادم يرفض المعرّف المكرر فنعتبرها وصلت).
 */
export interface OutboxItem {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  reply_to_id: string | null;
  mentions: string[];
  created_at: string;
  /** إعادة توجيه (تظهر بعلامة «مُعاد توجيهها») */
  forwarded?: boolean;
}

type Event = { type: 'sent'; item: OutboxItem; message: Message } | { type: 'failed'; item: OutboxItem; error: string };

const KEY = 'saey.c1.outbox';
const listeners = new Set<(e: Event) => void>();
let items: OutboxItem[] | null = null;

async function load(): Promise<OutboxItem[]> {
  if (items) return items;
  try { items = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as OutboxItem[]; } catch { items = []; }
  return items;
}
async function save() {
  await AsyncStorage.setItem(KEY, JSON.stringify(items ?? [])).catch(() => {});
}

/** معرّف UUID v4 (بلا مكتبة) */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** هل الخطأ انقطاع إنترنت (فننتظر) لا رفضاً من الخادم؟ */
export function isOfflineError(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  return /network request failed|failed to fetch|network|timeout|aborted/i.test(msg) || isOffline();
}

export function onOutbox(cb: (e: Event) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function pendingFor(conversationId: string): Promise<OutboxItem[]> {
  return (await load()).filter((x) => x.conversation_id === conversationId);
}

export async function enqueue(item: OutboxItem): Promise<void> {
  const list = await load();
  if (!list.some((x) => x.id === item.id)) list.push(item);
  await save();
}

export async function cancel(id: string): Promise<void> {
  items = (await load()).filter((x) => x.id !== id);
  await save();
}

let flushing: Promise<void> | null = null;
/** يرسل المنتظر بالترتيب؛ يتوقف عند أول انقطاع ليعيد عند عودة الإنترنت */
export function flushOutbox(): Promise<void> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  const list = [...await load()];
  for (const item of list) {
    const { data, error } = await supabase.from('messages').insert({
      id: item.id,
      conversation_id: item.conversation_id,
      sender_id: item.sender_id,
      body: item.body,
      attachment: null,
      reply_to_id: item.reply_to_id,
      mentions: item.mentions,
      ...(item.forwarded ? { forwarded: true } : {}),
    }).select('*').single();
    let message = data as Message | null;
    if (error) {
      // وصلت سابقاً (ضاع الرد): نجلبها
      if ((error as { code?: string }).code === '23505') {
        const got = await supabase.from('messages').select('*').eq('id', item.id).maybeSingle();
        message = (got.data as Message | null) ?? null;
        if (!message && isOfflineError(got.error)) return;
      } else if (isOfflineError(error)) {
        return;
      }
    }
    await cancel(item.id);
    const e: Event = message ? { type: 'sent', item, message } : { type: 'failed', item, error: error?.message ?? 'تعذّر الإرسال' };
    listeners.forEach((l) => { try { l(e); } catch { /* مستمع فاشل */ } });
  }
}

/** عند عودة الإنترنت وعند فتح التطبيق: إرسال المنتظر */
export function startOutbox(): () => void {
  flushOutbox().catch(() => {});
  return onOnline(() => { flushOutbox().catch(() => {}); });
}

/** عند الخروج (مع مسح المحفوظ) */
export function resetOutbox() {
  items = null;
}
