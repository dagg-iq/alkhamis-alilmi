import type { Attachment, Message } from '@saey/shared';
import { enqueue, flushOutbox, isOfflineError, uuid } from './outbox';
import { callFunction, supabase } from './supabase';

/**
 * يعيد توجيه رسالة إلى محادثة: نفس النص والمرفق بعلامة «مُعاد توجيهها» (بلا رد ولا إشارات).
 * الصور وملفات PDF تُنسخ على الخادم لمجلد المحادثة الهدف (لا يقرأ ملف المحادثة إلا أعضاؤها).
 * النص وحده بلا إنترنت يدخل صندوق الصادر ويُرسل عند عودة الاتصال.
 */
export async function forwardMessage(m: Message, to: string, myId: string): Promise<{ queued: boolean }> {
  let attachment: Attachment | null = m.attachment ?? null;
  if (attachment && (attachment.type === 'image' || attachment.type === 'file')) {
    const { keys } = await callFunction<{ keys: Record<string, string> }>('files', { action: 'forward', keys: [attachment.key], to });
    const key = keys[attachment.key];
    if (!key) throw new Error('تعذّر نسخ المرفق.');
    attachment = { ...attachment, key };
  }
  const id = uuid();
  const row = { id, conversation_id: to, sender_id: myId, body: m.body, attachment, reply_to_id: null, mentions: [] as string[], forwarded: true };
  const { error } = await supabase.from('messages').insert(row);
  if (!error) return { queued: false };
  if (!attachment && m.body && isOfflineError(error)) {
    await enqueue({ id, conversation_id: to, sender_id: myId, body: m.body, reply_to_id: null, mentions: [], created_at: new Date().toISOString(), forwarded: true });
    flushOutbox().catch(() => {});
    return { queued: true };
  }
  throw new Error(error.message);
}
