// فهرسة الكتب والملازم للمساعد الذكي:
//  - قراءة الصفحات (٦ في كل استدعاء): نص + الرقم المطبوع + عناوين كل صفحة ← مقاطع بحث و document_pages
//  - action: 'outline' ← بناء فهرس الفصول والمواضيع (document_outline) من العناوين المقروءة
// لوحة التحكم تستدعيها بشكل متكرر حتى done = true ثم تستدعي outline.
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import {
  collapseHeadings, fallbackOutline, flattenOutline, headingLines, normalizeOutline, outlineFromHeadings, type OutlineChapter,
} from '../_shared/outline.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { chunkText, embed, fileRef, firstAvailableSlot, generate, poolSlots, GeminiQuotaError, parseJson, uploadFile, MAIN_MODELS, modelChain } from '../_shared/gemini.ts';
import { getObject } from '../_shared/storage.ts';

// الفهرسة تُنفَّذ مرة واحدة للكتاب، فنفضّل الجودة: صفحات أقل في الطلب الواحد وأقوى نموذج متاح وصور بدقة عالية
const BATCH = 6;

interface ReadPage { page: number; printed: string | null; text: string; headings: { level: number; title: string }[] }
type AiSettings = { model?: string; ingest_model?: string };

const READ_PROMPT = (from: number, to: number) => `انسخ الصفحات من ${from} إلى ${to} من هذا الملف (ترقيم صفحات ملف PDF وليس المطبوع).
أعد JSON فقط بالشكل:
[{"page": رقم صفحة الملف, "printed": "الرقم المطبوع على الصفحة أو null", "headings": [{"level": 1 أو 2, "title": "العنوان"}], "text": "النص"}]
قواعد النص:
- اكتب المعادلات بـ LaTeX بين $...$.
- صف الأشكال المهمة باختصار بين [شكل: ...].
- تجاهل الزخارف وأرقام الهواتف والإعلانات.
- إذا كانت الصفحة صورة ممسوحة (ملزمة مصوّرة) فاقرأ النص من الصورة كما هو.
- انسخ كل كلمة بدقة تامة بلا اختصار أو تلخيص أو إعادة صياغة، مع التشكيل إن وُجد، وحافظ على ترتيب القراءة (عمودان ← عمود بعد عمود) وعلى عناوين الدروس والتمارين والجداول (اكتب الجداول بـ Markdown).
- الشعر: كل بيت في سطر والصدر ثم // ثم العجز. الآيات والأحاديث كما وردت.
- لا تضف شيئاً من عندك، وإذا لم تقرأ كلمة بوضوح اكتب [؟] مكانها.
- أعد كل صفحة مطلوبة (حتى الفارغة: text فارغ).
قواعد العناوين (headings) — مهمة جداً لبناء الفهرس:
- level 1 = عنوان فصل أو باب أو وحدة جديدة يبدأ في هذه الصفحة (مثل «الفصل الأول: ...»، «الباب الثاني»، «الوحدة ٣»).
- level 2 = عنوان موضوع أو درس أو فقرة رئيسية يبدأ في هذه الصفحة (عنوان بخط كبير أو عريض أو ترقيم مثل ١-٢، أو «تعريف»، «قانون...»، «مثال محلول»، «تمارين» إن كانت أقساماً مستقلة).
- لا تُدرج الترويسة أو التذييل المتكرر في كل صفحة، ولا رقم الصفحة، ولا اسم الكتاب العام.
- انسخ نص العنوان كما هو مطبوع. إن لم يبدأ في الصفحة عنوان فاجعل headings مصفوفة فارغة.`;

