// عامل الفهرسة على الخادم: يوقظه pg_cron كل دقيقة (أو زر «ابدأ الآن» في اللوحة).
// يقرأ أجزاء الكتب المنتظرة في الطابور بعدة مفاتيح معاً، الكتب بالترتيب، ثم يبني فهرس كل كتاب يكتمل.
// لا شيء يوقفه نهائياً: الجزء الفاشل يُعاد بعد دقائق (حتى ٥ مرات)، وانتهاء الحصة يؤجل العمل حتى تتجدد.
import { handler, HttpError, json } from '../_shared/cors.ts';
import { buildOutline, EmbedPendingError, embedOutline, readInline, storePages, type ReadPage } from '../_shared/ingest-core.ts';
import { GeminiQuotaError, GeminiTimeoutError, poolSlots, toBase64 } from '../_shared/gemini.ts';
import { deleteObject, getObject } from '../_shared/storage.ts';
import { admin, getCaller } from '../_shared/supabase.ts';

// حد الدالة ~١٥٠ ث. قراءة جزء (٤–٨ صفحات) تأخذ ٢٠–٩٠ ث؛ قطعها قبل الجواب يضيّع الطلب من حصة Google
// (تحسبه ولو لم نستلم الجواب) — كانت هذه أكبر خسارة: أجزاء تبدأ قبل نهاية الوقت بثوانٍ فتُقطع.
// لذلك لا يبدأ جزء إلا وأمامه READ_MS كاملة.
const HARD_MS = 140_000;
const READ_MS = 100_000;
const MAX_ATTEMPTS = 5;
// بعد هذه المحاولات تُكتب الصفحات التي لا يعيدها النموذج أبداً (فارغة، صورة فقط، غلاف) فارغةً ويكتمل الجزء،
// بدل أن يفشل الجزء ويبقى الكتاب «خطأ» بسبب صفحة بيضاء
const FILL_AFTER = 3;

/** صفحات هذا الجزء المحفوظة سابقاً (من محاولة سابقة تعذّر فيها التضمين): لا داعي لقراءتها ثانية */
async function savedPages(c: Chunk): Promise<ReadPage[]> {
  const { data } = await admin.from('document_pages').select('page, printed, headings, text')
    .eq('document_id', c.document_id).gte('page', c.from_page).lte('page', c.to_page);
  return ((data ?? []) as { page: number; printed: string | null; headings: ReadPage['headings'] | null; text: string | null }[])
    .map((r) => ({ page: r.page, printed: r.printed, headings: r.headings ?? [], text: r.text ?? '' }));
}

interface Chunk { id: string; document_id: string; from_page: number; to_page: number; total_pages: number; file_key: string; scanned: boolean; attempts: number }

async function release(c: Chunk, delayMs: number, error?: string, fail = false) {
  await admin.from('ingest_chunks').update({
    status: fail ? 'failed' : 'pending', lease_until: null, next_at: new Date(Date.now() + delayMs).toISOString(),
    ...(error ? { last_error: error.slice(0, 300) } : {}),
  }).eq('id', c.id);
}

/** كتاب انتهت كل أجزائه: نبني فهرسه ونخرجه من الطابور (والتالي يبدأ تلقائياً) */
async function finishDocuments(hard: number) {
  const { data: docs } = await admin.from('documents').select('*').not('queued_at', 'is', null).order('queued_at');
  for (const doc of (docs ?? []) as Record<string, any>[]) {
    if (Date.now() > hard - 100_000) return; // لا وقت لبناء فهرس الآن (المرة القادمة)
    const { data: left } = await admin.from('ingest_chunks').select('id, status, from_page, to_page').eq('document_id', doc.id).in('status', ['pending', 'running']);
    if ((left ?? []).length) continue;
    const { data: failed } = await admin.from('ingest_chunks').select('from_page, to_page, last_error').eq('document_id', doc.id).eq('status', 'failed');
    try {
      await buildOutline(doc);
      await embedOutline(doc).catch(() => {});
    } catch (e) {
      if (e instanceof GeminiQuotaError) return; // نكمل بعد تجدد الحصة
      console.error('outline', doc.id, String((e as Error).message ?? e).slice(0, 200));
    }
    const f = (failed ?? []) as { from_page: number; to_page: number; last_error: string | null }[];
    await admin.from('documents').update({
      queued_at: null,
      ...(f.length ? { ingest_status: 'error', ingest_error: `اكتملت الفهرسة عدا الصفحات ${f.map((x) => `${x.from_page}–${x.to_page}`).join('، ')} (تعذّرت قراءتها). اضغط «فهرسة» لإعادتها فقط.` } : {}),
    }).eq('id', doc.id);
    // الأجزاء المقروءة لم تعد لازمة في التخزين
    const { data: all } = await admin.from('ingest_chunks').select('id, file_key, status').eq('document_id', doc.id);
    for (const c of (all ?? []) as { id: string; file_key: string; status: string }[]) {
      if (c.status !== 'done') continue;
      await deleteObject(c.file_key).catch(() => {});
      await admin.from('ingest_chunks').delete().eq('id', c.id);
    }
  }
}

