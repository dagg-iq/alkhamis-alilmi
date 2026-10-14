// إدخال محاضرات الأساتذة من يوتيوب إلى قاعدة البيانات وترتيبها حسب الفصول، ثم وضعها في طابور الفهرسة.
// يعمل في سير العمل lectures-import.yml (مفاتيح YouTube و Gemini و Supabase من الأسرار).
// القائمة في catalog.json. "apply": false ← يطبع الخطة فقط (للمراجعة)، true ← يكتب في القاعدة.
//
// الخطوات لكل أستاذ:
//   ١) فيديوهات قوائم التشغيل (مع المدة وتاريخ النشر)، بلا المقاطع القصيرة والمحذوفة
//   ٢) Gemini يحدد لكل فيديو فصله وعنواناً مرتباً، أو يستبعده (إعلان، بث عام…)
//   ٣) داخل الفصل: بتاريخ النشر (ترتيب الشرح)، والعنوان «المحاضرة N — الموضوع»
//   ٤) الكتابة: الأستاذ، الفصول (عنوان رسمي)، المحاضرات (الموجودة تُحدَّث ولا تُعاد فهرستها إن اكتملت)
import fs from 'node:fs';

const YT_KEY = process.env.YOUTUBE_API_KEY;
const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT = process.env.PROJECT_REF;
const GEMINI_KEYS = ['GEMINI_ADMIN_API_KEY', ...['', '_2', '_3', '_4', '_5', '_6', '_7', '_8'].map((s) => `GEMINI_API_KEY${s}`)]
  .map((k) => (process.env[k] ?? '').trim()).filter((v, i, a) => v && a.indexOf(v) === i);
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const MIN_SECONDS = 4 * 60; // أقصر من ٤ دقائق: مقطع قصير أو إعلان، ليس محاضرة

const catalog = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const AR = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// ---------------------------------------------------------------- يوتيوب
async function yt(path, params) {
  for (let t = 0; t < 3; t++) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: YT_KEY })}`);
    if (res.ok) return await res.json();
    if (t === 2) throw new Error(`YouTube ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const isoDuration = (s) => {
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

async function playlist(id) {
  const items = [];
  let page = '';
  let title = id;
  const meta = await yt('playlists', { part: 'snippet', id });
  title = meta.items?.[0]?.snippet?.title ?? id;
  for (let i = 0; i < 20; i++) {
    const d = await yt('playlistItems', { part: 'snippet,contentDetails', maxResults: '50', playlistId: id, ...(page ? { pageToken: page } : {}) });
    for (const it of d.items ?? []) items.push({ youtube_id: it.contentDetails.videoId, position: it.snippet.position });
    if (!d.nextPageToken) break;
    page = d.nextPageToken;
  }
  const out = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const d = await yt('videos', { part: 'snippet,contentDetails,status', id: batch.map((v) => v.youtube_id).join(',') });
    const info = new Map((d.items ?? []).map((v) => [v.id, v]));
    for (const v of batch) {
      const x = info.get(v.youtube_id);
      if (!x || x.status?.privacyStatus === 'private' || x.status?.embeddable === false) continue; // محذوف أو خاص أو يمنع التشغيل داخل التطبيقات
      const duration = isoDuration(x.contentDetails.duration);
      if (x.snippet.liveBroadcastContent !== 'none' || duration < MIN_SECONDS) continue;
      out.push({ ...v, title: x.snippet.title, published: x.snippet.publishedAt, duration_sec: duration, playlist: title });
    }
  }
  return { title, videos: out };
}

