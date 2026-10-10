import {
  DOCUMENT_KIND_LABELS, type Book, type Chapter, type DocumentKind, type DocumentRow, type Subject, type Teacher,
} from '@saey/shared';
import { useEffect, useState } from 'react';
import { askConfirm } from '../components/dialog';
import { Empty, Field, Modal, check, useAction, useToast } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { OutlineEditor } from '../components/OutlineEditor';
import { dequeueDocument, enqueueDocument, kickIngestWorker } from '../lib/content-ai';
import { must, signedUrl, supabase, uploadFile } from '../lib/supabase';

interface ChunkRow { document_id: string; status: 'pending' | 'running' | 'done' | 'failed'; from_page: number; to_page: number; next_at: string; last_error: string | null }

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit' });

interface Draft { file: File | null; subject_id: string; chapter_id: string; teacher_id: string; kind: DocumentKind; title: string }

export default function Documents() {
  const { run, busy } = useAction();
  const toast = useToast();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [ingesting, setIngesting] = useState<Record<string, string>>({});
  const [outlineOf, setOutlineOf] = useState<DocumentRow | null>(null);

  const q = useLoad(async () => {
    const [subjects, books, chapters, teachers, docs] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('books').select('*')),
      must(supabase.from('chapters').select('*').order('sort').order('number')),
      must(supabase.from('teachers').select('*').order('name')),
      must(supabase.from('documents').select('*').order('sort').order('created_at')),
    ]);
    const chunks = await must(supabase.from('ingest_chunks').select('document_id, status, from_page, to_page, next_at, last_error')) as ChunkRow[];
    return { subjects: subjects as Subject[], books: books as Book[], chapters: chapters as Chapter[], teachers: teachers as Teacher[], docs: docs as DocumentRow[], chunks };
  });
  const d = q.data;
  const queued = (d?.docs ?? []).filter((x) => x.queued_at).sort((a, b) => a.queued_at!.localeCompare(b.queued_at!));
  // أثناء الفهرسة على الخادم: تحديث الحالة كل ١٥ ثانية
  useEffect(() => {
    if (!queued.length) return;
    const t = setInterval(() => q.reload(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued.length]);

  /** حالة الكتاب في الطابور: ترتيبه، الأجزاء المقروءة، وهل ينتظر الحصة */
  const queueInfo = (doc: DocumentRow) => {
    const mine = (d?.chunks ?? []).filter((c) => c.document_id === doc.id);
    const pos = queued.findIndex((x) => x.id === doc.id);
    const left = mine.filter((c) => c.status === 'pending' || c.status === 'running');
    const doneParts = mine.filter((c) => c.status === 'done').length;
    const running = mine.some((c) => c.status === 'running');
    const now = Date.now();
    const waitingQuota = !running && left.length > 0 && left.every((c) => new Date(c.next_at).getTime() > now) && left.some((c) => /حصة/.test(c.last_error ?? ''));
    const nextAt = left.map((c) => c.next_at).sort()[0];
    return { pos, total: mine.length, doneParts, left: left.length, running, waitingQuota, nextAt };
  };
  const active = subjectId ?? d?.subjects[0]?.id ?? null;
  const chaptersOf = (sid: string) => (d?.chapters ?? []).filter((c) => d!.books.some((b) => b.id === c.book_id && b.subject_id === sid));
  const chapterLabel = (id: string | null) => {
    const c = d?.chapters.find((x) => x.id === id);
    return c ? `الفصل ${c.number}` : 'المادة كاملة';
  };

  const save = () => run(async () => {
    if (!draft?.file) throw new Error('اختر ملف PDF');
    if (draft.file.type !== 'application/pdf') throw new Error('الملف يجب أن يكون PDF');
    if (!draft.title.trim()) throw new Error('اكتب عنوان الملزمة');
    setUpload(0);
    const key = await uploadFile(draft.file, 'material', setUpload);
    await check(supabase.from('documents').insert({
      subject_id: draft.subject_id, chapter_id: draft.chapter_id || null, teacher_id: draft.teacher_id || null,
      kind: draft.kind, title: draft.title.trim(), file_key: key, size_bytes: draft.file.size,
      sort: (d?.docs.filter((x) => x.subject_id === draft.subject_id).length ?? 0) + 1,
    }));
    setUpload(null);
    setDraft(null);
    await q.reload();
  }, 'رُفع الملف').finally(() => setUpload(null));

  // إدخال كتاب في طابور الفهرسة على الخادم (التحضير فقط في المتصفح، والباقي على الخادم ولو أُغلق الموقع)
  const prepare = async (doc: DocumentRow, restart = false) => {
    setIngesting((s) => ({ ...s, [doc.id]: 'تحضير…' }));
    try {
      const r = await enqueueDocument(doc.id, (n, total) => setIngesting((s) => ({ ...s, [doc.id]: `تحضير ${n}/${total}` })), restart);
      return r;
    } finally {
      setIngesting((s) => {
        const n = { ...s };
        delete n[doc.id];
        return n;
      });
    }
  };

  const ingest = async (doc: DocumentRow, restart = false) => {
    try {
      await prepare(doc, restart);
      kickIngestWorker();
      toast('دخل الطابور — الفهرسة تجري على الخادم الآن، ويمكنك إغلاق الموقع');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذّر تحضير الملف', true);
    } finally {
      q.reload();
    }
  };

  // «فهرسة الكل»: كل الكتب غير المفهرسة في كل المواد، بالترتيب (المادة ثم ترتيب الملف)
  const [all, setAll] = useState<string | null>(null);
  const ingestAll = async () => {
    if (!d) return;
    const order = new Map(d.subjects.map((s, i) => [s.id, i]));
    const todo = d.docs
      .filter((x) => !x.queued_at && (x.ingest_status !== 'done' || (x.outline_status ?? 'none') !== 'done'))
      .sort((a, b) => (order.get(a.subject_id) ?? 0) - (order.get(b.subject_id) ?? 0) || a.sort - b.sort);
    if (!todo.length) { toast('كل الكتب مفهرسة أو في الطابور'); return; }
    if (!(await askConfirm(`فهرسة ${todo.length} ملف بالترتيب على الخادم؟ أبقِ الصفحة مفتوحة حتى ينتهي التحضير (دقيقة تقريباً لكل كتاب)، ثم يمكنك إغلاق الموقع.`))) return;
    const failed: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      setAll(`تحضير ${i + 1}/${todo.length}: ${todo[i].title}`);
      try {
        await prepare(todo[i]);
        if (i === 0) kickIngestWorker(); // يبدأ الأول بينما تُحضَّر البقية
      } catch (e) {
        failed.push(`${todo[i].title}: ${e instanceof Error ? e.message : 'خطأ'}`);
      }
      await q.reload();
    }
    setAll(null);
    kickIngestWorker();
    if (failed.length) toast(`تعذّر تحضير ${failed.length}: ${failed.join(' — ')}`, true);
    else toast(`دخلت ${todo.length} ملفات الطابور — الفهرسة تجري على الخادم بالترتيب، ويمكنك إغلاق الموقع`);
  };

  const stop = async (doc: DocumentRow) => (await askConfirm(`إيقاف فهرسة «${doc.title}»؟ الصفحات المقروءة تبقى، و«إكمال» يكمل الناقص فقط.`)) && run(async () => {
    await dequeueDocument(doc.id);
    await q.reload();
  }, 'أُوقفت');

  const remove = async (doc: DocumentRow) => (await askConfirm(`حذف «${doc.title}»؟`)) && run(async () => {
    await check(supabase.from('content_chunks').delete().eq('source_type', 'document').eq('source_id', doc.id));
    await check(supabase.from('documents').delete().eq('id', doc.id));
    await q.reload();
  }, 'تم الحذف');

  if (!d) return <><div className="head"><h1>الكتب والملازم</h1></div><Empty>جارٍ التحميل…</Empty></>;
  const list = d.docs.filter((x) => x.subject_id === active);

  return (
    <>
      <div className="head">
        <h1>الكتب والملازم</h1>
        <div className="row">
          {queued.length ? <button className="btn sm" onClick={() => run(async () => { await kickIngestWorker(); await q.reload(); }, 'أُوقظ عامل الفهرسة')}>ابدأ الآن</button> : null}
          <button className="btn" disabled={!!all} onClick={ingestAll}>{all ? 'جارٍ التحضير…' : 'فهرسة الكل'}</button>
          <button className="btn primary" onClick={() => setDraft({ file: null, subject_id: active!, chapter_id: '', teacher_id: '', kind: 'malzama', title: '' })}>+ رفع كتاب أو ملزمة</button>
        </div>
      </div>
      {all ? <div className="card small" style={{ marginBottom: 12 }}>{all} — أبقِ الصفحة مفتوحة حتى ينتهي التحضير، ثم يمكنك إغلاقها.</div> : null}
      {queued.length ? (
        <div className="card small" style={{ marginBottom: 12 }}>
          <b>طابور الفهرسة على الخادم ({queued.length})</b> — يعمل تلقائياً كل دقيقة ولو أُغلق الموقع، كتاباً بعد كتاب:{' '}
          {queued.map((x, i) => `${i + 1}. ${x.title}`).join('  ·  ')}
        </div>
      ) : null}
      <div className="tabs">
        {d.subjects.map((s) => <button key={s.id} className={s.id === active ? 'on' : ''} onClick={() => setSubjectId(s.id)}>{s.name}</button>)}
      </div>
      {list.length === 0 ? <Empty>لا توجد ملازم لهذه المادة بعد.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الكتاب / الملزمة</th><th>الفصل</th><th>الحجم</th><th>المساعد الذكي</th><th /></tr></thead>
            <tbody>
              {list.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <b>{doc.title}</b>
                    <div className="small dim">{DOCUMENT_KIND_LABELS[doc.kind]}{doc.teacher_id ? ` · ${d.teachers.find((t) => t.id === doc.teacher_id)?.name ?? ''}` : ''}</div>
                  </td>
                  <td>{chapterLabel(doc.chapter_id)}</td>
                  <td className="num small">{doc.size_bytes ? `${(doc.size_bytes / 1048576).toFixed(1)} MB` : '—'}{doc.pages ? ` · ${doc.pages} ص` : ''}</td>
                  <td>
                    {ingesting[doc.id] ? <span className="pill accent">{ingesting[doc.id]}</span>
                      : doc.queued_at ? (() => {
                        const qi = queueInfo(doc);
                        return (
                          <>
                            <span className="pill accent">
                              {qi.left === 0 ? 'يبني الفهرس…' : qi.waitingQuota ? 'ينتظر تجدد حصة Gemini' : qi.pos > 0 && !qi.running ? `في الطابور (${qi.pos + 1})` : 'يُفهرس على الخادم'}
                            </span>
                            <div className="small dim" style={{ marginTop: 4 }}>
                              {doc.ingested_pages}/{doc.pages ?? '?'} صفحة · {qi.doneParts}/{qi.total} جزء
                              {qi.waitingQuota && qi.nextAt ? ` · يعاود ${hhmm(qi.nextAt)}` : ''}
                            </div>
                          </>
                        );
                      })()
                      : doc.ingest_status === 'done' ? (doc.outline_status === 'done' ? <span className="pill ok">مفهرسة + فهرس</span> : <span className="pill warn" title={doc.outline_error ?? ''}>مقروءة — الفهرس غير جاهز</span>)
                        : doc.ingest_status === 'error' ? <span className="pill bad" title={doc.ingest_error ?? ''}>خطأ — أعد المحاولة</span>
                          : doc.ingest_status === 'running' ? <span className="pill warn">ناقصة ({doc.ingested_pages}/{doc.pages ?? '?'})</span>
                            : <span className="pill">غير مفهرسة</span>}
                    {!ingesting[doc.id] && !doc.queued_at && (doc.ingest_error || doc.outline_error) ? <div className="small" style={{ color: 'var(--bad)', marginTop: 4, maxWidth: 260 }}>{doc.ingest_error ?? doc.outline_error}</div> : null}
                    {!ingesting[doc.id] && !doc.queued_at && doc.ingest_status === 'done' && doc.outline_status !== 'done' ? <div className="small dim" style={{ marginTop: 4, maxWidth: 260 }}>اضغط «الفهرس» ثم «إعادة البناء بالذكاء الاصطناعي».</div> : null}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button className="btn sm" onClick={() => run(async () => { window.open(await signedUrl(doc.file_key), '_blank'); })}>فتح</button>
                      {!ingesting[doc.id] && !doc.queued_at && doc.ingest_status !== 'done' ? <button className="btn primary sm" disabled={!!all} onClick={() => ingest(doc)}>{doc.ingest_status === 'none' ? 'فهرسة' : 'إكمال'}</button> : null}
                      {doc.queued_at ? <button className="btn ghost sm" onClick={() => stop(doc)}>إيقاف</button> : null}
                      {doc.ingest_status === 'done' ? <button className="btn sm primary" onClick={() => setOutlineOf(doc)}>الفهرس</button> : null}
                      {!ingesting[doc.id] && !doc.queued_at && doc.ingest_status === 'done' ? <button className="btn ghost sm" onClick={async () => (await askConfirm('إعادة قراءة كل صفحات الملف من جديد؟ (تستهلك من رصيد Gemini)')) && ingest(doc, true)}>إعادة القراءة</button> : null}
                      <button className="btn sm" onClick={() => run(async () => { await check(supabase.from('documents').update({ is_published: !doc.is_published }).eq('id', doc.id)); await q.reload(); })}>
                        {doc.is_published ? 'إخفاء' : 'نشر'}
                      </button>
                      <button className="btn danger sm" onClick={() => remove(doc)}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small dim">«الفهرسة» تجعل المساعد الذكي يقرأ الملف ويجيب منه مع ذكر الصفحة، وتبني فهرس الفصول والمواضيع. تجري على الخادم: اللوحة تقطع الصفحات الناقصة فقط (دقيقة تقريباً) ثم يمكنك إغلاق الموقع — الخادم يقرأ كل دقيقة بعدة مفاتيح معاً، الكتب بالترتيب، يعيد أي جزء يفشل تلقائياً، وإن انتهت حصة Gemini ينتظر تجددها (٣ فجراً) ويكمل وحده. «فهرسة الكل» تضع كل الملفات غير المفهرسة في الطابور. زر «الفهرس» يراجع ويعدّل الفصول والمواضيع.</p>

      {outlineOf ? <OutlineEditor doc={outlineOf} onClose={() => { setOutlineOf(null); q.reload(); }} /> : null}

      {draft ? (
        <Modal title="رفع كتاب أو ملزمة" onClose={() => !busy && setDraft(null)}>
          <Field label="ملف PDF">
            <input className="input" style={{ paddingTop: 8 }} type="file" accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setDraft({ ...draft, file, title: draft.title || (file?.name.replace(/\.pdf$/i, '') ?? '') });
              }} />
          </Field>
          <div className="form">
            <Field label="العنوان"><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="المادة">
              <select className="input" value={draft.subject_id} onChange={(e) => setDraft({ ...draft, subject_id: e.target.value, chapter_id: '' })}>
                {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="الفصل">
              <select className="input" value={draft.chapter_id} onChange={(e) => setDraft({ ...draft, chapter_id: e.target.value })}>
                <option value="">المادة كاملة</option>
                {chaptersOf(draft.subject_id).map((c) => <option key={c.id} value={c.id}>الفصل {c.number} {c.title}</option>)}
              </select>
            </Field>
            <Field label="الأستاذ">
              <select className="input" value={draft.teacher_id} onChange={(e) => setDraft({ ...draft, teacher_id: e.target.value })}>
                <option value="">—</option>
                {d.teachers.filter((t) => !t.subject_id || t.subject_id === draft.subject_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="النوع">
              <select className="input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DocumentKind })}>
                {(Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[]).map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABELS[k]}</option>)}
              </select>
            </Field>
          </div>
          {upload !== null ? <div className="progress" aria-label="تقدم الرفع"><div style={{ width: `${Math.round(upload * 100)}%` }} /></div> : null}
          <button className="btn primary" onClick={save} disabled={busy}>{upload !== null ? `جارٍ الرفع ${Math.round(upload * 100)}٪` : 'رفع'}</button>
        </Modal>
      ) : null}
    </>
  );
}
