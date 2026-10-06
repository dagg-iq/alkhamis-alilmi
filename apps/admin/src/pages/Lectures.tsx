import { youtubeId, type Book, type Chapter, type Lecture, type Subject, type Teacher } from '@saey/shared';
import { useState } from 'react';
import { Empty, Field, Modal, check, useAction, useToast } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { indexLecture } from '../lib/content-ai';
import { callFunction, must, supabase } from '../lib/supabase';

export default function Lectures() {
  const { run, busy } = useAction();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ chapterId: string; teacherId: string; urls: string } | null>(null);
  const [edit, setEdit] = useState<Lecture | null>(null);
  const [progress, setProgress] = useState('');
  const [indexing, setIndexing] = useState<Record<string, string>>({});
  const toast = useToast();

  const q = useLoad(async () => {
    const [subjects, books, chapters, teachers, lectures] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('books').select('*').order('sort')),
      must(supabase.from('chapters').select('*').order('sort').order('number')),
      must(supabase.from('teachers').select('*').order('name')),
      must(supabase.from('lectures').select('*').order('sort')),
    ]);
    return { subjects: subjects as Subject[], books: books as Book[], chapters: chapters as Chapter[], teachers: teachers as Teacher[], lectures: lectures as Lecture[] };
  });
  const d = q.data;
  const active = subjectId ?? d?.subjects[0]?.id ?? null;
  const books = (d?.books ?? []).filter((b) => b.subject_id === active);
  const chapters = (d?.chapters ?? []).filter((c) => books.some((b) => b.id === c.book_id));
  const teachers = (d?.teachers ?? []).filter((t) => !t.subject_id || t.subject_id === active);
  const teacherName = (id: string | null) => d?.teachers.find((t) => t.id === id)?.name ?? '—';
  const bookName = (id: string) => (books.length > 1 ? `${books.find((b) => b.id === id)?.name} — ` : '');

  // إضافة عدة روابط دفعة واحدة: كل رابط في سطر
  const addMany = () => run(async () => {
    if (!adding?.chapterId) throw new Error('اختر الفصل');
    const lines = adding.urls.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('الصق رابطاً واحداً على الأقل');
    const existing = d!.lectures.filter((l) => l.chapter_id === adding.chapterId).length;
    for (let i = 0; i < lines.length; i++) {
      const id = youtubeId(lines[i]);
      if (!id) throw new Error(`رابط غير صالح: ${lines[i]}`);
      setProgress(`(${i + 1}/${lines.length}) جلب العنوان…`);
      let title = `المحاضرة ${existing + i + 1}`;
      try {
        const meta = await callFunction<{ title: string }>('youtube-meta', { url: `https://www.youtube.com/watch?v=${id}` });
        title = meta.title;
      } catch { /* نُبقي العنوان الافتراضي */ }
      await check(supabase.from('lectures').insert({
        chapter_id: adding.chapterId, teacher_id: adding.teacherId || null, title, youtube_id: id, sort: existing + i + 1,
      }));
    }
    setProgress('');
    setAdding(null);
    await q.reload();
  }, 'أُضيفت المحاضرات');

  // فهرسة بالدقيقة: الذكاء الاصطناعي يشاهد الفيديو ويستخرج المواضيع ووقتها
  const index = async (l: Lecture) => {
    setIndexing((s) => ({ ...s, [l.id]: 'يشاهد الفيديو…' }));
    try {
      await indexLecture(l.id, (n, total) => setIndexing((s) => ({ ...s, [l.id]: `جزء ${n}/${total}` })));
      toast('فُهرست المحاضرة — المساعد يعرف مواضيعها بالدقيقة');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'فشلت الفهرسة', true);
    } finally {
      setIndexing((s) => { const n = { ...s }; delete n[l.id]; return n; });
      q.reload();
    }
  };

  const save = () => run(async () => {
    if (!edit) return;
    await check(supabase.from('lectures').update({
      title: edit.title, chapter_id: edit.chapter_id, teacher_id: edit.teacher_id, sort: edit.sort, is_published: edit.is_published,
      youtube_id: youtubeId(edit.youtube_id) ?? edit.youtube_id,
    }).eq('id', edit.id));
    setEdit(null);
    await q.reload();
  }, 'تم الحفظ');

  if (!d) return <><div className="head"><h1>المحاضرات</h1></div><Empty>جارٍ التحميل…</Empty></>;

  return (
    <>
      <div className="head">
        <h1>المحاضرات</h1>
        <button className="btn primary" disabled={!chapters.length} onClick={() => setAdding({ chapterId: chapters[0]?.id ?? '', teacherId: '', urls: '' })}>+ إضافة محاضرات</button>
      </div>
      <div className="tabs">
        {d.subjects.map((s) => <button key={s.id} className={s.id === active ? 'on' : ''} onClick={() => setSubjectId(s.id)}>{s.name}</button>)}
      </div>
      {chapters.length === 0 ? <Empty>أضف فصول هذه المادة أولاً من صفحة «المواد والفصول».</Empty> : chapters.map((ch) => {
        const list = d.lectures.filter((l) => l.chapter_id === ch.id);
        return (
          <div key={ch.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{bookName(ch.book_id)}الفصل {ch.number}{ch.title ? ` — ${ch.title}` : ''}</h3>
              <button className="btn sm" onClick={() => setAdding({ chapterId: ch.id, teacherId: '', urls: '' })}>+ محاضرة</button>
            </div>
            {list.length === 0 ? <p className="small dim">لا توجد محاضرات.</p> : (
              <table>
                <tbody>
                  {list.map((l) => (
                    <tr key={l.id}>
                      <td style={{ width: 96 }}>
                        <a href={`https://youtu.be/${l.youtube_id}`} target="_blank" rel="noreferrer">
                          <img src={`https://i.ytimg.com/vi/${l.youtube_id}/mqdefault.jpg`} alt="" style={{ width: 88, borderRadius: 8, display: 'block' }} />
                        </a>
                      </td>
                      <td><b>{l.title}</b><div className="small dim">{teacherName(l.teacher_id)}</div></td>
                      <td>
                        {l.is_published ? <span className="pill ok">منشورة</span> : <span className="pill warn">مخفية</span>}{' '}
                        {indexing[l.id] ? <span className="pill accent">{indexing[l.id]}</span>
                          : (l as Lecture & { index_status?: string }).index_status === 'done' ? <span className="pill accent">مفهرسة بالدقيقة</span>
                          : (l as Lecture & { index_status?: string }).index_status === 'error' ? <span className="pill bad" title={(l as Lecture & { index_error?: string }).index_error ?? ''}>فشلت الفهرسة</span> : null}
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button className="btn sm" disabled={!!indexing[l.id]} onClick={() => index(l)}>فهرسة</button>
                          <button className="btn sm" onClick={() => setEdit(l)}>تعديل</button>
                          <button className="btn danger sm" onClick={() => confirm('حذف المحاضرة؟') && run(async () => { await check(supabase.from('lectures').delete().eq('id', l.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {adding ? (
        <Modal title="إضافة محاضرات" onClose={() => setAdding(null)}>
          <div className="form">
            <Field label="الفصل">
              <select className="input" value={adding.chapterId} onChange={(e) => setAdding({ ...adding, chapterId: e.target.value })}>
                {chapters.map((c) => <option key={c.id} value={c.id}>{bookName(c.book_id)}الفصل {c.number} {c.title}</option>)}
              </select>
            </Field>
            <Field label="الأستاذ">
              <select className="input" value={adding.teacherId} onChange={(e) => setAdding({ ...adding, teacherId: e.target.value })}>
                <option value="">—</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="روابط يوتيوب — كل رابط في سطر (بالترتيب)">
            <textarea className="input" dir="ltr" value={adding.urls} onChange={(e) => setAdding({ ...adding, urls: e.target.value })} placeholder={'https://youtu.be/...\nhttps://www.youtube.com/watch?v=...'} />
          </Field>
          <p className="small dim">العنوان يُجلب تلقائياً من يوتيوب، ويمكنك تعديله لاحقاً.</p>
          <div className="row">
            <button className="btn primary" onClick={addMany} disabled={busy}>{busy ? progress || 'جارٍ الإضافة…' : 'إضافة'}</button>
          </div>
        </Modal>
      ) : null}

      {edit ? (
        <Modal title="تعديل محاضرة" onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="العنوان"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="الفصل">
              <select className="input" value={edit.chapter_id} onChange={(e) => setEdit({ ...edit, chapter_id: e.target.value })}>
                {chapters.map((c) => <option key={c.id} value={c.id}>{bookName(c.book_id)}الفصل {c.number} {c.title}</option>)}
              </select>
            </Field>
            <Field label="الأستاذ">
              <select className="input" value={edit.teacher_id ?? ''} onChange={(e) => setEdit({ ...edit, teacher_id: e.target.value || null })}>
                <option value="">—</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="رابط/معرّف يوتيوب"><input className="input" dir="ltr" value={edit.youtube_id} onChange={(e) => setEdit({ ...edit, youtube_id: e.target.value })} /></Field>
            <Field label="الترتيب"><input className="input" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.is_published} onChange={(e) => setEdit({ ...edit, is_published: e.target.checked })} /> منشورة للطلاب</label>
          </div>
          <button className="btn primary" onClick={save} disabled={busy}>حفظ</button>
        </Modal>
      ) : null}
    </>
  );
}
