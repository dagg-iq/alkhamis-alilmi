// روابط رفع وتحميل مؤقتة للملفات بعد التحقق من الصلاحية (Supabase Storage أو R2/B2)
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { deleteObject, MAX_UPLOAD_BYTES, presign } from '../_shared/storage.ts';

type Kind = 'material' | 'chat' | 'scan' | 'cover';
const PREFIX: Record<Kind, string> = { material: 'materials', chat: 'chat', scan: 'scans', cover: 'covers' };
const ALLOWED_TYPES: Record<Kind, string[]> = {
  material: ['application/pdf'],
  chat: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  scan: ['image/jpeg', 'image/png'],
  cover: ['image/jpeg', 'image/png', 'image/webp'],
};
// ملفات المحتوى التي يحذفها المشرف بعد حذف صفها (ملزمة، أسئلة، غلاف خبر، أجزاء الفهرسة)
const DELETABLE_ROOTS = ['materials', 'covers', 'generated', 'scans'];

/** هل ما زال صف يشير إلى هذا الملف؟ (لا نحذف ملفاً مستعملاً مهما طُلب) */
async function referenced(key: string): Promise<boolean> {
  const counts = await Promise.all([
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('file_key', key),
    admin.from('question_sets').select('id', { count: 'exact', head: true }).or(`pdf_key.eq.${key},scan_keys.cs.{${key}}`),
    admin.from('posts').select('id', { count: 'exact', head: true }).eq('cover_key', key),
    admin.from('ingest_chunks').select('id', { count: 'exact', head: true }).eq('file_key', key),
  ]);
  // خطأ في الفحص = نعتبره مستعملاً (الأمان أولاً)
  return counts.some((r) => r.error || (r.count ?? 0) > 0);
}

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

  // حذف ملفات محتوى لم يعد يشير إليها أي صف (حتى لا يمتلئ التخزين بملفات محذوفة)
  if (body.action === 'delete') {
    if (!isStaff) throw new HttpError(403, 'الحذف للأدمن والمشرفين فقط.');
    const keys: unknown[] = Array.isArray(body.keys) ? body.keys : [body.key];
    let deleted = 0;
    for (const key of keys.slice(0, 100)) {
      if (typeof key !== 'string' || key.includes('..') || !/^[\w-]+\/[\w./-]+$/.test(key)) continue;
      if (!DELETABLE_ROOTS.includes(key.split('/')[0])) continue;
      if (await referenced(key)) continue;
      await deleteObject(key).then(() => { deleted++; }).catch((e) => console.error('delete', key, e));
    }
    return json({ ok: true, deleted });
  }

  throw new HttpError(400, 'عملية غير معروفة.');
}));
