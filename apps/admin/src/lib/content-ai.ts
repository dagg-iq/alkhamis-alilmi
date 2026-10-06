import { callFunction, must, supabase } from './supabase';

/** فهرسة محاضرة بالدقيقة: جزء ٢٠ دقيقة في كل طلب حتى النهاية */
export async function indexLecture(lectureId: string, onProgress?: (done: number, total: number) => void) {
  let segment = 0;
  for (;;) {
    const r = await callFunction<{ done: boolean; next: number | null; segments: number; topics: number }>('content-ai', {
      action: 'index_lecture', lectureId, segment,
    });
    onProgress?.(segment + 1, r.segments);
    if (r.done || r.next === null) return;
    segment = r.next;
  }
}

/** فهرسة ملزمة للمساعد: ١٠ صفحات في كل طلب حتى النهاية */
export async function ingestDocument(documentId: string, onProgress?: (done: number, total: number) => void) {
  let first = true;
  for (;;) {
    const r = await callFunction<{ done: boolean; ingested: number; pages: number }>('ingest', { documentId, restart: first });
    first = false;
    onProgress?.(r.ingested, r.pages);
    if (r.done) return;
  }
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