/** يقرأ نطاق صفحات؛ إن فشل التحليل أو نقصت صفحات يقسّم النطاق ويعيد المحاولة حتى صفحة واحدة */
async function readRange(fileUri: string, slot: string, from: number, to: number, ai: AiSettings, deadline: number): Promise<ReadPage[]> {
  let pages: ReadPage[] = [];
  // الدالة محدودة الزمن (~١٥٠ ث): بعد المهلة لا نبدأ طلباً جديداً، والصفحات الناقصة تُقرأ في الاستدعاء التالي
  if (Date.now() > deadline) return [];
  try {
    const raw = await generate(modelChain(ai.ingest_model ?? ai.model, MAIN_MODELS), [{
      role: 'user',
      parts: [{ file_data: { mime_type: 'application/pdf', file_uri: fileUri } }, { text: READ_PROMPT(from, to) }],
    }], { json: true, temperature: 0, maxOutputTokens: 32768, pool: 'admin', slot, thinking: 'low', extraConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
    const parsed = parseJson<ReadPage[] | { pages: ReadPage[] }>(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.pages;
    pages = (Array.isArray(list) ? list : []).filter((p) => Number.isInteger(Number(p?.page)) && Number(p.page) >= from && Number(p.page) <= to)
      .map((p) => ({
        page: Number(p.page),
        printed: p.printed == null || String(p.printed).trim() === '' || String(p.printed) === 'null' ? null : String(p.printed).trim().slice(0, 12),
        text: String(p.text ?? ''),
        headings: Array.isArray(p.headings) ? p.headings.filter((h) => h && typeof h.title === 'string') : [],
      }));
  } catch (e) {
    if (e instanceof GeminiQuotaError) throw e;
    console.error('read range failed', from, to, String((e as Error).message ?? e).slice(0, 200));
  }
  const got = new Set(pages.map((p) => p.page));
  const missing: number[] = [];
  for (let n = from; n <= to; n++) if (!got.has(n)) missing.push(n);
  if (!missing.length) return pages;
  // صفحات ناقصة أو فشل كامل: نقسم ونعيد (الصفحة المنفردة التي تفشل مرتين تُسجَّل فارغة بدل إيقاف الكتاب)
  if (Date.now() > deadline) return pages;
  if (from === to) {
    return [{ page: from, printed: null, text: '', headings: [] }];
  }
  const mid = Math.floor((from + to) / 2);
  const rest = pages.filter((p) => p.page >= from && p.page <= to);
  const redo: ReadPage[] = [];
  const parts: [number, number][] = missing.length === to - from + 1 ? [[from, mid], [mid + 1, to]] : missing.map((n) => [n, n] as [number, number]);
  for (const [a, b] of parts) redo.push(...await readRange(fileUri, slot, a, b, ai, deadline));
  const byPage = new Map<number, ReadPage>();
  for (const p of [...rest, ...redo]) byPage.set(p.page, p);
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

async function ingestBatch(doc: Record<string, any>, restart: boolean) {
  const started = Date.now();
  if (restart) {
    await admin.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id);
    await admin.from('document_pages').delete().eq('document_id', doc.id);
    await admin.from('document_outline').delete().eq('document_id', doc.id);
    await admin.from('documents').update({ outline_status: 'none', outline_error: null }).eq('id', doc.id);
    doc.ingested_pages = 0;
  }

  let fileUri: string | null = doc.gemini_file_uri;
  let pages: number | null = doc.pages;
  const ai = await getSetting<AiSettings>('ai');
  const chain = modelChain(ai.ingest_model ?? ai.model, MAIN_MODELS);
  const slotNames = poolSlots('admin').map((s) => s.slot);
  // الملف مرفوع لمفتاح محدد (لا يقرؤه غيره): نعيد الرفع إن انتهت مدته، أو أُزيل مفتاحه، أو انتهت حصة كل نماذجه اليوم
  const slotOf = (u: string | null) => {
    const r = fileRef(String(u ?? ''));
    return r.slot ?? slotNames[r.keyIndex];
  };
  let bytes: Uint8Array | null = null;
  const reupload = async (exclude: string[]) => {
    const target = await firstAvailableSlot('admin', chain, exclude);
    if (!target) throw new GeminiQuotaError('انتهت حصة كل المفاتيح اليوم');
    bytes ??= await getObject(doc.file_key);
    fileUri = await uploadFile(bytes, 'application/pdf', doc.title, 'admin', target, chain);
    await admin.from('documents').update({
      gemini_file_uri: fileUri,
      gemini_file_expires_at: new Date(Date.now() + 47 * 3600_000).toISOString(),
      ...(pages ? { pages } : {}),
    }).eq('id', doc.id);
  };
  const stale = !fileUri || !doc.gemini_file_expires_at || new Date(doc.gemini_file_expires_at) < new Date(Date.now() + 3600_000)
    || !slotOf(fileUri) || !slotNames.includes(slotOf(fileUri)!);
  if (!pages) {
    bytes = await getObject(doc.file_key);
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    pages = pdf.getPageCount();
    await admin.from('documents').update({ pages }).eq('id', doc.id);
  }
  if (stale || !(await firstAvailableSlot('admin', chain, slotNames.filter((x) => x !== slotOf(fileUri))))) await reupload([]);

  const from = (doc.ingested_pages ?? 0) + 1;
  if (from > pages!) {
    await admin.from('documents').update({ ingest_status: 'done', ingest_error: null }).eq('id', doc.id);
    return json({ done: true, ingested: pages, pages });
  }
  const to = Math.min(from + BATCH - 1, pages!);
  await admin.from('documents').update({ ingest_status: 'running', ingest_error: null }).eq('id', doc.id);

  try {
    // انتهت حصة مفتاح الملف أثناء القراءة ← نرفعه لمفتاح آخر ما زالت حصته متاحة ونكمل (بدل أن تتوقف الفهرسة)
    let all: ReadPage[] = [];
    const tried: string[] = [];
    for (;;) {
      const slot = slotOf(fileUri)!;
      try {
        all = await readRange(fileRef(fileUri!).uri, slot, from, to, ai, started + 105_000);
        break;
      } catch (e) {
        if (!(e instanceof GeminiQuotaError) || Date.now() > started + 90_000) throw e;
        tried.push(slot);
        await reupload(tried);
      }
    }
    // نحفظ الصفحات المتتالية المقروءة فقط؛ ما بعد أول صفحة ناقصة يُعاد في الاستدعاء التالي
    const got = new Set(all.map((p) => p.page));
    let upTo = from - 1;
    while (upTo < to && got.has(upTo + 1)) upTo++;
    if (upTo < from) throw new Error('انتهت مهلة القراءة قبل إكمال أي صفحة. اضغط «إكمال» لإعادة المحاولة.');
    const read = all.filter((p) => p.page <= upTo);

    // مقاطع البحث (مع إعادة الكتابة: نحذف ما سبق لهذه الصفحات حتى لا يتكرر عند إعادة المحاولة)
    await admin.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id).gte('page', from).lte('page', upTo);
    const rows: { page: number; content: string }[] = [];
    for (const p of read) for (const c of chunkText(p.text)) rows.push({ page: p.page, content: c });
    if (rows.length) {
      const vectors = await embed(rows.map((r) => r.content), 'RETRIEVAL_DOCUMENT', 'admin');
      const { error } = await admin.from('content_chunks').insert(rows.map((r, i) => ({
        source_type: 'document', source_id: doc.id, subject_id: doc.subject_id, chapter_id: doc.chapter_id,
        page: r.page, content: r.content, embedding: vectors[i],
      })));
      if (error) throw error;
    }
    // ما يلزم لبناء الفهرس لاحقاً
    const { error: pe } = await admin.from('document_pages').upsert(read.map((p) => ({
      document_id: doc.id, page: p.page, printed: p.printed, headings: p.headings.slice(0, 8),
      digest: p.text.replace(/\s+/g, ' ').trim().slice(0, 90) || null,
      text: p.text.trim() || null,
    })));
    if (pe) throw pe;

    const done = upTo >= pages!;
    await admin.from('documents').update({ ingested_pages: upTo, ingest_status: done ? 'done' : 'running' }).eq('id', doc.id);
    return json({ done, ingested: upTo, pages, chunks: rows.length });
  } catch (e) {
    const msg = e instanceof GeminiQuotaError ? `انتهت حصة Gemini على كل المفاتيح${e.message.includes('حتى') ? ` (${e.message.match(/حتى .+$/)?.[0]})` : ''}. اضغط «إكمال» بعدها ويكمل من حيث توقف.` : String((e as Error).message ?? e).slice(0, 300);
    await admin.from('documents').update({ ingest_status: 'error', ingest_error: msg }).eq('id', doc.id);
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : 500, msg);
  }
}

const OUTLINE_PROMPT = (title: string, kind: string, total: number, headings: string, digests: string) => `أنت تبني فهرساً دقيقاً لـ ${kind} اسمها «${title}» عدد صفحاتها ${total} (ترقيم صفحات ملف PDF).
أمامك العناوين التي استُخرجت من صفحاتها: «ص» رقم صفحة الملف، «م١» عنوان فصل/باب/وحدة، «م٢» عنوان موضوع/درس/فقرة رئيسية.
${headings || '(لم تُستخرج عناوين)'}
${digests ? `\nمطلع كل صفحة (للمساعدة في تحديد حدود المواضيع):\n${digests}\n` : ''}
أعد JSON فقط بالشكل: {"chapters":[{"title":"...","start_page":رقم,"topics":[{"title":"...","page":رقم}]}]}
القواعد:
- الفصول مرتبة تصاعدياً بـ start_page وتغطي الملف من أول محتوى إلى آخره، ولا فصل خارج ١..${total}.
- كل موضوع في صفحة تقع داخل فصله.
- ادمج العناوين المكررة أو المجزأة للفصل الواحد، واحذف الترويسات وأرقام الصفحات وما ليس عنواناً حقيقياً.
- انسخ نص العناوين كما وردت (يمكنك حذف ترقيم زائد في أولها) ولا تخترع عناوين غير موجودة؛ وإن كانت العناوين المستخرجة قليلة جداً فاستعن بمطلع الصفحات لتسمية أقسام منطقية.
- إن لم تكن هناك فصول صريحة (ملزمة) فقسّمها إلى أقسام منطقية بحسب الموضوعات الكبرى.
- اجعل المواضيع تغطي الأقسام المهمة (تعريف، قانون، مثال محلول، تمارين) بدقة، من ٣ إلى ٣٠ موضوعاً لكل فصل بحسب حجمه.`;

async function buildOutline(doc: Record<string, any>) {
  await admin.from('documents').update({ outline_status: 'running', outline_error: null }).eq('id', doc.id);
  try {
    const { data: rows } = await admin.from('document_pages').select('page, headings, digest').eq('document_id', doc.id).order('page');
    const pages = (rows ?? []) as { page: number; headings: { level: number; title: string }[]; digest: string | null }[];
    if (!pages.length) throw new HttpError(409, 'لا توجد صفحات مقروءة لهذا الملف (رُفع قبل تحديث الفهرسة). اضغط «إعادة القراءة» مرة واحدة ثم يُبنى الفهرس تلقائياً.');
    const total = Math.max(doc.pages ?? 0, ...pages.map((p) => p.page));
    const collapsed = collapseHeadings(pages, total);

    let chapters: OutlineChapter[];
    try {
      const ai = await getSetting<AiSettings>('ai');
      const kind = doc.kind === 'book' ? 'كتاب مدرسي' : doc.kind === 'summary' ? 'ملخص' : 'ملزمة';
      const digests = pages.length <= 350 ? pages.filter((p) => p.digest).map((p) => `ص${p.page}: ${p.digest}`).join('\n') : '';
      const raw = await generate(modelChain(ai.ingest_model ?? ai.model, MAIN_MODELS), [{
        role: 'user', parts: [{ text: OUTLINE_PROMPT(doc.title, kind, total, headingLines(collapsed), digests) }],
      }], { json: true, temperature: 0, maxOutputTokens: 32768, pool: 'admin', thinking: 'medium' });
      chapters = normalizeOutline(parseJson(raw), total);
      // نتيجة هزيلة (فصل واحد كبير) والعناوين تقول غير ذلك ← نفضّل بناءً مباشراً من العناوين
      if (chapters.length <= 1 && collapsed.filter((h) => h.level === 1).length >= 2) chapters = outlineFromHeadings(collapsed, total);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('outline ai failed', String((e as Error).message ?? e).slice(0, 200));
      chapters = collapsed.length ? outlineFromHeadings(collapsed, total) : fallbackOutline(total);
    }

    const flat = flattenOutline(chapters);
    const ids = flat.map(() => crypto.randomUUID());
    const chapterId = new Map<number, string>();
    flat.forEach((r, i) => { if (r.level === 1) chapterId.set(r.chapter, ids[i]); });
    let vectors: number[][] = [];
    try {
      vectors = await embed(flat.map((r) => `${doc.title} — ${r.title}`), 'RETRIEVAL_DOCUMENT', 'admin');
    } catch (e) {
      if (e instanceof GeminiQuotaError) throw e;
      console.error('outline embed failed', String((e as Error).message ?? e).slice(0, 200)); // الفهرس يعمل بدون الربط الدلالي
    }
    await admin.from('document_outline').delete().eq('document_id', doc.id);
    const { error } = await admin.from('document_outline').insert(flat.map((r, i) => ({
      id: ids[i], document_id: doc.id, parent_id: r.level === 2 ? chapterId.get(r.chapter) : null, level: r.level, title: r.title,
      start_page: r.start_page, end_page: r.end_page, sort: r.sort, embedding: vectors[i] ?? null,
    })));
    if (error) throw error;
    await admin.from('documents').update({ outline_status: 'done', outline_error: null }).eq('id', doc.id);
    return json({ done: true, chapters: chapters.length, topics: flat.filter((r) => r.level === 2).length });
  } catch (e) {
    const msg = e instanceof GeminiQuotaError ? `انتهت حصة Gemini على كل المفاتيح${e.message.includes('حتى') ? ` (${e.message.match(/حتى .+$/)?.[0]})` : ''}. أعد بناء الفهرس بعدها.` : String((e as Error).message ?? e).slice(0, 300);
    await admin.from('documents').update({ outline_status: 'error', outline_error: msg }).eq('id', doc.id);
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : e instanceof HttpError ? e.status : 500, msg);
  }
}

