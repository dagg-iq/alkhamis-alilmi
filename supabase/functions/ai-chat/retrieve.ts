// بحث المساعد في المنهج: دلالي (مقاطع) + مباشر (صفحة أو فصل محدد من كتاب/ملزمة) مع الفصل والموضوع والرقم المطبوع لكل صفحة.
import { admin } from '../_shared/supabase.ts';
import { embed } from '../_shared/gemini.ts';
import { buildTree, locate, normTitle, parsePageRef, pickSection, printedVariants, type OutlineNode, type OutlineRow } from '../_shared/outline.ts';

export interface Item {
  kind: 'document' | 'lecture' | 'question_set';
  text: string;
  title: string;
  subject?: string;
  documentId?: string;
  page?: number;
  printed?: string | null;
  chapter?: string;
  topic?: string;
  lectureId?: string;
  start?: number;
  /** نتيجة مباشرة (الصفحة/الفصل المطلوب) وليست بحثاً دلالياً */
  direct?: boolean;
  /** تنبيه للنموذج (مثلاً: الفصل أطول مما أُرفق) */
  note?: string;
}

export interface ViewerContext { documentId?: string; page?: number; from?: number; to?: number }

const NO_ID = '00000000-0000-0000-0000-000000000000';
const MAX_CHARS = 45000;
const MAX_DIRECT_PAGES = 14;

type PageRow = { page: number; printed: string | null; text: string | null };

async function outlineOf(docId: string): Promise<OutlineNode[]> {
  const { data } = await admin.from('document_outline')
    .select('id, document_id, parent_id, level, title, start_page, end_page, sort').eq('document_id', docId);
  return buildTree((data ?? []) as OutlineRow[]);
}

/** ملف منشور يُذكر اسمه في السؤال (أغلب كلمات عنوانه موجودة في السؤال) */
async function docNamedIn(text: string, subjectId: string | null): Promise<string | null> {
  let q = admin.from('documents').select('id, title').eq('is_published', true);
  if (subjectId) q = q.eq('subject_id', subjectId);
  const { data } = await q.limit(200);
  const GENERIC = /^(ال)?(ملزمه|ملزمة|كتاب|ملخص|الاستاذ|استاذ|مادة|ماده|جزء|الجزء|الخامس|العلمي|اعدادي)$/;
  const words = (t: string) => normTitle(t).split(' ').filter((w) => w.length > 2 && !GENERIC.test(w));
  const q2 = new Set(words(text));
  let best: string | null = null;
  let bestScore = 0;
  for (const d of (data ?? []) as { id: string; title: string }[]) {
    const w = words(d.title);
    if (!w.length) continue;
    const score = w.filter((x) => q2.has(x)).length / w.length;
    if (score > bestScore) { bestScore = score; best = d.id; }
  }
  return bestScore >= 0.6 ? best : null;
}

