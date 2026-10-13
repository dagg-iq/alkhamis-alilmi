// منطق الفهرسة المشترك: قراءة صفحات PDF مقطوعة، حفظها، بناء فهرس الفصول والمواضيع.
// تستعمله دالة ingest (من لوحة التحكم) ودالة ingest-worker (الطابور المجدول على الخادم).
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { collapseHeadings, fallbackOutline, flattenOutline, headingLines, normalizeOutline, outlineFromHeadings, type OutlineChapter } from './outline.ts';
import { HttpError } from './cors.ts';
import { admin } from './supabase.ts';
import { chunkText, embed, GeminiQuotaError, GeminiTimeoutError, generate, MAIN_MODELS, parseJson, READ_FALLBACK, READ_MODELS, toBase64 } from './gemini.ts';

export interface ReadPage { page: number; printed: string | null; text: string; headings: { level: number; title: string }[] }

export const READ_PROMPT = (from: number, to: number) => `انسخ الصفحات من ${from} إلى ${to} من هذا الملف (ترقيم صفحات ملف PDF وليس المطبوع).
أعد JSON فقط بالشكل:
[{"page": رقم صفحة الملف, "printed": "الرقم المطبوع على الصفحة أو null", "headings": [{"level": 1 أو 2, "title": "العنوان"}], "text": "النص"}]
قواعد النص:
- اكتب المعادلات بـ LaTeX بين $...$.
- صف الأشكال المهمة باختصار بين [شكل: ...].
- تجاهل الزخارف وأرقام الهواتف والإعلانات.
- إذا كانت الصفحة صورة ممسوحة (كتاب أو ملزمة مصوّرة) فاقرأ كل ما فيها من الصورة كما هو، بما في ذلك النص داخل الأشكال والجداول.
- الرياضيات والعلوم: اكتب الكسور والجذور والأسس والمصفوفات والمتجهات والوحدات بـ LaTeX صحيح (مثل $\\frac{a}{b}$ و$\\sqrt{x}$ و$x^{2}$)، وانقل أرقام الأمثلة والتمارين والأسئلة كما هي، ولا تحل شيئاً.
- انسخ كل كلمة بدقة تامة بلا اختصار أو تلخيص أو إعادة صياغة، مع التشكيل إن وُجد، وحافظ على ترتيب القراءة (عمودان ← عمود بعد عمود) وعلى عناوين الدروس والتمارين والجداول (اكتب الجداول بـ Markdown).
- الشعر: كل بيت في سطر والصدر ثم // ثم العجز. الآيات والأحاديث كما وردت.
- لا تضف شيئاً من عندك، وإذا لم تقرأ كلمة بوضوح اكتب [؟] مكانها.
- أعد كل صفحة مطلوبة (حتى الفارغة: text فارغ).
قواعد العناوين (headings) — مهمة جداً لبناء الفهرس:
- level 1 = عنوان فصل أو باب أو وحدة جديدة يبدأ في هذه الصفحة (مثل «الفصل الأول: ...»، «الباب الثاني»، «الوحدة ٣»).
- level 2 = عنوان موضوع أو درس أو فقرة رئيسية يبدأ في هذه الصفحة (عنوان بخط كبير أو عريض أو ترقيم مثل ١-٢، أو «تعريف»، «قانون...»، «مثال محلول»، «تمارين» إن كانت أقساماً مستقلة).
- لا تُدرج الترويسة أو التذييل المتكرر في كل صفحة، ولا رقم الصفحة، ولا اسم الكتاب العام.
- انسخ نص العنوان كما هو مطبوع. إن لم يبدأ في الصفحة عنوان فاجعل headings مصفوفة فارغة.`;