/** عناوين عدّلها المشرف يدوياً بلا متجهات ← نحسبها (للربط بين الكتاب والملازم) */
async function embedOutline(doc: Record<string, any>) {
  const { data } = await admin.from('document_outline').select('id, title').eq('document_id', doc.id).is('embedding', null);
  const rows = (data ?? []) as { id: string; title: string }[];
  if (!rows.length) return json({ done: true, embedded: 0 });
  try {
    const vectors = await embed(rows.map((r) => `${doc.title} — ${r.title}`), 'RETRIEVAL_DOCUMENT', 'admin');
    for (let i = 0; i < rows.length; i++) await admin.from('document_outline').update({ embedding: vectors[i] }).eq('id', rows[i].id);
    return json({ done: true, embedded: rows.length });
  } catch (e) {
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : 500, e instanceof GeminiQuotaError ? 'انتهى رصيد Gemini مؤقتاً، أعد المحاولة لاحقاً.' : String((e as Error).message ?? e).slice(0, 200));
  }
}

Deno.serve(handler(async (req) => {
  await getCaller(req, { staff: true });
  const body = await req.json();
  const { documentId, restart, action } = body;
  const { data: doc } = await admin.from('documents').select('*').eq('id', documentId).single();
  if (!doc) throw new HttpError(404, 'الملف غير موجود.');
  if (action === 'outline') return await buildOutline(doc);
  if (action === 'embed_outline') return await embedOutline(doc);
  return await ingestBatch(doc, !!restart);
}));
