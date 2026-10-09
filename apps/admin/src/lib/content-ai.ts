import { callFunction, must, signedUrl, supabase } from './supabase';

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
 * فهرسة كتاب أو ملزمة للمساعد، ثم بناء فهرس الفصول والمواضيع.
 * اللوحة تقطع من الكتاب صفحات قليلة (٦–٨) وترسلها وحدها — بدل أن يُرسل الكتاب كاملاً مع كل طلب — فتكون أسرع بكثير،
 * وتقرأ ٣ دفعات معاً، وتكمل دائماً من الصفحات الناقصة فقط (لا تعيد من البداية).
 * stage: 'pages' أثناء القراءة، 'outline' أثناء بناء الفهرس.
 */
export async function ingestDocument(
  documentId: string,
  onProgress?: (done: number, total: number, stage: 'pages' | 'outline') => void,
  restart = false,
) {
  const doc = await must(supabase.from('documents').select('id, file_key').eq('id', documentId).single()) as { id: string; file_key: string };
  if (restart) await callFunction('ingest', { documentId, action: 'restart' });

  // الكتاب نفسه (مرة واحدة) ← عدد صفحاته
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

  // دفعات من صفحات متتالية: ٨ للملفات الخفيفة، و٤ للمصوّرة الثقيلة
  const avgPage = buf.byteLength / Math.max(1, total);
  const size = avgPage > 400_000 ? 4 : avgPage > 150_000 ? 6 : 8;
  const batches: number[][] = [];
  for (const n of missing) {
    const b = batches[batches.length - 1];
    if (b && b[b.length - 1] === n - 1 && b.length < size) b.push(n); else batches.push([n]);
  }

  let done = have.size;
  onProgress?.(done, total, 'pages');
  let stop: Error | null = null;
  const failed: number[] = [];
  const toB64 = (u8: Uint8Array) => {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const runBatch = async (pages: number[]) => {
    const sub = await PDFDocument.create();
    (await sub.copyPages(src, pages.map((n) => n - 1))).forEach((pg) => sub.addPage(pg));
    const pdf = toB64(await sub.save());
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await callFunction<{ read: number[] }>('ingest', { documentId, action: 'read', from: pages[0], to: pages[pages.length - 1], total, pdf });
        done += r.read.length;
        onProgress?.(Math.min(done, total), total, 'pages');
        if (r.read.length < pages.length) failed.push(...pages.filter((n) => !r.read.includes(n)));
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // انتهت الحصة على كل المفاتيح: نتوقف كلنا (ونكمل لاحقاً من حيث وقفنا)
        if (/حصة|رصيد|quota/i.test(msg) || attempt === 1) { stop ??= new Error(msg); return; }
      }
    }
  };
  // ٣ دفعات في الوقت نفسه
  const queue = [...batches];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length && !stop) await runBatch(queue.shift()!);
  }));
  if (stop) throw stop;
  if (failed.length) throw new Error(`تعذّرت قراءة ${failed.length} صفحة (${failed.slice(0, 8).join('، ')}${failed.length > 8 ? '…' : ''}). اضغط «إكمال» لإعادة محاولة الناقصة فقط.`);
  onProgress?.(1, 1, 'outline');
  const out = await buildDocumentOutline(documentId);
  // الربط بين الكتاب والملازم (طلب منفصل؛ فشله لا يمنع الفهرس)
  await embedDocumentOutline(documentId).catch(() => {});
  return out;
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
