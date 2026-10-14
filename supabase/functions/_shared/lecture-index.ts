// فهرسة محاضرة يوتيوب بالدقيقة — جزء ١٠ دقائق في كل استدعاء.
// مشتركة بين زر «فهرسة» في مساعد المحتوى (content-ai) وعامل طابور المحاضرات على الخادم (lecture-worker).
// النماذج: Flash-Lite أولاً (سريع، وحصته ~٥٠٠ يومياً لكل مفتاح بدل ٢٠) ثم القوية احتياطاً.
import { HttpError } from './cors.ts';
import { admin } from './supabase.ts';
import { embed, GeminiQuotaError, generate, parseJson, READ_MODELS } from './gemini.ts';

export const SEGMENT = 10 * 60;
/** نماذج فهرسة المحاضرات: الخفيفة أولاً */
export const LECTURE_MODELS = READ_MODELS;

const YT = 'https://www.googleapis.com/youtube/v3';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ar,en;q=0.8', Cookie: 'CONSENT=YES+cb; SOCS=CAI' };

/** 75 أو "1:15" أو "01:01:15" ← ثوانٍ */
export function toSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

export function isoDuration(s: string): number {
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0) : 0;
}

export async function ytApi(path: string, params: Record<string, string>) {
  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return null;
  const res = await fetch(`${YT}/${path}?${new URLSearchParams({ ...params, key })}`);
  if (!res.ok) throw new HttpError(502, `YouTube API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

export async function videoDuration(id: string): Promise<number | null> {
  if (Deno.env.get('YOUTUBE_API_KEY')) {
    const d = await ytApi('videos', { part: 'contentDetails', id });
    return d.items?.[0] ? isoDuration(d.items[0].contentDetails.duration) : null;
  }
  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: UA })).text();
  const s = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
  return s ? Number(s) : null;
}

/** حد التضمين في الدقيقة (لا حصة النماذج): يُعاد الجزء بعد قليل */
export class EmbedWaitError extends Error {}

async function embedOrWait(texts: string[]) {
  try {
    return await embed(texts, 'RETRIEVAL_DOCUMENT', 'admin');
  } catch (e) {
    if (e instanceof GeminiQuotaError) throw new EmbedWaitError('انتظار حصة التضمين');
    throw e;
  }
}

export interface SegmentResult { done: boolean; segment: number; next: number | null; segments: number | null; topics: number }

/**
 * يفهرس الجزء رقم segment من المحاضرة (الجزء ٠ يمسح الفهرس القديم أولاً).
 * deadline/lane لعامل الخادم: لا يبدأ طلباً بلا وقت كافٍ، ولا يتزاحم العمال على مفتاح واحد.
 */
export async function indexLectureSegment(lectureId: string, segment: number, opts: { deadline?: number; lane?: number } = {}): Promise<SegmentResult> {
  const { data: lec } = await admin.from('lectures')
    .select('id, title, youtube_id, duration_sec, chapter_id, chapters(title, books(subject_id))').eq('id', lectureId).single();
  if (!lec) throw new HttpError(404, 'المحاضرة غير موجودة.');
  let duration = lec.duration_sec as number | null;
  if (!duration) {
    duration = await videoDuration(lec.youtube_id).catch(() => null);
    if (duration) await admin.from('lectures').update({ duration_sec: duration }).eq('id', lec.id);
  }
  const from = segment * SEGMENT;
  const to = from + SEGMENT;
  const subjectId = (lec.chapters as unknown as { books: { subject_id: string } })?.books?.subject_id ?? null;
  if (segment === 0) {
    await admin.from('lecture_topics').delete().eq('lecture_id', lec.id);
    await admin.from('content_chunks').delete().eq('source_type', 'lecture').eq('source_id', lec.id);
    await admin.from('lectures').update({ index_status: 'running', index_error: null }).eq('id', lec.id);
  }
  const finish = async (): Promise<SegmentResult> => {
    await admin.from('lectures').update({ index_status: 'done', index_error: null, indexed_at: new Date().toISOString() }).eq('id', lec.id);
    return { done: true, segment, next: null, segments: duration ? Math.ceil(duration / SEGMENT) : segment + 1, topics: 0 };
  };
  if (duration && from >= duration) return await finish();

  // سياق الجزء السابق: حتى لا يُعدّ استمرار الشرح عند بداية الجزء موضوعاً جديداً («إكمال…»)
  let previous = '';
  if (segment > 0) {
    const { data: prev } = await admin.from('lecture_topics').select('start_sec, title, summary')
      .eq('lecture_id', lec.id).order('start_sec', { ascending: false }).limit(3);
    previous = (prev ?? []).reverse().map((t) => `- ${t.start_sec}s: ${t.title} — ${t.summary ?? ''}`).join('\n');
  }

  let raw: string;
  try {
    raw = await generate(LECTURE_MODELS, [{
      role: 'user',
      parts: [
        {
          file_data: { file_uri: `https://www.youtube.com/watch?v=${lec.youtube_id}` },
          video_metadata: { start_offset: `${from}s`, end_offset: `${duration ? Math.min(to, duration) : to}s`, fps: 0.5 },
        } as never,
        {
          text: `هذا جزء من محاضرة «${lec.title}» لطلاب الخامس العلمي في العراق، من الثانية ${from} إلى ${to}.
${previous ? `آخر المواضيع قبل هذا الجزء (من الأجزاء السابقة):\n${previous}\nإذا كان أول هذا الجزء استمراراً لآخر موضوع منها فلا تجعله موضوعاً جديداً: ضع شرحه في "continuation" فقط، وابدأ "topics" من أول موضوع جديد فعلاً.\n` : ''}قسّم هذا الجزء إلى مواضيع حسب ما يشرحه الأستاذ فعلاً (موضوع لكل فكرة أو مثال أو سؤال مستقل). أعد JSON بالشكل:
{"topics": [{"start": وقت بداية الموضوع بالثواني من بداية الفيديو كاملاً (ليس من بداية الجزء),
  "title": "عنوان قصير", "summary": "جملة أو جملتان تشرحان ما يقوله",
  "details": "الشرح بتفصيل كملاحظات طالب: التعاريف والقوانين ($LaTeX$) والأمثلة والتعليلات كما وردت"}],
 "continuation": "شرح بقية الموضوع السابق في أول الجزء (بنفس أسلوب details) أو null",
 "ended": true إذا انتهى الفيديو داخل هذا الجزء وإلا false}
لا تخترع ما لم يُقل. تجاهل المقدمات والإعلانات وطلبات الاشتراك.`,
        },
      ],
    }], {
      pool: 'admin', json: true, temperature: 0.1, maxOutputTokens: 32768, thinking: 'minimal',
      extraConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' },
      ...(opts.deadline ? { deadline: opts.deadline, minTimeMs: 60_000 } : {}),
      ...(opts.lane !== undefined ? { lane: opts.lane } : {}),
    });
  } catch (e) {
    // بلا مدة معروفة: جزء يبدأ بعد نهاية الفيديو يعطي خطأ ← انتهت الفهرسة
    if (!duration && segment > 0 && !(e instanceof GeminiQuotaError)) return await finish();
    throw e;
  }
  // إعادة جزء فشل في منتصفه (بعد حفظ بعضه): نمسح ما حُفظ منه أولاً حتى لا يتكرر
  if (segment > 0) {
    await admin.from('lecture_topics').delete().eq('lecture_id', lec.id).gte('sort', segment * 1000).lt('sort', (segment + 1) * 1000);
    await admin.from('content_chunks').delete().eq('source_type', 'lecture').eq('source_id', lec.id).gte('start_sec', from).lt('start_sec', to);
  }
  const parsed = parseJson<unknown>(raw);
  const obj = (Array.isArray(parsed) && parsed.length === 1 && (parsed[0] as { topics?: unknown }).topics ? parsed[0] : parsed) as
    { topics?: unknown[]; ended?: boolean; continuation?: string | null } | unknown[];
  const continuation = !Array.isArray(obj) && typeof obj.continuation === 'string' ? obj.continuation.trim() : '';
  const list = (Array.isArray(obj) ? obj : obj.topics ?? []) as { start: number | string; title: string; summary?: string; details?: string }[];
  const ended = !Array.isArray(obj) && obj.ended === true;
  const topics = list
    .map((t) => ({ ...t, start: toSeconds(t?.start) }))
    .filter((t) => t.title && t.start !== null)
    .map((t) => ({ ...t, start: Math.round(t.start!) }));
  // أحياناً يعيد النموذج الوقت من بداية الجزء لا من بداية الفيديو
  if (segment > 0 && topics.length && topics.every((t) => t.start < SEGMENT)) for (const t of topics) t.start += from;
  for (const t of topics) t.start = Math.max(from, Math.min(t.start, duration ?? to));

  // استمرار الموضوع السابق: يُضاف للبحث (يجده المساعد) بلا موضوع جديد في القائمة
  if (continuation.length > 40) {
    const { data: last } = await admin.from('lecture_topics').select('title').eq('lecture_id', lec.id).order('start_sec', { ascending: false }).limit(1).maybeSingle();
    const text = `${lec.title} — ${last?.title ?? 'تكملة'} (تكملة)\n${continuation}`.slice(0, 3000);
    const [v] = await embedOrWait([text]);
    const { error } = await admin.from('content_chunks').insert({
      source_type: 'lecture', source_id: lec.id, subject_id: subjectId, chapter_id: lec.chapter_id, start_sec: from, content: text, embedding: v,
    });
    if (error) throw new Error(error.message);
  }
  // احتياط: موضوع في أول ثوانٍ من الجزء عنوانه «إكمال/تكملة» = استمرار، لا نكرره في القائمة
  if (segment > 0 && topics.length > 1 && topics[0].start - from < 45 && /^(إكمال|اكمال|تكملة|متابعة|استكمال|يكمل|يُكمل)/.test(String(topics[0].title))) {
    topics[1].details = `${topics[0].details ?? ''}\n${topics[1].details ?? ''}`;
    topics.shift();
  }

  if (topics.length) {
    const { error: e1 } = await admin.from('lecture_topics').insert(topics.map((t, k) => ({
      lecture_id: lec.id, start_sec: t.start, title: String(t.title).slice(0, 200), summary: t.summary?.slice(0, 600) ?? null, sort: segment * 1000 + k,
    })));
    if (e1) throw new Error(e1.message);
    const texts = topics.map((t) => `${lec.title} — ${t.title}\n${t.summary ?? ''}\n${t.details ?? ''}`.slice(0, 3000));
    const vectors = await embedOrWait(texts);
    const { error: e2 } = await admin.from('content_chunks').insert(topics.map((t, k) => ({
      source_type: 'lecture', source_id: lec.id, subject_id: subjectId, chapter_id: lec.chapter_id,
      start_sec: t.start, content: texts[k], embedding: vectors[k],
    })));
    if (e2) throw new Error(e2.message);
  }
  // ننتهي عند: نهاية المدة المعروفة، أو قول النموذج إن الفيديو انتهى، أو جزء بلا مواضيع (بلا مدة)، أو حد أمان ساعتين
  const done = (duration ? to >= duration : ended || (!topics.length && !continuation)) || segment >= 11; // ١٢ جزءاً = ساعتان
  if (done) await admin.from('lectures').update({ index_status: 'done', index_error: null, indexed_at: new Date().toISOString() }).eq('id', lec.id);
  return { done, segment, next: done ? null : segment + 1, segments: duration ? Math.ceil(duration / SEGMENT) : null, topics: topics.length };
}

