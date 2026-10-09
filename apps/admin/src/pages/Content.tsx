import type { Book, Chapter, Section, Subject, Teacher } from '@saey/shared';
import { useState } from 'react';
import { askConfirm } from '../components/dialog';
import { Empty, Field, Modal, Tabs, check, useAction } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

type Tab = 'chapters' | 'teachers' | 'sections';

export default function Content() {
  const [tab, setTab] = useState<Tab>('chapters');
  return (
    <>
      <div className="head"><h1>المواد والفصول</h1></div>
      <Tabs<Tab> value={tab} onChange={setTab} options={[
        { key: 'chapters', label: 'المواد والفصول' },
        { key: 'teachers', label: 'الأساتذة' },
        { key: 'sections', label: 'الشعب' },
      ]} />
      {tab === 'chapters' ? <Chapters /> : tab === 'teachers' ? <Teachers /> : <Sections />}
    </>
  );
}

// ---------------------------------------------------------------- المواد ← الأجزاء ← الفصول
function Chapters() {
  const { run } = useAction();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Chapter> | null>(null);
  const [bookEdit, setBookEdit] = useState<Partial<Book> | null>(null);

  const q = useLoad(async () => {
    const [subjects, books, chapters] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('books').select('*').order('sort')),
      must(supabase.from('chapters').select('*').order('sort').order('number')),
    ]);
    return { subjects: subjects as Subject[], books: books as Book[], chapters: chapters as Chapter[] };
  });
  const d = q.data;
  const active = subjectId ?? d?.subjects[0]?.id ?? null;
  const books = (d?.books ?? []).filter((b) => b.subject_id === active);

  const saveChapter = () => run(async () => {
    if (!edit?.book_id || !edit.number) throw new Error('اختر الجزء واكتب رقم الفصل');
    const row = { book_id: edit.book_id, number: Number(edit.number), title: edit.title ?? '', sort: Number(edit.sort ?? edit.number) };
    await check(edit.id ? supabase.from('chapters').update(row).eq('id', edit.id) : supabase.from('chapters').insert(row));
    setEdit(null);
    await q.reload();
  }, 'تم الحفظ');

  const saveBook = () => run(async () => {
    if (!bookEdit?.name) throw new Error('اكتب اسم الجزء');
    const row = { subject_id: active!, name: bookEdit.name, sort: Number(bookEdit.sort ?? books.length + 1) };
    await check(bookEdit.id ? supabase.from('books').update(row).eq('id', bookEdit.id) : supabase.from('books').insert(row));
    setBookEdit(null);
    await q.reload();
  }, 'تم الحفظ');

  const remove = async (table: 'chapters' | 'books', id: string, label: string) => {
    if (!(await askConfirm(`حذف ${label}؟ سيُحذف كل ما بداخله من محاضرات.`))) return;
    run(async () => {
      await check(supabase.from(table).delete().eq('id', id));
      await q.reload();
    }, 'تم الحذف');
  };

  if (!d) return <Empty>جارٍ التحميل…</Empty>;
  return (
    <>
      <div className="tabs">
        {d.subjects.map((s) => <button key={s.id} className={s.id === active ? 'on' : ''} onClick={() => setSubjectId(s.id)}>{s.name}</button>)}
      </div>
      {books.map((b) => {
        const chs = d.chapters.filter((c) => c.book_id === b.id);
        return (
          <div key={b.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{b.name}</h3>
              <div className="row">
                <button className="btn sm" onClick={() => setBookEdit(b)}>تعديل الجزء</button>
                {books.length > 1 ? <button className="btn danger sm" onClick={() => remove('books', b.id, b.name)}>حذف</button> : null}
                <button className="btn primary sm" onClick={() => setEdit({ book_id: b.id, number: chs.length + 1 })}>+ فصل</button>
              </div>
            </div>
            {chs.length === 0 ? <p className="dim small">لا توجد فصول بعد.</p> : (
              <table>
                <tbody>
                  {chs.map((c) => (
                    <tr key={c.id}>
                      <td style={{ width: 90 }}><b>الفصل {c.number}</b></td>
                      <td>{c.title}</td>
                      <td style={{ width: 160 }}>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm" onClick={() => setEdit(c)}>تعديل</button>
                          <button className="btn danger sm" onClick={() => remove('chapters', c.id, `الفصل ${c.number}`)}>حذف</button>
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
      <button className="btn" onClick={() => setBookEdit({})}>+ إضافة جزء/كتاب لهذه المادة</button>

      {edit ? (
        <Modal title={edit.id ? 'تعديل فصل' : 'فصل جديد'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="الجزء">
              <select className="input" value={edit.book_id ?? ''} onChange={(e) => setEdit({ ...edit, book_id: e.target.value })}>
                {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="رقم الفصل"><input className="input" type="number" min={1} value={edit.number ?? ''} onChange={(e) => setEdit({ ...edit, number: Number(e.target.value) })} /></Field>
            <Field label="عنوان الفصل"><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="مثلاً: المتسعات" /></Field>
          </div>
          <button className="btn primary" onClick={saveChapter}>حفظ</button>
        </Modal>
      ) : null}
      {bookEdit ? (
        <Modal title={bookEdit.id ? 'تعديل الجزء' : 'جزء جديد'} onClose={() => setBookEdit(null)}>
          <div className="form">
            <Field label="الاسم"><input className="input" value={bookEdit.name ?? ''} onChange={(e) => setBookEdit({ ...bookEdit, name: e.target.value })} placeholder="مثلاً: الجزء الثاني" /></Field>
            <Field label="الترتيب"><input className="input" type="number" value={bookEdit.sort ?? ''} onChange={(e) => setBookEdit({ ...bookEdit, sort: Number(e.target.value) })} /></Field>
          </div>
          <button className="btn primary" onClick={saveBook}>حفظ</button>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- الأساتذة
function Teachers() {
  const { run } = useAction();
  const [edit, setEdit] = useState<Partial<Teacher> | null>(null);
  const q = useLoad(async () => {
    const [teachers, subjects] = await Promise.all([
      must(supabase.from('teachers').select('*').order('name')),
      must(supabase.from('subjects').select('*').order('sort')),
    ]);
    return { teachers: teachers as Teacher[], subjects: subjects as Subject[] };
  });
  const save = () => run(async () => {
    if (!edit?.name) throw new Error('اكتب اسم الأستاذ');
    const row = { name: edit.name, subject_id: edit.subject_id || null, channel_url: edit.channel_url || null };
    await check(edit.id ? supabase.from('teachers').update(row).eq('id', edit.id) : supabase.from('teachers').insert(row));
    setEdit(null);
    await q.reload();
  }, 'تم الحفظ');
  const subjectName = (id: string | null) => q.data?.subjects.find((s) => s.id === id)?.name ?? '—';

  return (
    <>
      <div><button className="btn primary" onClick={() => setEdit({})}>+ أستاذ</button></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>الأستاذ</th><th>المادة</th><th>القناة</th><th /></tr></thead>
          <tbody>
            {(q.data?.teachers ?? []).map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b></td>
                <td>{subjectName(t.subject_id)}</td>
                <td>{t.channel_url ? <a href={t.channel_url} target="_blank" rel="noreferrer">يوتيوب</a> : '—'}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => setEdit(t)}>تعديل</button>
                    <button className="btn danger sm" onClick={async () => (await askConfirm('حذف الأستاذ؟')) && run(async () => { await check(supabase.from('teachers').delete().eq('id', t.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? (
        <Modal title={edit.id ? 'تعديل أستاذ' : 'أستاذ جديد'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="الاسم"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="المادة">
              <select className="input" value={edit.subject_id ?? ''} onChange={(e) => setEdit({ ...edit, subject_id: e.target.value })}>
                <option value="">—</option>
                {(q.data?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="رابط القناة (اختياري)"><input className="input" dir="ltr" value={edit.channel_url ?? ''} onChange={(e) => setEdit({ ...edit, channel_url: e.target.value })} /></Field>
          </div>
          <button className="btn primary" onClick={save}>حفظ</button>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- الشعب
function Sections() {
  const { run } = useAction();
  const [name, setName] = useState('');
  const q = useLoad(async () => {
    const [sections, schools] = await Promise.all([
      must(supabase.from('sections').select('*').order('sort')),
      must(supabase.from('schools').select('id').limit(1)),
    ]);
    return { sections: sections as Section[], schoolId: (schools as { id: string }[])[0]?.id };
  });
  const add = () => run(async () => {
    if (!name.trim()) throw new Error('اكتب اسم الشعبة');
    let schoolId = q.data?.schoolId;
    if (!schoolId) {
      // لم يُشغَّل seed.sql بعد: ننشئ المدرسة تلقائياً
      const { data, error } = await supabase.from('schools').insert({ name: 'إعدادية الشهاب للبنين', grade_label: 'الخامس العلمي' }).select('id').single();
      if (error) throw new Error(error.message);
      schoolId = data.id as string;
    }
    await check(supabase.from('sections').insert({ school_id: schoolId, name: name.trim(), sort: (q.data?.sections.length ?? 0) + 1 }));
    setName('');
    await q.reload();
  }, 'أُضيفت الشعبة');

  return (
    <>
      <div className="card row">
        <input className="input" style={{ maxWidth: 200 }} placeholder="اسم الشعبة (مثل: و)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" onClick={add}>+ إضافة شعبة</button>
      </div>
      <div className="grid">
        {(q.data?.sections ?? []).map((s) => (
          <div key={s.id} className="card row" style={{ justifyContent: 'space-between' }}>
            <h2>شعبة {s.name}</h2>
            <button className="btn danger sm" onClick={async () => (await askConfirm(`حذف شعبة ${s.name}؟ (طلابها يبقون بدون شعبة)`)) && run(async () => { await check(supabase.from('sections').delete().eq('id', s.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
          </div>
        ))}
      </div>
    </>
  );
}
