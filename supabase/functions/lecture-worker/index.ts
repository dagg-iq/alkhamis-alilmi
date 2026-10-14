// عامل فهرسة المحاضرات على الخادم: يوقظه pg_cron كل دقيقة (طابور migration ٣٣).
// كل مسار يحجز محاضرة ويفهرس جزءها التالي (١٠ دقائق) بنماذج Flash-Lite، ثم يحجز التالية ما دام الوقت يكفي.
// الخطأ يُعاد بعد دقائق (حتى ٥ مرات)، وانتهاء حصة كل النماذج يؤجل الطابور كله حتى تتجدد.
import { handler, HttpError, json } from '../_shared/cors.ts';
import { GeminiQuotaError, GeminiTimeoutError, poolSlots } from '../_shared/gemini.ts';
import { EmbedWaitError, indexLectureSegment } from '../_shared/lecture-index.ts';
import { admin, getCaller } from '../_shared/supabase.ts';

const HARD_MS = 140_000;
// جزء فيديو ١٠ دقائق بدقة منخفضة يأخذ مع Flash-Lite ~٢٠–٦٠ ث؛ لا نبدأ جزءاً إلا ومعه هذا الوقت كاملاً
const SEGMENT_MS = 80_000;
const MAX_ATTEMPTS = 5;

interface Lecture { id: string; title: string; index_segment: number; index_attempts: number }

async function work() {
  const started = Date.now();
  const hard = started + HARD_MS;
  const { data: locked } = await admin.rpc('lecture_worker_lock', { p_seconds: 150 });
  if (locked === false) return { busy: true };
  let segments = 0;
  let quota = false;
  try {
    const lanes = Math.max(2, Math.min(6, poolSlots('admin').length));
    const runLane = async (lane: number) => {
      await new Promise((r) => setTimeout(r, lane * 400));
      while (!quota && hard - Date.now() >= SEGMENT_MS) {
        const { data } = await admin.rpc('claim_lecture', { p_lease_seconds: 170 });
        const l = ((data ?? []) as Lecture[])[0];
        if (!l) return;
        try {
          const r = await indexLectureSegment(l.id, l.index_segment, { deadline: hard - 3_000, lane });
          segments++;
          await admin.from('lectures').update(r.done
            ? { queued_at: null, index_segment: 0, index_attempts: 0, index_lease_until: null }
            : { index_segment: r.next ?? l.index_segment + 1, index_attempts: 0, index_lease_until: null, index_next_at: new Date().toISOString() }).eq('id', l.id);
        } catch (e) {
          if (e instanceof EmbedWaitError) {
            // حد التضمين في الدقيقة: نعيد الجزء نفسه بعد دقيقة ونصف (لا يُحسب محاولة)
            await admin.from('lectures').update({ index_lease_until: null, index_next_at: new Date(Date.now() + 90_000).toISOString(), index_error: 'انتظار حصة التضمين (دقيقة)' }).eq('id', l.id);
            continue;
          }
          if (e instanceof GeminiQuotaError) {
            // انتهت حصة كل النماذج: الطابور كله ينتظر ١٠ دقائق (لا تُحسب محاولة)
            quota = true;
            const later = new Date(Date.now() + 10 * 60_000).toISOString();
            await admin.from('lectures').update({ index_lease_until: null, index_next_at: later, index_error: 'انتظار تجدد حصة Gemini' }).eq('id', l.id);
            await admin.from('lectures').update({ index_next_at: later }).not('queued_at', 'is', null).lt('index_next_at', later);
            return;
          }
          const msg = e instanceof GeminiTimeoutError ? 'انتهت المهلة (جواب بطيء)' : String((e as Error).message ?? e).slice(0, 300);
          const attempts = l.index_attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await admin.from('lectures').update({ queued_at: null, index_lease_until: null, index_attempts: 0, index_segment: 0, index_status: 'error', index_error: `الجزء ${l.index_segment + 1}: ${msg}` }).eq('id', l.id);
          } else {
            await admin.from('lectures').update({ index_attempts: attempts, index_lease_until: null, index_next_at: new Date(Date.now() + Math.min(30, 2 ** attempts) * 60_000).toISOString(), index_error: `يُعاد: ${msg}` }).eq('id', l.id);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, (_, i) => runLane(i)));
  } finally {
    await admin.rpc('lecture_worker_unlock');
  }
  return { segments, quota, ms: Date.now() - started };
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(handler(async (req) => {
  // من pg_cron (بسر الإشعارات) أو من مشرف في اللوحة
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!(secret && req.headers.get('x-webhook-secret') === secret)) {
    try { await getCaller(req, { staff: true }); } catch { throw new HttpError(401, 'غير مصرح'); }
  }
  const task = work().catch((e) => { console.error('lecture-worker', e); return { error: String((e as Error).message ?? e) }; });
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(task);
    return json({ started: true });
  }
  return json(await task);
}));
