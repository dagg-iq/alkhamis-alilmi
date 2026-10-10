import { callFunction, must, signedUrl, supabase, uploadFile } from './supabase';

/** فهرسة محاضرة بالدقيقة: جزء ١٠ دقائق في كل طلب حتى النهاية */
export async function indexLecture(lectureId: string, onProgress?: (done: number, total: number | null) => void) {
  let segment = 0;
  for (;;) {
    onProgress?.(segment + 1, null);
    const r = await callFunction<{ done: boolean; next: number | null; segments: number | null; topics: number }>('content-ai', {
      action: 'index_lecture', lectureId, segment,
    });
    onProgress?.(segment + 1, r.segments);
    if (r.done || r.next === null) return;
    segment = r.next;
  }
}

/** يبني فهرس الفصول والمواضيع من الصفحات المقروءة */
export async function buildDocumentOutline(documentId: string) {
  return callFunction<{ done: boolean; chapters: number; topics: number }>('ingest', { documentId, action: 'outline' });
}

/** يحسب متجهات عناوين الفهرس المعدَّلة يدوياً (للربط بين الكتاب والملازم) */
export async function embedDocumentOutline(documentId: string) {
  return callFunction<{ done: boolean; embedded: number }>('ingest', { documentId, action: 'embed_outline' });
}

/**
 * إدخال كتاب أو ملزمة في طابور الفهرسة على الخادم (يكمل ولو أُغلق الموقع).
 * اللوحة تحمّل الكتاب مرة وتقطع صفحاته الناقصة فقط إلى أجزاء صغيرة (٤–٨ صفحات) وترفعها،
 * ثم عامل الخادم (ingest-worker، كل دقيقة) يقرؤها بعدة مفاتيح معاً، يعيد أي جزء يفشل، وينتظر تجدد الحصة إن انتهت،
 * ثم يبني فهرس الفصول والمواضيع وينتقل للكتاب التالي في الطابور.
 * الصفحة يجب أن تبقى مفتوحة أثناء التحضير فقط (ثوانٍ إلى دقيقة).
 */
export async function enqueueDocument(
  documentId: string,
  onProgress?: (done: number, total: number) => void,
  restart = false,
) {
  const doc = await must(supabase.from('documents').select('id, file_key').eq('id', documentId).single()) as { id: string; file_key: string };
  // أجزاء قديمة (فاشلة أو من محاولة سابقة) تُحذف أولاً؛ وإعادة القراءة تمسح الصفحات أيضاً
  await callFunction('ingest', { documentId, action: restart ? 'restart' : 'clear_queue' });

  const { PDFDocument } = await import('pdf-lib');
  const res = await fetch(await signedUrl(doc.file_key));
  if (!res.ok) throw new Error('تعذّر تحميل الملف من التخزين');
  const buf = await res.arrayBuffer();
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();

  // الصفحات المقروءة سابقاً ← الناقصة فقط
  const have = new Set(((await must(supabase.from('document_pages').select('page').eq('document_id', documentId))) as { page: number }[]).map((r) => r.page));
  const missing: number[] = [];
  for (let n = 1; n <= total; n++) if (!have.has(n)) missing.push(n);

  // أجزاء من صفحات متتالية: ٨ للملفات الخفيفة، و٤ للمصوّرة الثقيلة
  const avgPage = buf.byteLength / Math.max(1, total);
  const size = avgPage > 400_000 ? 4 : avgPage > 150_000 ? 6 : 8;
  // صفحات ثقيلة = غالباً مصوّرة (ماسح ضوئي): تُقرأ من الصورة بتفكير أكثر (المعادلات والجداول)
  const scanned = avgPage > 60_000;
  const batches: number[][] = [];
  for (const n of missing) {
    const b = batches[batches.length - 1];
    if (b && b[b.length - 1] === n - 1 && b.length < size) b.push(n); else batches.push([n]);
  }

  // تقطيع ورفع (٤ معاً)
  const rows: { document_id: string; from_page: number; to_page: number; total_pages: number; file_key: string; scanned: boolean }[] = [];
  let done = 0;
  onProgress?.(0, batches.length);
  const queue = [...batches];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const pages = queue.shift()!;
      const sub = await PDFDocument.create();
      (await sub.copyPages(src, pages.map((n) => n - 1))).forEach((pg) => sub.addPage(pg));
      const bytes = await sub.save();
      const file = new File([bytes as Uint8Array<ArrayBuffer>], `part-${pages[0]}.pdf`, { type: 'application/pdf' });
      let key = '';
      for (let attempt = 0; ; attempt++) {
        try { key = await uploadFile(file, 'material'); break; } catch (e) { if (attempt >= 2) throw e; }
      }
      rows.push({ document_id: documentId, from_page: pages[0], to_page: pages[pages.length - 1], total_pages: total, file_key: key, scanned });
      onProgress?.(++done, batches.length);
    }
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('ingest_chunks').insert(rows.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  // الآن فقط يدخل الطابور (بعد اكتمال كل أجزائه) — ترتيب الدخول = ترتيب الفهرسة
  const { error } = await supabase.from('documents').update({
    queued_at: new Date().toISOString(), pages: total, ingest_status: 'running', ingest_error: null,
  }).eq('id', documentId);
  if (error) throw new Error(error.message);
  return { chunks: rows.length, missing: missing.length, total };
}

/** إيقاف فهرسة كتاب (إخراجه من الطابور؛ الصفحات المقروءة تبقى) */
export async function dequeueDocument(documentId: string) {
  await callFunction('ingest', { documentId, action: 'clear_queue' });
}

/** يوقظ عامل الفهرسة الآن بدل انتظار الدقيقة القادمة */
export function kickIngestWorker() {
  return callFunction('ingest-worker', {}).catch(() => {});
}

/** أساتذة جدد بالاسم (إن لم يوجدوا) ← خريطة الاسم إلى المعرّف */
export async function ensureTeachers(names: { name: string; subject_id: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const existing = await must(supabase.from('teachers').select('id, name')) as { id: string; name: string }[];
  for (const t of existing) out.set(t.name.trim(), t.id);
  for (const n of names) {
    const name = n.name.trim();
    if (!name || out.has(name)) continue;
    const row = await must(supabase.from('teachers').insert({ name, subject_id: n.subject_id }).select('id').single()) as { id: string };
    out.set(name, row.id);
  }
  return out;
}

/** فصل جديد في أول كتاب للمادة (أو الموجود بنفس الرقم) */
export async function ensureChapter(subjectId: string, number: number, title: string): Promise<string> {
  const books = await must(supabase.from('books').select('id').eq('subject_id', subjectId).order('sort')) as { id: string }[];
  let bookId = books[0]?.id;
  if (!bookId) {
    const b = await must(supabase.from('books').insert({ subject_id: subjectId, name: 'الكتاب', sort: 1 }).select('id').single()) as { id: string };
    bookId = b.id;
  }
  const same = await must(supabase.from('chapters').select('id').in('book_id', books.map((b) => b.id).concat(bookId)).eq('number', number)) as { id: string }[];
  if (same[0]) return same[0].id;
  const c = await must(supabase.from('chapters').insert({ book_id: bookId, number, title, sort: number }).select('id').single()) as { id: string };
  return c.id;
}
