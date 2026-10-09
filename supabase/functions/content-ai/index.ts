// مساعد المحتوى (لوحة التحكم): سحب قوائم يوتيوب، تصنيف المحاضرات والملازم بالذكاء الاصطناعي، وفهرسة المحاضرات بالدقيقة.
// يستخدم مفتاح لوحة التحكم (GEMINI_ADMIN_API_KEY) حتى لا يأكل من حصة الطلاب.
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { ADMIN_VAR, DAILY_PER_MODEL, embed, FALLBACK_MODELS, generate, GeminiQuotaError, MAIN_MODELS, modelChain, parseJson, STUDENT_VARS, toBase64 } from '../_shared/gemini.ts';
import { getObject } from '../_shared/storage.ts';

interface Video { youtube_id: string; title: string; duration_sec: number | null; channel?: string | null }

const YT = 'https://www.googleapis.com/youtube/v3';
const SEGMENT = 10 * 60; // فهرسة الفيديو على أجزاء (١٠ دقائق) حتى لا تتجاوز الدالة وقتها
// كوكي الموافقة يتجاوز صفحة «قبل أن تتابع» التي تظهر للخوادم الأوروبية
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ar,en;q=0.8', Cookie: 'CONSENT=YES+cb; SOCS=CAI' };

function videoIdOf(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}

/** 75 أو "1:15" أو "01:01:15" ← ثوانٍ */
function toSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

function isoDuration(s: string): number {
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0) : 0;
}

// ---------------------------------------------------------------- يوتيوب
async function ytApi(path: string, params: Record<string, string>) {
  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return null;
  const res = await fetch(`${YT}/${path}?${new URLSearchParams({ ...params, key })}`);
  if (!res.ok) throw new HttpError(502, `YouTube API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

/** كل فيديوهات قائمة تشغيل (أو رفع قناة) */
async function playlistVideos(listId: string): Promise<Video[]> {
  const out: Video[] = [];
  if (Deno.env.get('YOUTUBE_API_KEY')) {
    let page = '';
    for (let i = 0; i < 10; i++) {
      const d = await ytApi('playlistItems', { part: 'snippet,contentDetails', maxResults: '50', playlistId: listId, ...(page ? { pageToken: page } : {}) });
      for (const it of d.items ?? []) {
        if (it.snippet?.title === 'Private video' || it.snippet?.title === 'Deleted video') continue;
        out.push({ youtube_id: it.contentDetails.videoId, title: it.snippet.title, duration_sec: null, channel: it.snippet.videoOwnerChannelTitle ?? null });
      }
      if (!d.nextPageToken) break;
      page = d.nextPageToken;
    }
    // المدد
    for (let i = 0; i < out.length; i += 50) {
      const d = await ytApi('videos', { part: 'contentDetails', id: out.slice(i, i + 50).map((v) => v.youtube_id).join(',') });
      const dur = new Map<string, number>((d.items ?? []).map((v: { id: string; contentDetails: { duration: string } }) => [v.id, isoDuration(v.contentDetails.duration)]));
      for (const v of out.slice(i, i + 50)) v.duration_sec = dur.get(v.youtube_id) ?? null;
    }
    return out;
  }
  // بلا مفتاح: صفحة القائمة نفسها (أول ١٠٠ فيديو) ثم خلاصة RSS احتياطاً (آخر ١٥ فيديو)
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${listId}&hl=ar`, { headers: UA });
    const html = await res.text();
    const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s) ?? html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
    if (m) {
      const channel = (html.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/) ?? [])[1] ?? null;
      walkPlaylist(JSON.parse(m[1]), out, channel);
    }
  } catch (e) {
    console.error('playlist page', e);
  }
  if (!out.length) out.push(...await rssVideos(`playlist_id=${listId}`));
  return out;
}

/** يقرأ الفيديوهات من بيانات صفحة يوتيوب (الشكل القديم playlistVideoRenderer والجديد lockupViewModel) */
function walkPlaylist(o: unknown, out: Video[], channel: string | null) {
  if (!o || typeof o !== 'object') return;
  const obj = o as Record<string, unknown>;
  const r = obj.playlistVideoRenderer as Record<string, unknown> | undefined;
  if (r?.videoId) {
    const title = ((r.title as { runs?: { text: string }[] })?.runs ?? []).map((x) => x.text).join('');
    out.push({ youtube_id: r.videoId as string, title, duration_sec: Number(r.lengthSeconds) || null, channel });
    return;
  }
  const lv = obj.lockupViewModel as Record<string, unknown> | undefined;
  if (lv?.contentId && lv.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
    const json = JSON.stringify(lv);
    const title = json.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
    const dur = json.match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/)?.[1];
    out.push({ youtube_id: lv.contentId as string, title: JSON.parse(`"${title}"`), duration_sec: dur ? toSeconds(dur) : null, channel });
    return;
  }
  for (const v of Object.values(obj)) walkPlaylist(v, out, channel);
}

