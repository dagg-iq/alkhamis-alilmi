// فهرسة الكتب والملازم للمساعد الذكي:
//  - قراءة الصفحات (٦ في كل استدعاء): نص + الرقم المطبوع + عناوين كل صفحة ← مقاطع بحث و document_pages
//  - action: 'outline' ← بناء فهرس الفصول والمواضيع (document_outline) من العناوين المقروءة
// لوحة التحكم تستدعيها بشكل متكرر حتى done = true ثم تستدعي outline.
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import {
  collapseHeadings, fallbackOutline, flattenOutline, headingLines, normalizeOutline, outlineFromHeadings, type OutlineChapter,
} from '../_shared/outline.ts';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { buildOutline, embedOutline, READ_PROMPT, readInline, storePages, type ReadPage } from '../_shared/ingest-core.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { deleteObject } from '../_shared/storage.ts';
import { chunkText, embed, GeminiTimeoutError, toBase64, fileRef, firstAvailableSlot, generate, poolSlots, slotRank, strongestSlot, GeminiQuotaError, parseJson, uploadFile, MAIN_MODELS, modelChain } from '../_shared/gemini.ts';
import { getObject } from '../_shared/storage.ts';

// الفهرسة تُنفَّذ مرة واحدة للكتاب، فنفضّل الجودة: صفحات أقل في الطلب الواحد وأقوى نموذج متاح وصور بدقة عالية
const BATCH = 6;

type AiSettings = { model?: string; ingest_model?: string };

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
    // المفتاح الذي عنده أقوى نموذج متاح الآن (الفهرسة تستحق أفضل جودة)
    const best = await strongestSlot('admin', chain);
    const target = best && !exclude.includes(best.slot) ? best.slot : await firstAvailableSlot('admin', chain, exclude);
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
  // الملف على مفتاح نماذجه القوية انتهت ومفتاح آخر ما زال عنده نموذج أقوى ← ننقله (رفع الملف لا يُحسب من الحصة)
  const cur = stale ? null : await slotRank(slotOf(fileUri)!, chain);
  const best = await strongestSlot('admin', chain);
  if (stale || cur === null || (best && best.rank < cur)) await reupload([]);

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

/** يُخرج الكتاب من طابور الفهرسة ويحذف أجزاءه المقطوعة (وملفاتها) */
async function clearQueue(docId: string) {
  const { data } = await admin.from('ingest_chunks').select('id, file_key').eq('document_id', docId);
  for (const c of (data ?? []) as { id: string; file_key: string }[]) await deleteObject(c.file_key).catch(() => {});
  await admin.from('ingest_chunks').delete().eq('document_id', docId);
  await admin.from('documents').update({ queued_at: null }).eq('id', docId);
}

Deno.serve(handler(async (req) => {
  await getCaller(req, { staff: true });
  const body = await req.json();
  const { documentId, restart, action } = body;
  const { data: doc } = await admin.from('documents').select('*').eq('id', documentId).single();
  if (!doc) throw new HttpError(404, 'الملف غير موجود.');
  if (action === 'outline') return json(await buildOutline(doc));
  // الطريقة الجديدة: لوحة التحكم تقطع صفحات قليلة من الكتاب وترسلها (لا رفع للكتاب كاملاً ولا ارتباط بمفتاح)
  if (action === 'clear_queue') {
    await clearQueue(doc.id);
    return json({ ok: true });
  }
  if (action === 'restart') {
    await clearQueue(doc.id);
    await admin.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id);
    await admin.from('document_pages').delete().eq('document_id', doc.id);
    await admin.from('document_outline').delete().eq('document_id', doc.id);
    await admin.from('documents').update({ ingested_pages: 0, ingest_status: 'running', ingest_error: null, outline_status: 'none', outline_error: null }).eq('id', doc.id);
    return json({ ok: true });
  }
  if (action === 'read') {
    const from = Math.round(Number(body.from));
    const to = Math.round(Number(body.to));
    const total = Math.round(Number(body.total));
    if (!(from >= 1 && to >= from && to - from < 20 && total >= to) || typeof body.pdf !== 'string') throw new HttpError(400, 'طلب قراءة غير صحيح.');
    const started = Date.now();
    try {
      const lane = Number.isInteger(body.lane) ? Number(body.lane) : undefined;
      const read = await readInline(body.pdf, from, to, started + 110_000, lane, body.scanned === true);
      return json({ ...(await storePages(doc, read, total)), read: read.map((p) => p.page) });
    } catch (e) {
      const msg = e instanceof GeminiQuotaError ? `انتهت حصة Gemini على كل المفاتيح${e.message.includes('حتى') ? ` (${e.message.match(/حتى .+$/)?.[0]})` : ''}. اضغط «إكمال» بعدها ويكمل من حيث توقف.` : String((e as Error).message ?? e).slice(0, 300);
      await admin.from('documents').update({ ingest_status: 'error', ingest_error: msg }).eq('id', doc.id);
      throw new HttpError(e instanceof GeminiQuotaError ? 503 : 500, msg);
    }
  }
  if (action === 'embed_outline') return json(await embedOutline(doc));
  return await ingestBatch(doc, !!restart);
}));