async function work() {
  const started = Date.now();
  const hard = started + HARD_MS;
  const { data: locked } = await admin.rpc('ingest_worker_lock', { p_seconds: 150 });
  if (locked === false) return { busy: true };
  let read = 0;
  let quota = false;
  try {
    // أولاً: كتب اكتملت قراءتها ← فهرسها
    await finishDocuments(hard);
    const lanes = Math.max(2, Math.min(8, poolSlots('admin').length));
    const docs = new Map<string, Record<string, any>>();
    const runLane = async (lane: number) => {
      await new Promise((r) => setTimeout(r, lane * 300));
      while (!quota && hard - Date.now() >= READ_MS) {
        const { data } = await admin.rpc('claim_ingest_chunks', { p_limit: 1, p_lease_seconds: 200 });
        const c = ((data ?? []) as Chunk[])[0];
        if (!c) return;
        try {
          if (!docs.has(c.document_id)) {
            const { data: d } = await admin.from('documents').select('*').eq('id', c.document_id).single();
            docs.set(c.document_id, d as Record<string, any>);
          }
          const doc = docs.get(c.document_id)!;
          const want = c.to_page - c.from_page + 1;
          // قُرئت كلها سابقاً وتعذّر التضمين فقط: نكمل التضمين بلا قراءة جديدة
          const saved = c.attempts > 1 ? await savedPages(c) : [];
          let pages: ReadPage[];
          if (saved.length >= want) {
            pages = saved;
          } else {
            let bytes: Uint8Array;
            try {
              bytes = await getObject(c.file_key);
            } catch (e) {
              // خادم التخزين لا يرد (انقطاع/مهلة اتصال): ليس خطأ قراءة — ننتظر ونعيد بلا احتساب محاولة
              await admin.from('ingest_chunks').update({ status: 'pending', lease_until: null, attempts: Math.max(0, c.attempts - 1), next_at: new Date(Date.now() + 3 * 60_000).toISOString(), last_error: `تعذّر الوصول للتخزين — يُعاد: ${String((e as Error).message ?? e).slice(0, 120)}` }).eq('id', c.id);
              continue;
            }
            const b64 = toBase64(bytes);
            pages = await readInline(b64, c.from_page, c.to_page, hard - 5_000, lane, c.scanned);
            read += pages.length;
            // صفحات لا يعيدها النموذج بعد عدة محاولات (بيضاء/صورة): نكمّلها من المحفوظ أو فارغة
            if (pages.length > 0 && pages.length < want && c.attempts >= FILL_AFTER) {
              const have = new Map([...saved, ...pages].map((p) => [p.page, p]));
              for (let n = c.from_page; n <= c.to_page; n++) if (!have.has(n)) have.set(n, { page: n, printed: null, headings: [], text: '' });
              pages = [...have.values()].sort((a, b) => a.page - b.page);
            }
          }
          if (pages.length) await storePages(doc, pages, c.total_pages);
          if (pages.length >= want) {
            await admin.from('ingest_chunks').update({ status: 'done', lease_until: null, last_error: null }).eq('id', c.id);
          } else if (c.attempts >= MAX_ATTEMPTS) {
            await release(c, 0, `قُرئت ${pages.length} من ${want} صفحات بعد ${c.attempts} محاولات`, true);
          } else {
            await release(c, 2 * 60_000, `قُرئت ${pages.length} من ${want} صفحات — يُعاد`);
          }
        } catch (e) {
          if (e instanceof EmbedPendingError) {
            // حد التضمين في الدقيقة: الصفحات محفوظة، نعيد التضمين بعد دقيقة ونصف (لا تُحسب محاولة، لا يتوقف العمال)
            await admin.from('ingest_chunks').update({ status: 'pending', lease_until: null, attempts: Math.max(2, c.attempts), next_at: new Date(Date.now() + 90_000).toISOString(), last_error: 'انتظار حصة التضمين (دقيقة)' }).eq('id', c.id);
            continue;
          }
          if (e instanceof GeminiQuotaError) {
            // انتهت حصة كل المفاتيح: نعيد الجزء ونتوقف حتى تتجدد (لا تُحسب محاولة)
            quota = true;
            const later = new Date(Date.now() + 10 * 60_000).toISOString();
            await admin.from('ingest_chunks').update({ status: 'pending', lease_until: null, attempts: Math.max(0, c.attempts - 1), next_at: later, last_error: 'انتظار تجدد حصة Gemini' }).eq('id', c.id);
            // كل الأجزاء المنتظرة تنتظر معاً (كانت تُؤجَّل واحداً كل دقيقة فتظهر «في الطابور» وكأن شيئاً لا يحدث)
            await admin.from('ingest_chunks').update({ next_at: later, last_error: 'انتظار تجدد حصة Gemini' }).eq('status', 'pending').lt('next_at', later);
            return;
          }
          const msg = e instanceof GeminiTimeoutError ? 'انتهت المهلة (جواب بطيء)' : String((e as Error).message ?? e);
          if (c.attempts >= MAX_ATTEMPTS) await release(c, 0, msg, true);
          else await release(c, Math.min(30, 2 ** c.attempts) * 60_000, msg);
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, (_, i) => runLane(i)));
    if (!quota) await finishDocuments(hard);
  } finally {
    await admin.rpc('ingest_worker_unlock');
  }
  return { read, quota, ms: Date.now() - started };
}

// المهمة تعمل في الخلفية بعد الرد فوراً (pg_net لا ينتظر أكثر من ثانيتين)
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(handler(async (req) => {
  // من pg_cron (بسر الإشعارات) أو من مشرف في اللوحة («ابدأ الآن»)
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!(secret && req.headers.get('x-webhook-secret') === secret)) {
    try { await getCaller(req, { staff: true }); } catch { throw new HttpError(401, 'غير مصرح'); }
  }
  const task = work().catch((e) => { console.error('ingest-worker', e); return { error: String((e as Error).message ?? e) }; });
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
    return json({ started: true });
  }
  return json(await task);
}));