export async function retrieveItems(text: string, subjectId: string | null, ctx?: ViewerContext): Promise<Item[]> {
  // ١) بحث دلالي
  const [qv] = await embed([text], 'RETRIEVAL_QUERY');
  const args = { query_embedding: qv, match_count: 10, p_subject: subjectId };
  let { data: chunks, error: rpcError } = await admin.rpc('match_chunks_v2', args);
  if (rpcError) ({ data: chunks } = await admin.rpc('match_chunks', args));
  type Chunk = { id?: string; source_type: string; source_id: string; page: number | null; start_sec?: number | null; subject_id: string; content: string; similarity: number };
  let all = (chunks ?? []) as Chunk[];
  // السؤال من داخل ملف: نبحث في الملف نفسه أيضاً (حتى لو كان الجواب أضعف تشابهاً من ملفات أخرى)
  if (ctx?.documentId) {
    const { data: own } = await admin.rpc('match_chunks_v3', { query_embedding: qv, match_count: 8, p_subject: null, p_document: ctx.documentId });
    const seen = new Set(all.map((c) => c.id));
    all = [...((own ?? []) as Chunk[]).filter((c) => !seen.has(c.id)), ...all];
  }
  const relevant = all.filter((c) => c.similarity > 0.5);

  const ids = (t: string) => [...new Set(relevant.filter((c) => c.source_type === t).map((c) => c.source_id))];
  const ctxDoc = ctx?.documentId;
  // «اشرح صفحة ٥٢ من ملزمة الأستاذ أحمد»: الملف المذكور باسمه في السؤال
  const namedDoc = !ctxDoc && (parsePageRef(text) !== null || /(فصل|باب|وحدة|كامل|موضوع|درس)/.test(text)) ? await docNamedIn(text, subjectId) : null;
  const wantDocs = [...new Set([...ids('document'), ...(ctxDoc ? [ctxDoc] : []), ...(namedDoc ? [namedDoc] : [])])];
  const [{ data: docs }, { data: qsets }, { data: lecs }, { data: subjects }] = await Promise.all([
    admin.from('documents').select('id, title, subject_id, pages, is_published').in('id', wantDocs.length ? wantDocs : [NO_ID]),
    admin.from('question_sets').select('id, title').in('id', ids('question_set').length ? ids('question_set') : [NO_ID]),
    admin.from('lectures').select('id, title, teachers(name)').in('id', ids('lecture').length ? ids('lecture') : [NO_ID]),
    admin.from('subjects').select('id, name'),
  ]);
  const docMap = new Map(((docs ?? []) as { id: string; title: string; subject_id: string; pages: number | null; is_published: boolean }[]).map((d) => [d.id, d]));
  const titleOf = new Map<string, string>([...(qsets ?? [])].map((d: { id: string; title: string }) => [d.id, d.title]));
  for (const l of (lecs ?? []) as { id: string; title: string; teachers: { name?: string } | null }[]) {
    titleOf.set(l.id, `محاضرة ${l.title}${l.teachers?.name ? ` (الأستاذ ${l.teachers.name})` : ''}`);
  }
  const subjectOf = new Map<string, string>((subjects ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));

  // ٢) الملف المقصود: من سياق العارض، وإلا الأكثر ظهوراً في النتائج
  let docId: string | null = ctxDoc && docMap.get(ctxDoc)?.is_published !== false ? ctxDoc : namedDoc;
  if (!docId) {
    const tally = new Map<string, number>();
    for (const c of relevant) if (c.source_type === 'document') tally.set(c.source_id, (tally.get(c.source_id) ?? 0) + c.similarity);
    docId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  // أي جزء مطلوب؟ صفحة مذكورة ← فصل مذكور (أو «الفصل» من داخل العارض) ← صفحة العارض الحالية كتلميح
  const explicitPage = parsePageRef(text);
  const chapterWord = /(فصل|باب|وحدة|كامل|موضوع|درس)/.test(text);
  // «اشرح الفصل/الموضوع» من داخل العارض يقصد الجزء الحالي كاملاً لا الصفحة وحدها
  const pageRef = explicitPage ?? (chapterWord ? null : ctx?.page ?? null);

  const direct: Item[] = [];
  const tree: OutlineNode[] = docId ? await outlineOf(docId) : [];
  const docMeta = docId ? docMap.get(docId) : undefined;
  if (docId && docMeta && docMeta.is_published !== false) {
    let from = 0;
    let to = 0;
    // الطالب قد يذكر الرقم المطبوع على الصفحة (من الكتاب الورقي) لا رقمها في الملف: نجلب الاثنين إن اختلفا
    const focusPages = new Set<number>();
    if (explicitPage) {
      const { data: hit } = await admin.from('document_pages').select('page').eq('document_id', docId).in('printed', printedVariants(explicitPage)).order('page').limit(1);
      const mapped = (hit?.[0] as { page: number } | undefined)?.page;
      if (mapped && mapped !== explicitPage) focusPages.add(mapped);
    }
    // جزء مذكور بالاسم أو الرقم يتقدم على ما يعرضه العارض (قد يسأل عن فصل آخر)
    const named = chapterWord && !pageRef ? pickSection(tree, text) : null;
    // «اشرح من صفحة ٤٥» (تكملة فصل طويل) ← من تلك الصفحة إلى نهاية فصلها
    const onward = explicitPage && /من\s*(?:ال)?(?:صفحة|صفحه|ص)\s*[:.]?\s*[0-9٠-٩]/.test(text);
    if (onward && explicitPage) {
      const ch = locate(tree, explicitPage).chapter;
      from = explicitPage; to = ch?.end_page ?? explicitPage + MAX_DIRECT_PAGES - 1;
      focusPages.clear(); // التكملة بترقيم الملف (كما يقترحه المساعد نفسه) وبالترتيب
    }
    else if (pageRef) { focusPages.add(pageRef); from = Math.max(1, pageRef - 1); to = pageRef + 1; }
    else if (named) { from = named.start; to = named.end; }
    else if (chapterWord && ctx?.page && /(موضوع|درس)/.test(text) && locate(tree, ctx.page).topic) {
      const t = locate(tree, ctx.page).topic!;
      from = t.start_page; to = t.end_page ?? t.start_page;
    }
    else if (chapterWord && ctx?.from && ctx?.to) { from = ctx.from; to = ctx.to; }
    else if (chapterWord && ctx?.page) {
      const ch = locate(tree, ctx.page).chapter;
      if (ch) { from = ch.start_page; to = ch.end_page ?? ch.start_page; }
      else { from = Math.max(1, ctx.page - 1); to = ctx.page + 1; }
    }
    if (from && to) {
      if (docMeta.pages) to = Math.min(to, docMeta.pages);
      const focus = onward ? 0 : pageRef ?? 0;
      // فصل كبير: نبدأ من أوله ونكتفي بعدد صفحات معقول
      const fullTo = to;
      if (to - from + 1 > MAX_DIRECT_PAGES) to = from + MAX_DIRECT_PAGES - 1;
      const wanted = new Set<number>();
      for (let n = from; n <= to; n++) wanted.add(n);
      for (const f of focusPages) for (const n of [f - 1, f, f + 1]) if (n >= 1 && (!docMeta.pages || n <= docMeta.pages)) wanted.add(n);
      const { data } = await admin.from('document_pages').select('page, printed, text').eq('document_id', docId).in('page', [...wanted]).order('page');
      for (const p of (data ?? []) as PageRow[]) {
        if (!p.text?.trim()) continue;
        const where = locate(tree, p.page);
        direct.push({
          kind: 'document', text: p.text, title: docMeta.title, subject: subjectOf.get(docMeta.subject_id), documentId: docId,
          page: p.page, printed: p.printed, chapter: where.chapter?.title, topic: where.topic?.title, direct: true,
          // الصفحة المطلوبة نفسها تأتي أولاً
        });
      }
      if (fullTo > to && direct.length) {
        direct[0].note = `الجزء المطلوب يمتد من صفحة ${from} إلى ${fullTo}، وأُرفقت الصفحات ${from}–${to} فقط. اشرحها كاملة ثم اختم بأن الطالب يكمل بطلب «اشرح من صفحة ${to + 1}».`;
      }
      if (focus) direct.sort((a, b) => Number(focusPages.has(b.page ?? 0)) - Number(focusPages.has(a.page ?? 0)) || (a.page ?? 0) - (b.page ?? 0));
    }
  }

  // ٣) نتائج البحث الدلالي (بدون ما سبق)
  const have = new Set(direct.map((d) => `${d.documentId}:${d.page}`));
  const semantic: Item[] = [];
  const extraTrees = new Map<string, OutlineNode[]>(docId ? [[docId, tree]] : []);
  for (const c of relevant) {
    if (c.source_type === 'document') {
      if (have.has(`${c.source_id}:${c.page}`)) continue;
      const meta = docMap.get(c.source_id);
      if (meta && meta.is_published === false) continue;
      if (!extraTrees.has(c.source_id)) extraTrees.set(c.source_id, await outlineOf(c.source_id));
      const where = locate(extraTrees.get(c.source_id)!, c.page ?? 0);
      semantic.push({
        kind: 'document', text: c.content, title: meta?.title ?? 'المنهج', subject: subjectOf.get(c.subject_id), documentId: c.source_id,
        page: c.page ?? undefined, chapter: where.chapter?.title, topic: where.topic?.title,
      });
    } else if (c.source_type === 'lecture') {
      semantic.push({ kind: 'lecture', text: c.content, title: titleOf.get(c.source_id) ?? 'محاضرة', subject: subjectOf.get(c.subject_id), lectureId: c.source_id, start: c.start_sec ?? 0 });
    } else {
      semantic.push({ kind: 'question_set', text: c.content, title: titleOf.get(c.source_id) ?? 'أسئلة', subject: subjectOf.get(c.subject_id), page: c.page ?? undefined });
    }
  }

  // الرقم المطبوع للصفحات التي جاءت من البحث الدلالي
  const needPrinted = semantic.filter((s) => s.documentId && s.page);
  if (needPrinted.length) {
    const byDoc = new Map<string, number[]>();
    for (const s of needPrinted) byDoc.set(s.documentId!, [...(byDoc.get(s.documentId!) ?? []), s.page!]);
    for (const [d, pages] of byDoc) {
      const { data } = await admin.from('document_pages').select('page, printed').eq('document_id', d).in('page', pages);
      const pr = new Map(((data ?? []) as { page: number; printed: string | null }[]).map((r) => [r.page, r.printed]));
      for (const s of needPrinted) if (s.documentId === d) s.printed = pr.get(s.page!) ?? null;
    }
  }

  // ٤) حد الحجم: المباشر أولاً ثم الدلالي
  const out: Item[] = [];
  let size = 0;
  for (const it of [...direct, ...semantic]) {
    if (size + it.text.length > MAX_CHARS && out.length) break;
    out.push(it);
    size += it.text.length;
  }
  return out;
}
