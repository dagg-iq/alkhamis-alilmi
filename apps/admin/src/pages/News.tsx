import { POST_KIND_LABELS, type Post, type PostKind, type Section } from '@saey/shared';
import { useState } from 'react';
import { Empty, Field, Modal, check, useAction } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { must, supabase, uploadFile } from '../lib/supabase';

const KIND_PILL: Record<PostKind, string> = { news: 'accent', holiday: 'ok', exam: 'warn', urgent: 'bad' };

export default function News() {
  const { profile } = useAuth();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<(Partial<Post> & { cover?: File | null }) | null>(null);
  const q = useLoad(async () => {
    const [posts, sections] = await Promise.all([
      must(supabase.from('posts').select('*').order('published_at', { ascending: false }).limit(100)),
      must(supabase.from('sections').select('*').order('sort')),
    ]);
    return { posts: posts as Post[], sections: sections as Section[] };
  });

  const save = () => run(async () => {
    if (!edit?.title?.trim()) throw new Error('اكتب العنوان');
    const cover_key = edit.cover ? await uploadFile(edit.cover, 'cover') : edit.cover_key ?? null;
    const row = {
      title: edit.title.trim(), body: edit.body ?? '', kind: edit.kind ?? 'news', is_pinned: !!edit.is_pinned,
      section_id: edit.section_id || null, cover_key,
      published_at: edit.published_at ?? new Date().toISOString(),
    };
    await check(edit.id ? supabase.from('posts').update(row).eq('id', edit.id) : supabase.from('posts').insert({ ...row, author_id: profile!.id }));
    setEdit(null);
    await q.reload();
  }, edit?.id ? 'تم الحفظ' : 'نُشر الخبر ووصل إشعار للطلاب');

  const sectionName = (id: string | null) => (id ? `شعبة ${q.data?.sections.find((s) => s.id === id)?.name ?? ''}` : 'الجميع');

  return (
    <>
      <div className="head">
        <h1>الأخبار</h1>
        <button className="btn primary" onClick={() => setEdit({ kind: 'news' })}>+ خبر جديد</button>
      </div>
      {!q.data?.posts.length ? <Empty>لا توجد أخبار بعد</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الخبر</th><th>النوع</th><th>لمن</th><th>التاريخ</th><th /></tr></thead>
            <tbody>
              {q.data.posts.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.title}</b> {p.is_pinned ? <span className="pill accent">مثبّت</span> : null}<div className="small dim">{p.body.slice(0, 90)}</div></td>
                  <td><span className={`pill ${KIND_PILL[p.kind]}`}>{POST_KIND_LABELS[p.kind]}</span></td>
                  <td>{sectionName(p.section_id)}</td>
                  <td className="small dim">{new Date(p.published_at).toLocaleString('ar-IQ')}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button className="btn sm" onClick={() => setEdit(p)}>تعديل</button>
                      <button className="btn danger sm" onClick={() => confirm('حذف الخبر؟') && run(async () => { await check(supabase.from('posts').delete().eq('id', p.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit ? (
        <Modal title={edit.id ? 'تعديل خبر' : 'خبر جديد'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="العنوان"><input className="input" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="النوع">
              <select className="input" value={edit.kind ?? 'news'} onChange={(e) => setEdit({ ...edit, kind: e.target.value as PostKind })}>
                {(Object.keys(POST_KIND_LABELS) as PostKind[]).map((k) => <option key={k} value={k}>{POST_KIND_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="لمن">
              <select className="input" value={edit.section_id ?? ''} onChange={(e) => setEdit({ ...edit, section_id: e.target.value || null })}>
                <option value="">كل الطلاب</option>
                {(q.data?.sections ?? []).map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
              </select>
            </Field>
            <Field label="صورة (اختياري)">
              <input className="input" style={{ paddingTop: 8 }} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setEdit({ ...edit, cover: e.target.files?.[0] ?? null })} />
            </Field>
          </div>
          <Field label="التفاصيل"><textarea className="input" value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={!!edit.is_pinned} onChange={(e) => setEdit({ ...edit, is_pinned: e.target.checked })} /> تثبيت في أعلى الأخبار</label>
          <button className="btn primary" onClick={save} disabled={busy}>{edit.id ? 'حفظ' : 'نشر وإرسال إشعار'}</button>
        </Modal>
      ) : null}
    </>
  );
}
