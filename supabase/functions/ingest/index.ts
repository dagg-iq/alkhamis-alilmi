// فهرسة ملزمة PDF للمساعد الذكي: ١٠ صفحات في كل استدعاء
// لوحة التحكم تستدعيها بشكل متكرر حتى تُرجع done = true
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { chunkText, embed, generate, GeminiQuotaError, parseJson, uploadFile } from '../_shared/gemini.ts';
import { getObject } from '../_shared/storage.ts';

const BATCH = 10;

Deno.serve(handler(async (req) => {
  await getCaller(req, { staff: true });
  const { documentId, restart } = await req.json();
  const { data: doc } = await admin.from('documents').select('*').eq('id', documentId).single();
  if (!doc) throw new HttpError(404, 'الملف غير موجود.');

  if (restart) {
    await admin.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id);
    doc.ingested_pages = 0;
  }

  let fileUri: string | null = doc.gemini_file_uri;
  let pages: number | null = doc.pages;
  const expired = !doc.gemini_file_expires_at || new Date(doc.gemini_file_expires_at) < new Date(Date.now() + 3600_000);
  if (!fileUri || expired || !pages) {
    const bytes = await getObject(doc.file_key);
    if (!pages) {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      pages = pdf.getPageCount();
    }
    fileUri = await uploadFile(bytes, 'application/pdf', doc.title);
    await admin.from('documents').update({
      gemini_file_uri: fileUri,
      gemini_file_expires_at: new Date(Date.now() + 47 * 3600_000).toISOString(),
      pages,
    }).eq('id', doc.id);
  }

  const from = (doc.ingested_pages ?? 0) + 1;
  if (from > pages!) {
    await admin.from('documents').update({ ingest_status: 'done', ingest_error: null }).eq('id', doc.id);
    return json({ done: true, ingested: pages, pages });
  }
  const to = Math.min(from + BATCH - 1, pages!);
  await admin.from('documents').update({ ingest_status: 'running', ingest_error: null }).eq('id', doc.id);

  try {
    const ai = await getSetting<{ lite_model?: string }>('ai');
    const raw = await generate(ai.lite_model ?? 'gemini-2.5-flash-lite', [{
      role: 'user',
      parts: [
        { file_data: { mime_type: 'application/pdf', file_uri: fileUri! } },
        {
          text: `انسخ نص الصفحات من ${from} إلى ${to} من هذا الملف (ترقيم صفحات ملف PDF وليس المطبوع).
أعد JSON فقط بالشكل: [{"page": رقم, "text": "النص"}]
- اكتب المعادلات بـ LaTeX بين $...$.
- صف الأشكال المهمة باختصار بين [شكل: ...].
- تجاهل الزخارف وأرقام الهواتف والإعلانات.`,
        },
      ],
    }], { json: true, temperature: 0, maxOutputTokens: 32768 });

    const pagesText = parseJson<{ page: number; text: string }[]>(raw);
    const rows: { page: number; content: string }[] = [];
    for (const p of pagesText) {
      for (const c of chunkText(p.text ?? '')) rows.push({ page: p.page, content: c });
    }
    if (rows.length) {
      const vectors = await embed(rows.map((r) => r.content), 'RETRIEVAL_DOCUMENT');
      const { error } = await admin.from('content_chunks').insert(rows.map((r, i) => ({
        source_type: 'document',
        source_id: doc.id,
        subject_id: doc.subject_id,
        chapter_id: doc.chapter_id,
        page: r.page,
        content: r.content,
        embedding: vectors[i],
      })));
      if (error) throw error;
    }
    const done = to >= pages!;
    await admin.from('documents').update({ ingested_pages: to, ingest_status: done ? 'done' : 'running' }).eq('id', doc.id);
    return json({ done, ingested: to, pages, chunks: rows.length });
  } catch (e) {
    const msg = e instanceof GeminiQuotaError ? 'انتهى رصيد Gemini المجاني مؤقتاً، أكمل لاحقاً.' : String((e as Error).message ?? e).slice(0, 300);
    await admin.from('documents').update({ ingest_status: 'error', ingest_error: msg }).eq('id', doc.id);
    throw new HttpError(e instanceof GeminiQuotaError ? 503 : 500, msg);
  }
}));
