// يستقبل Database Webhooks (إدراج في notifications أو messages) ويرسل إشعارات Expo
import { json } from '../_shared/cors.ts';
import { sendFcm } from '../_shared/fcm.ts';
import { admin } from '../_shared/supabase.ts';
import { presign } from '../_shared/storage.ts';

interface PushMessage { to: string; title: string; body: string; data: Record<string, unknown>; sound: 'default'; channelId: string }

/** رابط مؤقت لصورة مخزنة (يبقى صالحاً يوماً كاملاً حتى لو فتح الطالب الإشعار لاحقاً) */
async function imageUrl(key?: string | null): Promise<string | undefined> {
  if (!key) return undefined;
  try { return await presign('GET', key, 24 * 3600); } catch (e) { console.error('image', e); return undefined; }
}

async function sendPush(userIds: string[], title: string, body: string, data: Record<string, unknown>, channelId = 'default', image?: string, tag?: string) {
  if (!userIds.length) return;
  const { data: tokens } = await admin.from('push_tokens').select('user_id, token').in('user_id', userIds);
  const all = (tokens ?? []).map((t) => t.token as string);
  // رموز Firebase المباشرة (بلا حساب Expo)
  const fcm = all.filter((t) => !t.startsWith('ExponentPushToken'));
  const deadFcm = await sendFcm(fcm.map((token) => ({ token, title, body, data, channelId, image, tag }))).catch((e) => {
    console.error(e);
    return [] as string[];
  });
  if (deadFcm.length) await admin.from('push_tokens').delete().in('token', deadFcm);
  // رموز Expo (إن رُبط حساب Expo لاحقاً)
  const messages: PushMessage[] = all.filter((t) => t.startsWith('ExponentPushToken'))
    .map((to) => ({ to, title, body, data, sound: 'default', channelId }));
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    const out = await res.json().catch(() => null);
    // حذف الأجهزة التي لم تعد مسجلة
    const dead = (out?.data ?? [])
      .map((r: { status: string; details?: { error?: string } }, j: number) =>
        r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? batch[j].to : null)
      .filter(Boolean);
    if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'unauthorized' }, 401);

  const payload = await req.json();
  if (payload.type !== 'INSERT') return json({ ok: true });
  const r = payload.record;

  if (payload.table === 'notifications') {
    let body: string = r.body ?? '';
    let image: string | undefined;
    // الخبر: النص كاملاً (حتى يتوسع الإشعار بالسحب) وصورة الغلاف إن وُجدت
    if (r.payload?.post_id) {
      const { data: post } = await admin.from('posts').select('body, cover_key').eq('id', r.payload.post_id).maybeSingle();
      if (post?.body) body = String(post.body).slice(0, 600);
      image = await imageUrl(post?.cover_key);
    }
    await sendPush([r.user_id], r.title, body, { type: r.type, ...r.payload }, 'default', image);
  }

  if (payload.table === 'messages') {
    const [{ data: conv }, { data: sender }, { data: members }] = await Promise.all([
      admin.from('conversations').select('id, type, title').eq('id', r.conversation_id).single(),
      admin.from('profiles').select('full_name').eq('id', r.sender_id).single(),
      admin.from('conversation_members').select('user_id, muted').eq('conversation_id', r.conversation_id),
    ]);
    const mentioned = new Set<string>(r.mentions ?? []); // هؤلاء يصلهم إشعار «أشار إليك» بدلاً من هذا
    const to = (members ?? [])
      .filter((m) => m.user_id !== r.sender_id && !m.muted && !mentioned.has(m.user_id))
      .map((m) => m.user_id);
    const preview = r.body?.trim() || (r.attachment?.type === 'image' ? 'صورة' : `مرفق: ${r.attachment?.title ?? ''}`.trim());
    const name = sender?.full_name ?? 'رسالة جديدة';
    const title = conv?.type === 'direct' ? name : (conv?.title ?? 'سعي');
    const body = conv?.type === 'direct' ? preview : `${name}: ${preview}`;
    // صورة في الرسالة: تظهر مصغّرة كبيرة في الإشعار. tag يجمع رسائل نفس المحادثة في إشعار واحد
    const image = r.attachment?.type === 'image' ? await imageUrl(r.attachment.key) : undefined;
    await sendPush(to, title, body.slice(0, 500), { type: 'message', conversation_id: r.conversation_id }, 'chat', image);
  }

  return json({ ok: true });
});