const INLINE_PROMPT = (from: number, to: number) => `هذا الملف يحتوي ${to - from + 1} صفحة فقط، وهي الصفحات من ${from} إلى ${to} من الكتاب (ترقيم صفحات ملف PDF الكامل).
الصفحة الأولى في هذا الملف = صفحة ${from}، والثانية = ${from + 1}، وهكذا. اكتب في page رقمها في الكتاب (${from}..${to}) لا في هذا الملف.
${READ_PROMPT(from, to).split('\n').slice(1).join('\n')}`;

/** صفحات محددة من ملف PDF صغير (قطعته لوحة التحكم): أسرع بكثير من إرسال الكتاب كاملاً، وأي مفتاح يقرؤه */
// لا نبدأ قراءة إلا ومعها هذا الوقت على الأقل (القطع قبل الجواب يضيّع الطلب من الحصة)
const MIN_READ_MS = 40_000;

export interface ReadOptions {
  /** جزء عنيد: لا نرسل الجزء كاملاً، بل مجموعات صغيرة بهذا الحجم (كل قراءة قصيرة تنتهي قبل المهلة) */
  split?: number;
  /** صفحات مقروءة سابقاً لا تُعاد */
  have?: Set<number>;
  /** تُملأ بالصفحات التي أُرسل لها طلب قراءة فعلاً (لتمييز «لم يُجرَّب لضيق الوقت» عن «جُرِّب ولم يعد بشيء») */
  attempted?: Set<number>;
}