/** خلاصة RSS الرسمية من يوتيوب (تعمل غالباً حتى عندما تُمنع الصفحة) */
async function rssVideos(query: string): Promise<Video[]> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?${query}`, { headers: UA });
  if (!res.ok) return [];
  const xml = await res.text();
  const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((e) => ({
    youtube_id: e[1].match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1] ?? '',
    title: decode(e[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    duration_sec: null,
    channel: decode(e[1].match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] ?? '') || null,
  })).filter((v) => v.youtube_id).reverse(); // الخلاصة من الأحدث، والقائمة من الأقدم
}

/** قائمة الرفع لقناة (@handle أو /channel/ID) */
async function channelUploads(url: string): Promise<string> {
  const handle = (() => { const h = url.match(/youtube\.com\/@([^/?#\s]+)/)?.[1]; try { return h ? decodeURIComponent(h) : undefined; } catch { return h; } })();
  const id = url.match(/\/channel\/(UC[\w-]+)/)?.[1];
  if (Deno.env.get('YOUTUBE_API_KEY')) {
    const d = await ytApi('channels', { part: 'contentDetails', ...(id ? { id } : { forHandle: `@${handle}` }) });
    const up = d.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!up) throw new HttpError(404, 'لم أجد القناة.');
    return up;
  }
  let cid = id;
  if (!cid) {
    const html = await (await fetch(`https://www.youtube.com/@${handle}`, { headers: UA })).text();
    cid = html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ?? html.match(/channel\/(UC[\w-]{22})/)?.[1];
  }
  if (!cid) throw new HttpError(404, 'لم أجد القناة. الصق رابط قائمة تشغيل بدلاً منها.');
  return `UU${cid.slice(2)}`; // قائمة «كل الفيديوهات» للقناة
}

async function singleVideo(id: string): Promise<Video> {
  let title = id;
  let channel: string | null = null;
  let duration: number | null = null;
  const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  if (o.ok) {
    const d = await o.json();
    title = d.title;
    channel = d.author_name;
  }
  duration = await videoDuration(id).catch(() => null);
  return { youtube_id: id, title, duration_sec: duration, channel };
}

async function videoDuration(id: string): Promise<number | null> {
  if (Deno.env.get('YOUTUBE_API_KEY')) {
    const d = await ytApi('videos', { part: 'contentDetails', id });
    return d.items?.[0] ? isoDuration(d.items[0].contentDetails.duration) : null;
  }
  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: UA })).text();
  const s = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
  return s ? Number(s) : null;
}

// ---------------------------------------------------------------- سياق المنهج للتصنيف
async function curriculum() {
  const [{ data: subjects }, { data: books }, { data: chapters }, { data: teachers }] = await Promise.all([
    admin.from('subjects').select('id, name').order('sort'),
    admin.from('books').select('id, subject_id, name').order('sort'),
    admin.from('chapters').select('id, book_id, number, title').order('sort').order('number'),
    admin.from('teachers').select('id, name, subject_id'),
  ]);
  const bookSubject = new Map((books ?? []).map((b) => [b.id, b.subject_id]));
  const lines = (subjects ?? []).map((s) => {
    const chs = (chapters ?? []).filter((c) => bookSubject.get(c.book_id) === s.id);
    const ch = chs.length ? chs.map((c) => `    - chapter_id=${c.id} | الفصل ${c.number}: ${c.title}`).join('\n') : '    (لا فصول بعد)';
    return `- subject_id=${s.id} | ${s.name}\n${ch}`;
  });
  const t = (teachers ?? []).map((x) => `- teacher_id=${x.id} | ${x.name}`).join('\n') || '(لا أساتذة بعد)';
  return { text: `المواد وفصولها:\n${lines.join('\n')}\n\nالأساتذة:\n${t}`, subjects: subjects ?? [], chapters: chapters ?? [], teachers: teachers ?? [] };
}

async function ai(contents: Parameters<typeof generate>[1], maxOutputTokens = 16384) {
  const settings = await getSetting<{ model?: string }>('ai');
  return await generate(modelChain(settings.model, MAIN_MODELS), contents, { pool: 'admin', json: true, temperature: 0.1, maxOutputTokens, thinking: 'low' });
}

