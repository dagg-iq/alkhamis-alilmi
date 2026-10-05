import {
  PERIOD_LABELS, PERIODS, QUESTION_KIND_LABELS,
  type Period, type QuestionKind, type QuestionSet, type Section, type Subject,
} from '@saey/shared';
import { useState } from 'react';
import { Empty, Field, Markdown, Modal, Tabs, check, useAction } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { must, signedUrl, supabase } from '../lib/supabase';

type Filter = 'draft' | 'published';
type Draft = Partial<QuestionSet> & { subject_id: string; kind: QuestionKind; period: Period };

export default function Questions() {
  const { run, busy } = useAction();
  const [filter, setFilter] = useState<Filter>('draft');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);

  const q = useLoad(async () => {
    const [subjects, sections, sets] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('sections').select('*').order('sort')),
      must(supabase.from('question_sets').select('*').order('created_at', { ascending: false })),
    ]);
    return { subjects: subjects as Subject[], sections: sections as Section[], sets: sets as QuestionSet[] };
  });
  const d = q.data;
  const subjectName = (id: string) => d?.subjects.find((s) => s.id === id)?.name ?? '';
  const list = (d?.sets ?? []).filter((s) => s.status === filter);

  const save = (status?: 'draft' | 'published') => run(async () => {
    if (!edit) return;
    if (!edit.title?.trim()) throw new Error('اكتب العنوان');
    const row = {
      subject_id: edit.subject_id, kind: edit.kind, period: edit.period, section_id: edit.section_id || null,
      title: edit.title.trim(), source: edit.source || null, content_md: edit.content_md ?? '', status: status ?? edit.status ?? 'draft',
    };
    await check(edit.id ? supabase.from('question_sets').update(row).eq('id', edit.id) : supabase.from('question_sets').insert(row));
    setEdit(null);
    await q.reload();
  }, status === 'published' ? 'نُشرت للطلاب' : 'تم الحفظ');

  if (!d) return <><div className="head"><h1>الأسئلة</h1></div><Empty>جارٍ التحميل…</Empty></>;

  return (
    <>
      <div className="head">
        <h1>الأسئلة</h1>
        <button className="btn primary" onClick={() => { setPreview(false); setEdit({ subject_id: d.subjects[0]?.id, kind: 'expected', period: 'month1', title: '', content_md: '' }); }}>+ أسئلة جديدة</button>
      </div>
      <Tabs<Filter> value={filter} onChange={setFilter} options={[
        { key: 'draft', label: 'مسودات تنتظر المراجعة', count: d.sets.filter((s) => s.status === 'draft').length },
        { key: 'published', label: 'المنشورة' },
      ]} />
      <p className="small dim">الأسئلة المصوّرة من التطبيق تصل هنا كمسودة: راجع النص المستخرج وصحّحه ثم انشره.</p>
      {list.length === 0 ? <Empty>لا يوجد شيء هنا</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>العنوان</th><th>المادة</th><th>النوع</th><th>الامتحان</th><th>التاريخ</th><th /></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.title}</b>{s.source ? <div className="small dim">{s.source}</div> : null}</td>
                  <td>{subjectName(s.subject_id)}</td>
                  <td><span className="pill accent">{QUESTION_KIND_LABELS[s.kind]}</span></td>
                  <td>{PERIOD_LABELS[s.period]}</td>
                  <td className="small dim">{new Date(s.created_at).toLocaleDateString('ar-IQ')}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {s.pdf_key ? <button className="btn sm" onClick={() => run(async () => { window.open(await signedUrl(s.pdf_key!), '_blank'); })}>الصور</button> : null}
                      <button className="btn sm" onClick={() => { setPreview(true); setEdit(s as Draft); }}>{s.status === 'draft' ? 'مراجعة' : 'تعديل'}</button>
                      <button className="btn danger sm" onClick={() => confirm('حذف؟') && run(async () => { await check(supabase.from('question_sets').delete().eq('id', s.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit ? (
        <Modal title={edit.id ? 'مراجعة الأسئلة' : 'أسئلة جديدة'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="العنوان"><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="المادة">
              <select className="input" value={edit.subject_id} onChange={(e) => setEdit({ ...edit, subject_id: e.target.value })}>
                {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="النوع">
              <select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as QuestionKind })}>
                <option value="expected">{QUESTION_KIND_LABELS.expected}</option>
                <option value="school_exam">{QUESTION_KIND_LABELS.school_exam}</option>
              </select>
            </Field>
            <Field label="الامتحان">
              <select className="input" value={edit.period} onChange={(e) => setEdit({ ...edit, period: e.target.value as Period })}>
                {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="الشعبة">
              <select className="input" value={edit.section_id ?? ''} onChange={(e) => setEdit({ ...edit, section_id: e.target.value || null })}>
                <option value="">كل الشعب</option>
                {d.sections.map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
              </select>
            </Field>
            <Field label="المصدر"><input className="input" value={edit.source ?? ''} onChange={(e) => setEdit({ ...edit, source: e.target.value })} placeholder="مثلاً: ملزمة الأستاذ…" /></Field>
          </div>
          <div className="tabs">
            <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>تحرير</button>
            <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}>معاينة</button>
          </div>
          {preview ? (
            <div className="card" style={{ minHeight: 200 }}><Markdown text={edit.content_md ?? ''} /></div>
          ) : (
            <Field label="النص (Markdown — المعادلات بين $...$)">
              <textarea className="input" style={{ minHeight: 320 }} value={edit.content_md ?? ''} onChange={(e) => setEdit({ ...edit, content_md: e.target.value })} />
            </Field>
          )}
          <div className="row">
            <button className="btn primary" onClick={() => save('published')} disabled={busy}>حفظ ونشر للطلاب</button>
            <button className="btn" onClick={() => save('draft')} disabled={busy}>حفظ كمسودة</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