export async function readInline(pdf: Uint8Array | string, from: number, to: number, deadline: number, lane?: number, scanned = false, opts: ReadOptions = {}): Promise<ReadPage[]> {
  if (deadline - Date.now() < MIN_READ_MS) return [];
  const b64 = typeof pdf === 'string' ? pdf : toBase64(pdf);
  let pages: ReadPage[] = [];
  if (!opts.split) try {
    for (let n = from; n <= to; n++) opts.attempted?.add(n);
    const raw = await generate(READ_MODELS, [{
      role: 'user',
      parts: [{ inline_data: { mime_type: 'application/pdf', data: b64 } }, { text: INLINE_PROMPT(from, to) }],
    }], { json: true, temperature: 0, maxOutputTokens: Math.min(32768, 6000 * (to - from + 1)), pool: 'admin', lane, fallback: READ_FALLBACK, minTimeMs: MIN_READ_MS, thinking: scanned ? 'low' : 'minimal', extraConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' }, deadline });
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
    console.error('read inline failed', from, to, String((e as Error).message ?? e).slice(0, 200));
  }
  const got = new Set([...pages.map((p) => p.page), ...(opts.have ?? [])]);
  if ((from === to && !opts.split) || deadline - Date.now() < MIN_READ_MS) {
    // الصفحة المنفردة التي فشلت لا تُكتب فارغة: تبقى ناقصة وتُعاد في المرة القادمة
    return pages;
  }
  const missing: number[] = [];
  for (let n = from; n <= to; n++) if (!got.has(n)) missing.push(n);
  if (!missing.length) return pages;
  // نقطع الملف الصغير نفسه (رخيص) ونعيد الصفحات الناقصة
  const src = await PDFDocument.load(typeof pdf === 'string' ? Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)) : pdf, { ignoreEncryption: true, updateMetadata: false });
  const groups: number[][] = [];
  for (const n of missing) {
    const g = groups[groups.length - 1];
    const max = opts.split ?? Math.ceil((to - from + 1) / 2);
    if (g && g[g.length - 1] === n - 1 && g.length < max) g.push(n); else groups.push([n]);
  }
  for (const g of groups) {
    if (deadline - Date.now() < MIN_READ_MS) break;
    const sub = await PDFDocument.create();
    const copied = await sub.copyPages(src, g.map((n) => n - from));
    copied.forEach((pg) => sub.addPage(pg));
    pages.push(...await readInline(await sub.save(), g[0], g[g.length - 1], deadline, lane, scanned, { attempted: opts.attempted }));
  }
  const byPage = new Map<number, ReadPage>();
  for (const p of pages) byPage.set(p.page, p);
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/** خطأ حصة التضمين بعد حفظ الصفحات: الصفحات محفوظة (لا تُقرأ ثانية)، والتضمين يُعاد لاحقاً */
export class EmbedPendingError extends Error {}

/**
 * يحفظ صفحات مقروءة (document_pages أولاً ثم مقاطع البحث) ويحدّث عدد الصفحات المتتالية المكتملة.
 * الصفحات تُحفظ قبل التضمين: إن بلغ التضمين حدّه في الدقيقة لا تضيع القراءة (كانت تُرمى ويُقرأ الجزء من جديد).
 */
export async function storePages(doc: Record<string, any>, read: ReadPage[], total: number) {
  if (read.length) {
    const { error: pe } = await admin.from('document_pages').upsert(read.map((p) => ({
      document_id: doc.id, page: p.page, printed: p.printed, headings: p.headings.slice(0, 8),
      digest: p.text.replace(/\s+/g, ' ').trim().slice(0, 90) || null,
      text: p.text.trim() || null,
    })));
    if (pe) throw pe;
    const nums = read.map((p) => p.page);
    const rows: { page: number; content: string }[] = [];
    for (const p of read) for (const c of chunkText(p.text)) rows.push({ page: p.page, content: c });
    let vectors: number[][] = [];
    if (rows.length) {
      try {
        vectors = await embed(rows.map((r) => r.content), 'RETRIEVAL_DOCUMENT', 'admin');
      } catch (e) {
        if (e instanceof GeminiQuotaError) throw new EmbedPendingError('انتظار حصة التضمين');
        throw e;
      }
    }
    await admin.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id).in('page', nums);
    if (rows.length) {
      const { error } = await admin.from('content_chunks').insert(rows.map((r, i) => ({
        source_type: 'document', source_id: doc.id, subject_id: doc.subject_id, chapter_id: doc.chapter_id,
        page: r.page, content: r.content, embedding: vectors[i],
      })));
      if (error) throw error;
    }
  }
  // الصفحات المتتالية من ١ (القراءة تجري بالتوازي فقد تكتمل دفعة متأخرة قبل سابقتها)
  const { data } = await admin.from('document_pages').select('page').eq('document_id', doc.id).order('page');
  const have = new Set(((data ?? []) as { page: number }[]).map((r) => r.page));
  let upTo = 0;
  while (have.has(upTo + 1)) upTo++;
  const done = upTo >= total;
  await admin.from('documents').update({ pages: total, ingested_pages: upTo, read_pages: have.size, ingest_status: done ? 'done' : 'running', ingest_error: null }).eq('id', doc.id);
  return { done, ingested: upTo, pages: total, have: have.size };
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

export async function buildOutline(doc: Record<string, any>) {
  // حد وقت الدالة ~١٥٠ ث: الذكاء الاصطناعي له ٨٥ ث، وإن تأخر يُبنى الفهرس من عناوين الصفحات فوراً
  const started = Date.now();
  await admin.from('documents').update({ outline_status: 'running', outline_error: null }).eq('id', doc.id);
  try {
    const { data: rows } = await admin.from('document_pages').select('page, headings, digest').eq('document_id', doc.id).order('page');
    const pages = (rows ?? []) as { page: number; headings: { level: number; title: string }[]; digest: string | null }[];
    if (!pages.length) throw new HttpError(409, 'لا توجد صفحات مقروءة لهذا الملف (رُفع قبل تحديث الفهرسة). اضغط «إعادة القراءة» مرة واحدة ثم يُبنى الفهرس تلقائياً.');
    const total = Math.max(doc.pages ?? 0, ...pages.map((p) => p.page));
    const collapsed = collapseHeadings(pages, total);

    let chapters: OutlineChapter[];
    try {
      const kind = doc.kind === 'book' ? 'كتاب مدرسي' : doc.kind === 'summary' ? 'ملخص' : 'ملزمة';
      const digests = pages.length <= 350 ? pages.filter((p) => p.digest).map((p) => `ص${p.page}: ${p.digest}`).join('\n') : '';
      const raw = await generate(MAIN_MODELS, [{
        role: 'user', parts: [{ text: OUTLINE_PROMPT(doc.title, kind, total, headingLines(collapsed), digests) }],
      }], { json: true, temperature: 0, maxOutputTokens: 16384, pool: 'admin', thinking: 'low', deadline: started + 85_000 });
      chapters = normalizeOutline(parseJson(raw), total);
      // نتيجة هزيلة (فصل واحد كبير) والعناوين تقول غير ذلك ← نفضّل بناءً مباشراً من العناوين
      if (chapters.length <= 1 && collapsed.filter((h) => h.level === 1).length >= 2) chapters = outlineFromHeadings(collapsed, total);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('outline ai failed', e instanceof GeminiTimeoutError ? 'timeout' : String((e as Error).message ?? e).slice(0, 200));
      chapters = collapsed.length ? outlineFromHeadings(collapsed, total) : fallbackOutline(total);
    }

    const flat = flattenOutline(chapters);
    const ids = flat.map(() => crypto.randomUUID());
    const chapterId = new Map<number, string>();
    flat.forEach((r, i) => { if (r.level === 1) chapterId.set(r.chapter, ids[i]); });
    // متجهات الربط بين الملفات تُحسب بطلب منفصل (embed_outline) حتى لا يتجاوز هذا الطلب حد الوقت
    await admin.from('document_outline').delete().eq('document_id', doc.id);
    const { error } = await admin.from('document_outline').insert(flat.map((r, i) => ({
      id: ids[i], document_id: doc.id, parent_id: r.level === 2 ? chapterId.get(r.chapter) : null, level: r.level, title: r.title,
      start_page: r.start_page, end_page: r.end_page, sort: r.sort, embedding: null,
    })));
    if (error) throw error;
    await admin.from('documents').update({ outline_status: 'done', outline_error: null }).eq('id', doc.id);
    return { done: true, chapters: chapters.length, topics: flat.filter((r) => r.level === 2).length };
  } catch (e) {
    const msg = e instanceof GeminiQuotaError ? `انتهت حصة Gemini على كل المفاتيح${e.message.includes('حتى') ? ` (${e.message.match(/حتى .+$/)?.[0]})` : ''}. أعد بناء الفهرس بعدها.` : String((e as Error).message ?? e).slice(0, 300);
    await admin.from('documents').update({ outline_status: 'error', outline_error: msg }).eq('id', doc.id);
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : e instanceof HttpError ? e.status : 500, msg);
  }
}

/** عناوين عدّلها المشرف يدوياً بلا متجهات ← نحسبها (للربط بين الكتاب والملازم) */
export async function embedOutline(doc: Record<string, any>) {
  const { data } = await admin.from('document_outline').select('id, title').eq('document_id', doc.id).is('embedding', null);
  const rows = (data ?? []) as { id: string; title: string }[];
  if (!rows.length) return { done: true, embedded: 0 };
  try {
    const vectors = await embed(rows.map((r) => `${doc.title} — ${r.title}`), 'RETRIEVAL_DOCUMENT', 'admin');
    // ١٠ تحديثات معاً (كتاب كبير فيه مئات العناوين)
    for (let i = 0; i < rows.length; i += 10) {
      await Promise.all(rows.slice(i, i + 10).map((r, j) => admin.from('document_outline').update({ embedding: vectors[i + j] }).eq('id', r.id)));
    }
    return { done: true, embedded: rows.length };
  } catch (e) {
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : 500, e instanceof GeminiQuotaError ? 'انتهى رصيد Gemini مؤقتاً، أعد المحاولة لاحقاً.' : String((e as Error).message ?? e).slice(0, 200));
  }
}