Deno.serve(handler(async (req) => {
  await getCaller(req, { staff: true });
  const body = await req.json();

  try {
    // ١) روابط ← فيديوهات (قائمة تشغيل، قناة، أو روابط مفردة)
    if (body.action === 'videos') {
      const links = String(body.links ?? '').split(/\s+/).map((l) => l.trim()).filter(Boolean);
      if (!links.length) throw new HttpError(400, 'الصق رابطاً واحداً على الأقل.');
      const videos: Video[] = [];
      for (const link of links.slice(0, 20)) {
        const list = link.match(/[?&]list=([\w-]+)/)?.[1];
        if (list) videos.push(...await playlistVideos(list));
        else if (/youtube\.com\/(@|channel\/)/.test(link)) videos.push(...await playlistVideos(await channelUploads(link)));
        else {
          const id = videoIdOf(link);
          if (id) videos.push(await singleVideo(id));
        }
      }
      if (!videos.length) {
        throw new HttpError(422, Deno.env.get('YOUTUBE_API_KEY')
          ? 'لم أجد فيديوهات. تأكد أن القائمة «عامة» أو «غير مدرجة» وليست خاصة.'
          : 'يوتيوب منع قراءة القائمة من الخادم. أضف مفتاح YouTube المجاني (الخطوة ١٢-ب في دليل الإعداد) ثم أعد المحاولة. مؤقتاً: الصق روابط الفيديوهات نفسها، كل رابط في سطر.');
      }
      const seen = new Set<string>();
      const unique = videos.filter((v) => (seen.has(v.youtube_id) ? false : (seen.add(v.youtube_id), true)));
      const { data: existing } = await admin.from('lectures').select('youtube_id').in('youtube_id', unique.map((v) => v.youtube_id).concat(['-']));
      const have = new Set((existing ?? []).map((e) => e.youtube_id));
      return json({ videos: unique.map((v) => ({ ...v, exists: have.has(v.youtube_id) })) });
    }

    // ٢) تصنيف الفيديوهات: المادة، الفصل، الأستاذ، الترتيب، وعنوان مرتب
    if (body.action === 'classify_lectures') {
      const videos = (body.videos ?? []) as Video[];
      if (!videos.length) return json({ items: [] });
      const cur = await curriculum();
      const hint = [body.subjectId ? `كل الفيديوهات من مادة subject_id=${body.subjectId}` : '', body.teacherId ? `كلها للأستاذ teacher_id=${body.teacherId}` : ''].filter(Boolean).join('. ');
      const items: unknown[] = [];
      for (let i = 0; i < videos.length; i += 60) {
        const batch = videos.slice(i, i + 60);
        const raw = await ai([{
          role: 'user',
          parts: [{
            text: `أنت تنظم محاضرات يوتيوب لمنهج الصف الخامس الإعدادي العلمي في العراق.
${cur.text}

${hint}
الفيديوهات (بالترتيب):
${batch.map((v, k) => `${k + 1}. id=${v.youtube_id} | ${v.title}${v.channel ? ` | القناة: ${v.channel}` : ''}`).join('\n')}

لكل فيديو أعد كائناً في مصفوفة JSON بالترتيب نفسه:
{"youtube_id": "...", "subject_id": "معرف المادة أو null", "chapter_id": "معرف الفصل الموجود أو null",
 "new_chapter": {"number": رقم, "title": "عنوان الفصل"} أو null (فقط إذا لم يوجد فصل مناسب في القائمة),
 "teacher_id": "معرف الأستاذ الموجود أو null", "new_teacher": "اسم الأستاذ إن عرفته من العنوان أو القناة ولم يكن في القائمة، وإلا null",
 "lecture_number": رقم المحاضرة داخل الفصل إن ظهر في العنوان وإلا null,
 "title": "عنوان قصير مرتب بالعربية (مثل: المحاضرة ٣ — قانون كولوم)"، احذف أسماء القنوات والإعلانات والرموز,
 "skip": true إذا كان الفيديو ليس محاضرة دراسية (إعلان، بث مباشر عام، مقدمة القناة)}
لا تخترع معرفات. استخدم المعرفات كما هي فقط.`,
          }],
        }]);
        const p = parseJson<unknown>(raw) as unknown[] | Record<string, unknown>;
        items.push(...(Array.isArray(p) ? p : ((p.items ?? p.videos ?? Object.values(p).find(Array.isArray) ?? []) as unknown[])));
      }
      return json({ items });
    }

    // ٣) فهرسة محاضرة بالدقيقة (جزء ١٠ دقائق في كل استدعاء، بدقة منخفضة: الشرح في الصوت والسبورة تكفيها صورة كل ثانيتين)
    if (body.action === 'index_lecture') {
      const { data: lec } = await admin.from('lectures')
        .select('id, title, youtube_id, duration_sec, chapter_id, chapters(title, books(subject_id))').eq('id', body.lectureId).single();
      if (!lec) throw new HttpError(404, 'المحاضرة غير موجودة.');
      let duration = lec.duration_sec as number | null;
      if (!duration) {
        duration = await videoDuration(lec.youtube_id).catch(() => null);
        if (duration) await admin.from('lectures').update({ duration_sec: duration }).eq('id', lec.id);
      }
      const segment = Number(body.segment ?? 0);
      const from = segment * SEGMENT;
      const to = from + SEGMENT;
      const subjectId = (lec.chapters as unknown as { books: { subject_id: string } })?.books?.subject_id ?? null;
      if (segment === 0) {
        await admin.from('lecture_topics').delete().eq('lecture_id', lec.id);
        await admin.from('content_chunks').delete().eq('source_type', 'lecture').eq('source_id', lec.id);
        await admin.from('lectures').update({ index_status: 'running', index_error: null }).eq('id', lec.id);
      }
      const finish = async () => {
        await admin.from('lectures').update({ index_status: 'done', index_error: null, indexed_at: new Date().toISOString() }).eq('id', lec.id);
        return json({ done: true, segment, next: null, segments: duration ? Math.ceil(duration / SEGMENT) : segment + 1, topics: 0 });
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
        raw = await generate(modelChain((await getSetting<{ model?: string }>('ai')).model, MAIN_MODELS), [{
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
        }], { pool: 'admin', json: true, temperature: 0.1, maxOutputTokens: 32768, thinking: 'low', extraConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' } });
      } catch (e) {
        // بلا مدة معروفة: جزء يبدأ بعد نهاية الفيديو يعطي خطأ ← انتهت الفهرسة
        if (!duration && segment > 0 && !(e instanceof GeminiQuotaError)) return await finish();
        throw e;
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
        const [v] = await embed([text], 'RETRIEVAL_DOCUMENT', 'admin');
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
        const vectors = await embed(texts, 'RETRIEVAL_DOCUMENT', 'admin');
        const { error: e2 } = await admin.from('content_chunks').insert(topics.map((t, k) => ({
          source_type: 'lecture', source_id: lec.id, subject_id: subjectId, chapter_id: lec.chapter_id,
          start_sec: t.start, content: texts[k], embedding: vectors[k],
        })));
        if (e2) throw new Error(e2.message);
      }
      // ننتهي عند: نهاية المدة المعروفة، أو قول النموذج إن الفيديو انتهى، أو جزء بلا مواضيع (بلا مدة)، أو حد أمان ساعتين
      const done = (duration ? to >= duration : ended || (!topics.length && !continuation)) || segment >= 11; // ١٢ جزءاً = ساعتان
      if (done) await admin.from('lectures').update({ index_status: 'done', index_error: null, indexed_at: new Date().toISOString() }).eq('id', lec.id);
      return json({ done, segment, next: done ? null : segment + 1, segments: duration ? Math.ceil(duration / SEGMENT) : null, topics: topics.length });
    }

    // ٤) تصنيف ملف PDF من أول صفحاته: المادة، الأستاذ، النوع، الفصل، العنوان، وهل هو مصوّر
    if (body.action === 'classify_document') {
      const key = String(body.key ?? '');
      if (!key.startsWith('materials/')) throw new HttpError(400, 'مفتاح غير صالح.');
      const bytes = await getObject(key);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      const pages = src.getPageCount();
      const first = await PDFDocument.create();
      const copy = await first.copyPages(src, [...Array(Math.min(4, pages)).keys()]);
      copy.forEach((p) => first.addPage(p));
      const sample = await first.save();
      const cur = await curriculum();
      const raw = await ai([{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: toBase64(sample) } },
          {
            text: `هذه أول صفحات ملف PDF لطلاب الخامس الإعدادي العلمي في العراق (اسم الملف: ${String(body.name ?? '')}).
${cur.text}

أعد JSON واحداً:
{"subject_id": "معرف المادة", "kind": "malzama" أو "summary" أو "book" أو "other",
 "chapter_id": "معرف الفصل إن كان الملف لفصل واحد وإلا null", "teacher_id": "معرف الأستاذ الموجود أو null",
 "new_teacher": "اسم الأستاذ/المؤلف إن ظهر ولم يكن في القائمة وإلا null",
 "title": "عنوان قصير مرتب (مثل: ملزمة الفيزياء — الفصل الأول)", "scanned": true إذا كانت الصفحات صوراً ممسوحة بلا نص قابل للتحديد}
لا تخترع معرفات.`,
          },
        ],
      }], 8192);
      const parsed = parseJson<unknown>(raw);
      return json({ ...(Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>, pages });
    }

    // المفاتيح المضافة (أسماؤها فقط) لتبويب «الاستخدام»
    if (body.action === 'key_slots') {
      return json({ slots: [ADMIN_VAR, ...STUDENT_VARS].filter((v) => Deno.env.get(v)), per_model: DAILY_PER_MODEL, models: MAIN_MODELS, fallback: FALLBACK_MODELS });
    }

    // ٥) فحص المفاتيح: أيها يعمل وأيها مرفوض ولماذا
    if (body.action === 'check_keys') {
      const vars = [ADMIN_VAR, ...STUDENT_VARS.filter((v) => Deno.env.get(v) || ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4'].includes(v))];
      const results: { name: string; ok: boolean; detail: string }[] = [];
      for (const v of vars) {
        const key = Deno.env.get(v);
        if (!key) { results.push({ name: v, ok: false, detail: 'غير مضاف' }); continue; }
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'قل: تم' }] }], generationConfig: { maxOutputTokens: 20 } }),
        });
        const t = await res.text();
        results.push({
          name: v, ok: res.ok,
          detail: res.ok ? 'يعمل' : res.status === 429 ? 'يعمل لكن حصته انتهت مؤقتاً' : `${res.status}: ${(t.match(/"message":\s*"([^"]{0,160})/)?.[1] ?? t.slice(0, 160))}`,
        });
      }
      // النماذج المتاحة لمفتاح اللوحة (لاختيار الأقوى للفهرسة): كل ما يدعم generateContent
      const mk = Deno.env.get('GEMINI_ADMIN_API_KEY') ?? Deno.env.get('GEMINI_API_KEY');
      if (mk) {
        try {
          const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': mk } });
          const d = await res.json();
          const names = ((d.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => m.name.replace('models/', ''))
            .filter((n) => /^gemini-/.test(n) && !/image|tts|audio|live|embedding|robotics|computer/.test(n));
          results.push({ name: 'النماذج المتاحة', ok: res.ok, detail: res.ok ? names.join('، ') : `${res.status}` });
        } catch (e) {
          results.push({ name: 'النماذج المتاحة', ok: false, detail: String((e as Error).message ?? e).slice(0, 160) });
        }
      }
      const yk = Deno.env.get('YOUTUBE_API_KEY');
      if (!yk) results.push({ name: 'YOUTUBE_API_KEY', ok: false, detail: 'غير مضاف' });
      else {
        const res = await fetch(`${YT}/videos?part=contentDetails&id=dQw4w9WgXcQ&key=${yk}`);
        const t = await res.text();
        results.push({ name: 'YOUTUBE_API_KEY', ok: res.ok, detail: res.ok ? 'يعمل' : `${res.status}: ${(t.match(/"message":\s*"([^"]{0,160})/)?.[1] ?? t.slice(0, 160))}` });
      }
      return json({ results });
    }

    throw new HttpError(400, 'عملية غير معروفة.');
  } catch (e) {
    if (e instanceof GeminiQuotaError) {
      if (body.action === 'index_lecture' && body.lectureId) {
        await admin.from('lectures').update({ index_status: 'error', index_error: 'انتهى رصيد Gemini مؤقتاً' }).eq('id', body.lectureId);
      }
      throw new HttpError(503, 'انتهى رصيد Gemini المجاني لمفتاح لوحة التحكم مؤقتاً. أكمل بعد قليل أو غداً.');
    }
    if (body.action === 'index_lecture' && body.lectureId && !(e instanceof HttpError)) {
      await admin.from('lectures').update({ index_status: 'error', index_error: String((e as Error).message ?? e).slice(0, 300) }).eq('id', body.lectureId);
    }
    if (e instanceof HttpError) throw e;
    // للمشرفين فقط: نعرض السبب الحقيقي بدل «خطأ غير متوقع»
    console.error(e);
    throw new HttpError(500, `خطأ في ${String(body.action)}: ${String((e as Error)?.message ?? e).slice(0, 400)}`);
  }
}));
