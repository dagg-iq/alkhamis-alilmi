// روابط رفع وتحميل مؤقتة للملفات بعد التحقق من الصلاحية (Supabase Storage أو R2/B2)
import { handler, HttpError, json } from '../_shared/cors.ts';
import { getCaller } from '../_shared/supabase.ts';
import { MAX_UPLOAD_BYTES, presign } from '../_shared/storage.ts';

type Kind = 'material' | 'chat' | 'scan' | 'cover';
const PREFIX: Record<Kind, string> = { material: 'materials', chat: 'chat', scan: 'scans', cover: 'covers' };
const ALLOWED_TYPES: Record<Kind, string[]> = {
  material: ['application/pdf'],
  chat: ['image/jpeg', 'image/png', 'image/webp'],
  scan: ['image/jpeg', 'image/png'],
  cover: ['image/jpeg', 'image/png', 'image/webp'],
};
const EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

Deno.serve(handler(async (req) => {
  const body = await req.json();
  const caller = await getCaller(req);
  const isStaff = caller.role !== 'student';

  if (body.action === 'upload') {
    const kind = body.kind as Kind;
    if (!PREFIX[kind]) throw new HttpError(400, 'نوع ملف غير معروف.');
    if (!ALLOWED_TYPES[kind].includes(body.contentType)) throw new HttpError(400, 'صيغة الملف غير مدعومة.');
    if (typeof body.size === 'number' && body.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `الملف أكبر من ${Math.round(MAX_UPLOAD_BYTES / 1048576)} ميغا. اضغطه (مثلاً بموقع ilovepdf.com) ثم ارفعه.`);
    }
    let folder = PREFIX[kind];
    if (kind === 'chat') {
      const { data: member } = await caller.client.rpc('is_member', { p_conversation: body.conversationId });
      if (!member) throw new HttpError(403, 'لست عضواً في هذه المحادثة.');
      folder = `chat/${body.conversationId}`;
    } else if (!isStaff) {
      throw new HttpError(403, 'رفع هذا النوع للأدمن والمشرفين فقط.');
    }
    const key = `${folder}/${crypto.randomUUID()}.${EXT[body.contentType]}`;
    const url = await presign('PUT', key, 900, body.contentType);
    return json({ key, url });
  }

  if (body.action === 'download') {
    const keys: string[] = Array.isArray(body.keys) ? body.keys : [body.key];
    const urls: Record<string, string> = {};
    for (const key of keys.slice(0, 50)) {
      if (typeof key !== 'string' || key.includes('..')) throw new HttpError(400, 'مفتاح غير صالح.');
      const [root, sub] = key.split('/');
      if (root === 'chat') {
        const { data: member } = await caller.client.rpc('is_member', { p_conversation: sub });
        if (!member && caller.role !== 'admin') throw new HttpError(403, 'لا تملك صلاحية هذا الملف.');
      } else if (root === 'scans') {
        if (!isStaff) throw new HttpError(403, 'لا تملك صلاحية هذا الملف.');
      } else if (!['materials', 'covers', 'generated'].includes(root)) {
        throw new HttpError(400, 'مفتاح غير صالح.');
      }
      urls[key] = await presign('GET', key, 6 * 3600);
    }
    return json({ urls, url: urls[keys[0]] });
  }

  throw new HttpError(400, 'عملية غير معروفة.');
}));
