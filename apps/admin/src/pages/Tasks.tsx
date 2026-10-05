import { TASK_TYPE_LABELS, type Section, type Subject, type Task, type TaskType } from '@saey/shared';
import { useState } from 'react';
import { Empty, Field, Modal, check, useAction } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

export default function Tasks() {
  const { profile } = useAuth();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<{ type: TaskType; title: string; notes: string; subject_id: string; section_id: string; due: string } | null>(null);
  const q = useLoad(async () => {
    const [tasks, subjects, sections] = await Promise.all([
      must(supabase.from('tasks').select('*').neq('scope', 'personal').order('due_at', { ascending: false }).limit(200)),
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('sections').select('*').order('sort')),
    ]);
    return { tasks: tasks as Task[], subjects: subjects as Subject[], sections: sections as Section[] };
  });

  const save = () => run(async () => {
    if (!edit?.title.trim()) throw new Error('اكتب العنوان');
    if (!edit.due) throw new Error('حدد الموعد');
    await check(supabase.from('tasks').insert({
      owner_id: profile!.id, type: edit.type, title: edit.title.trim(), notes: edit.notes || null,
      subject_id: edit.subject_id || null, scope: edit.section_id ? 'section' : 'school', section_id: edit.section_id || null,
      due_at: new Date(edit.due).toISOString(),
    }));
    setEdit(null);
    await q.reload();
  }, 'أُضيفت ووصل إشعار للطلاب');

  const subjectName = (id: string | null) => q.data?.subjects.find((s) => s.id === id)?.name ?? '—';
  const sectionName = (id: string | null) => (id ? `شعبة ${q.data?.sections.find((s) => s.id === id)?.name ?? ''}` : 'الجميع');

  return (
    <>
      <div className="head">
        <h1>الواجبات والامتحانات</h1>
        <button className="btn primary" onClick={() => setEdit({ type: 'exam', title: '', notes: '', subject_id: '', section_id: '', due: '' })}>+ إضافة</button>
      </div>
      <p className="small dim">ما تضيفه هنا يظهر في منظِّم كل طالب، والامتحانات تظهر في العدّاد التنازلي في الشاشة الرئيسية.</p>
      {!q.data?.tasks.length ? <Empty>لا يوجد شيء بعد</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>العنوان</th><th>النوع</th><th>المادة</th><th>لمن</th><th>الموعد</th><th /></tr></thead>
            <tbody>
              {q.data.tasks.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.title}</b>{t.notes ? <div className="small dim">{t.notes}</div> : null}</td>
                  <td><span className={`pill ${t.type === 'exam' ? 'warn' : 'accent'}`}>{TASK_TYPE_LABELS[t.type]}</span></td>
                  <td>{subjectName(t.subject_id)}</td>
                  <td>{sectionName(t.section_id)}</td>
                  <td className="small">{t.due_at ? new Date(t.due_at).toLocaleString('ar-IQ') : '—'}</td>
                  <td><button className="btn danger sm" onClick={() => confirm('حذف؟') && run(async () => { await check(supabase.from('tasks').delete().eq('id', t.id)); await q.reload(); }, 'تم الحذف')}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit ? (
        <Modal title="إضافة واجب أو امتحان" onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="النوع">
              <select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as TaskType })}>
                {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((k) => <option key={k} value={k}>{TASK_TYPE_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="العنوان"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="امتحان الشهر الأول — فيزياء" /></Field>
            <Field label="المادة">
              <select className="input" value={edit.subject_id} onChange={(e) => setEdit({ ...edit, subject_id: e.target.value })}>
                <option value="">—</option>
                {(q.data?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="لمن">
              <select className="input" value={edit.section_id} onChange={(e) => setEdit({ ...edit, section_id: e.target.value })}>
                <option value="">كل الطلاب</option>
                {(q.data?.sections ?? []).map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
              </select>
            </Field>
            <Field label="الموعد"><input className="input" type="datetime-local" value={edit.due} onChange={(e) => setEdit({ ...edit, due: e.target.value })} /></Field>
          </div>
          <Field label="ملاحظات"><textarea className="input" style={{ minHeight: 80 }} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <button className="btn primary" onClick={save} disabled={busy}>إضافة وإرسال إشعار</button>
        </Modal>
      ) : null}
    </>
  );
}