// ---------------------------------------------------------------- Gemini
async function gemini(prompt) {
  let last = '';
  for (const model of MODELS) {
    for (const key of GEMINI_KEYS) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'low' } },
        }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
      if (res.ok) {
        const d = await res.json();
        const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
        try { return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch { last = `bad json from ${model}`; continue; }
      }
      last = `${model} ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status === 404) break; // النموذج غير متاح: التالي
    }
  }
  throw new Error(`Gemini: ${last}`);
}

async function classify(teacher, videos) {
  const known = teacher.chapters?.length
    ? `فصول الكتاب الرسمية (استخدمها كما هي):\n${teacher.chapters.map((c) => `${c.number}. ${c.title}`).join('\n')}`
    : 'استنتج فصول الكتاب من عناوين الفيديوهات وقوائم التشغيل ومعرفتك بمنهج الخامس العلمي العراقي الحالي، بأرقامها وعناوينها الرسمية.';
  const out = new Map();
  for (let i = 0; i < videos.length; i += 80) {
    const batch = videos.slice(i, i + 80);
    const r = await gemini(`أنت تنظم محاضرات يوتيوب للأستاذ ${teacher.teacher} في مادة «${teacher.subject_name}» لمنهج الصف الخامس الإعدادي العلمي في العراق.
${known}
${teacher.hint ?? ''}

الفيديوهات (رقم | قائمة التشغيل | العنوان):
${batch.map((v, k) => `${i + k} | ${v.playlist} | ${v.title}`).join('\n')}

أعد JSON: {"items": [{"i": رقم الفيديو, "chapter": رقم الفصل, "chapter_title": "عنوان الفصل الرسمي",
 "topic": "موضوع المحاضرة بالعربية بكلمات قليلة (مثل: قانون كولوم، أو حل تمارين 1-2)، بلا اسم الأستاذ أو القناة أو الصف أو رقم المحاضرة",
 "skip": true فقط إذا لم يكن الفيديو شرحاً للمنهج (إعلان، تهنئة، بث عام، فيديو لصف آخر)}]}
كل فيديو مرة واحدة. لا تخترع فصلاً غير موجود في المنهج.`);
    for (const x of r.items ?? r) out.set(Number(x.i), x);
  }
  return out;
}

// ---------------------------------------------------------------- Supabase
async function sql(query, readOnly = false) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
const lit = (obj) => {
  const s = JSON.stringify(obj);
  if (s.includes('$saey$')) throw new Error('bad payload');
  return `$saey$${s}$saey$::jsonb`;
};

// ---------------------------------------------------------------- الخطة
const plan = { teachers: [], chapters: [], lectures: [] };
for (const t of catalog.teachers) {
  console.log(`\n################ ${t.teacher} — ${t.subject}`);
  const seen = new Set();
  const all = [];
  for (const [si, src] of t.sources.entries()) {
    const p = await playlist(src.playlist);
    console.log(`  قائمة «${p.title}»: ${p.videos.length} فيديو`);
    for (const v of p.videos) {
      if (seen.has(v.youtube_id)) continue;
      seen.add(v.youtube_id);
      all.push({ ...v, source: si, src });
    }
  }
  const cls = await classify(t, all);
  const kept = [];
  for (const [i, v] of all.entries()) {
    const c = cls.get(i);
    if (!c || c.skip || !Number.isInteger(Number(c.chapter))) { console.log(`  ✗ مستبعد: ${v.title}`); continue; }
    const ch = Number(c.chapter);
    if (v.src.only_chapters && !v.src.only_chapters.includes(ch)) continue;
    if (v.src.exclude_chapters?.includes(ch)) continue;
    kept.push({ ...v, chapter: ch, chapter_title: String(c.chapter_title ?? '').trim(), topic: String(c.topic ?? '').trim() || v.title });
  }
  // التجميع حسب الفصل (والكتاب إن حددته القائمة نفسها، مثل جزأي الأدب في العربي)
  const groups = new Map();
  for (const v of kept) {
    const k = `${v.src.book ?? ''}|${v.chapter}`;
    if (!groups.has(k)) groups.set(k, { chapter: v.chapter, src: v.src, source: v.source, vs: [] });
    groups.get(k).vs.push(v);
  }
  // الكتاب: من القائمة، أو ثابت للأستاذ، أو حسب تاريخ النشر (العربي: ما شُرح قبل شباط = الجزء الأول)
  for (const g of groups.values()) {
    if (g.src.book ?? t.book) { g.book = g.src.book ?? t.book; continue; }
    if (t.split_by_date) {
      const months = g.vs.map((v) => new Date(v.published).getUTCMonth() + 1).sort((a, b) => a - b);
      const m = months[Math.floor(months.length / 2)];
      g.book = m >= 8 || m === 1 ? t.split_by_date[0] : t.split_by_date[1];
    } else g.book = null;
  }
  for (const g of groups.values()) {
    const official = t.chapters?.find((c) => c.number === g.chapter)?.title;
    const count = new Map();
    for (const v of g.vs) count.set(v.chapter_title, (count.get(v.chapter_title) ?? 0) + 1);
    g.title = official ?? [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.number = g.chapter;
  }
  // إعادة ترقيم الفصول داخل كل كتاب (مواضيع العربي): بترتيب القوائم ثم ترتيب Gemini
  const list = [...groups.values()].sort((a, b) => String(a.book).localeCompare(String(b.book)) || a.source - b.source || a.chapter - b.chapter);
  if (t.renumber) {
    const n = new Map();
    for (const g of list) { n.set(g.book, (n.get(g.book) ?? 0) + 1); g.number = n.get(g.book); }
  }
  plan.teachers.push({ name: t.teacher, subject: t.subject, channel_url: t.channel_url });
  for (const g of list.sort((a, b) => String(a.book).localeCompare(String(b.book)) || a.number - b.number)) {
    plan.chapters.push({ subject: t.subject, book: g.book, number: g.number, title: g.title });
    // ترتيب الشرح: القائمة الأعلى أولوية ثم تاريخ النشر ثم الموضع في القائمة
    g.vs.sort((a, b) => a.source - b.source || a.published.localeCompare(b.published) || a.position - b.position);
    console.log(`  ── الفصل ${g.number}: ${g.title}${g.book ? ` (${g.book})` : ''} — ${g.vs.length} محاضرة`);
    g.vs.forEach((v, n) => {
      const lecture = { youtube_id: v.youtube_id, subject: t.subject, book: g.book, chapter: g.number, teacher: t.teacher,
        title: `المحاضرة ${AR(n + 1)} — ${v.topic}`.slice(0, 200), duration_sec: v.duration_sec, sort: n + 1 };
      plan.lectures.push(lecture);
      console.log(`     ${AR(n + 1)}. ${lecture.title}  [${Math.round(v.duration_sec / 60)} د] ${v.youtube_id} ${v.published.slice(0, 10)} ← ${v.title}`);
    });
  }
}

const dupe = plan.lectures.length - new Set(plan.lectures.map((l) => l.youtube_id)).size;
console.log(`\n===== المجموع: ${plan.teachers.length} أساتذة، ${plan.chapters.length} فصلاً، ${plan.lectures.length} محاضرة (مكرر بين الأساتذة: ${dupe})، ${Math.round(plan.lectures.reduce((a, l) => a + l.duration_sec, 0) / 3600)} ساعة`);
fs.writeFileSync('lecture-plan.json', JSON.stringify(plan, null, 1));

if (!catalog.apply) {
  console.log('\napply=false: لم يُكتب شيء. راجع الخطة ثم اجعل "apply": true.');
  process.exit(0);
}

// ---------------------------------------------------------------- الكتابة
// الكتاب: بالاسم إن حُدد، وإلا أول كتاب للمادة
const bookSql = (alias) => `(select b.id from books b join subjects s on s.id = b.subject_id where s.slug = ${alias}.subject
  and (${alias}.book is null or b.name = ${alias}.book) order by b.sort limit 1)`;

await sql(`
with t as (select * from jsonb_to_recordset(${lit(plan.teachers)}) as x(name text, subject text, channel_url text))
insert into teachers (name, subject_id, channel_url)
select t.name, (select id from subjects where slug = t.subject), t.channel_url from t
where not exists (select 1 from teachers e where e.name = t.name);
with t as (select * from jsonb_to_recordset(${lit(plan.teachers)}) as x(name text, subject text, channel_url text))
update teachers e set subject_id = (select id from subjects where slug = t.subject), channel_url = coalesce(t.channel_url, e.channel_url)
from t where e.name = t.name;`);
console.log('✓ الأساتذة');

await sql(`
with c as (select *, ${bookSql('x')} as book_id from jsonb_to_recordset(${lit(plan.chapters)}) as x(subject text, book text, number int, title text))
update chapters ch set title = c.title, sort = c.number from c where ch.book_id = c.book_id and ch.number = c.number;
with c as (select *, ${bookSql('x')} as book_id from jsonb_to_recordset(${lit(plan.chapters)}) as x(subject text, book text, number int, title text))
insert into chapters (book_id, number, title, sort)
select c.book_id, c.number, c.title, c.number from c
where c.book_id is not null and not exists (select 1 from chapters ch where ch.book_id = c.book_id and ch.number = c.number);`);
console.log('✓ الفصول');

// على دفعات (حجم الطلب)
for (let i = 0; i < plan.lectures.length; i += 150) {
  const batch = plan.lectures.slice(i, i + 150);
  const src = `select x.*, (select ch.id from chapters ch where ch.book_id = ${bookSql('x')} and ch.number = x.chapter) as chapter_id,
      (select id from teachers where name = x.teacher limit 1) as teacher_id
    from jsonb_to_recordset(${lit(batch)}) as x(youtube_id text, subject text, book text, chapter int, teacher text, title text, duration_sec int, sort int)`;
  await sql(`
with l as (${src})
update lectures e set chapter_id = l.chapter_id, teacher_id = l.teacher_id, title = l.title, sort = l.sort,
  duration_sec = coalesce(e.duration_sec, l.duration_sec),
  queued_at = case when e.index_status = 'done' then e.queued_at else coalesce(e.queued_at, now()) end
from l where e.youtube_id = l.youtube_id and l.chapter_id is not null;
with l as (${src})
insert into lectures (chapter_id, teacher_id, title, youtube_id, duration_sec, sort, is_published, queued_at)
select l.chapter_id, l.teacher_id, l.title, l.youtube_id, l.duration_sec, l.sort, true, now() from l
where l.chapter_id is not null and not exists (select 1 from lectures e where e.youtube_id = l.youtube_id);`);
  console.log(`✓ المحاضرات ${i + batch.length}/${plan.lectures.length}`);
}

const summary = await sql(`select s.slug, count(*) lectures, count(*) filter (where l.queued_at is not null) queued, count(*) filter (where l.index_status = 'done') indexed
  from lectures l join chapters c on c.id = l.chapter_id join books b on b.id = c.book_id join subjects s on s.id = b.subject_id group by s.slug, s.sort order by s.sort`, true);
console.log('\n===== في القاعدة الآن');
for (const r of summary) console.log(`${r.slug}: ${r.lectures} محاضرة — في طابور الفهرسة ${r.queued}، مفهرسة ${r.indexed}`);
