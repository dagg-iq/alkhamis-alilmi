import { buildTree, type DocumentRow, type OutlineRow } from '@saey/shared';
import { useEffect, useMemo, useState } from 'react';
import { buildDocumentOutline, embedDocumentOutline } from '../lib/content-ai';
import { must, signedUrl, supabase } from '../lib/supabase';
import { askConfirm } from './dialog';
import { check, Modal, useAction, useToast } from './ui';

interface Topic { id: string; title: string; page: number; isNew?: boolean; dirty?: boolean }
interface Chapter { id: string; title: string; start: number; end: number; topics: Topic[]; isNew?: boolean; dirty?: boolean }

const uid = () => crypto.randomUUID();

/** مراجعة وتعديل فهرس الفصول والمواضيع (الذكاء الاصطناعي يبنيه، والمشرف يصحّحه) */
export function OutlineEditor({ doc, onClose }: { doc: DocumentRow; onClose: () => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const total = doc.pages ?? 9999;

  const load = async () => {
    const rows = await must(supabase.from('document_outline').select('id, document_id, parent_id, level, title, start_page, end_page, sort').eq('document_id', doc.id)) as OutlineRow[];
    setChapters(buildTree(rows).map((c) => ({
      id: c.id, title: c.title, start: c.start_page, end: c.end_page ?? c.start_page,
      topics: c.topics.map((t) => ({ id: t.id, title: t.title, page: t.start_page })),
    })));
    setRemoved([]);
  };
  useEffect(() => { load().catch((e) => toast(e instanceof Error ? e.message : 'تعذّر التحميل', true)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const patchCh = (id: string, p: Partial<Chapter>) => setChapters((cs) => cs!.map((c) => (c.id === id ? { ...c, ...p, dirty: true } : c)));
  const patchTp = (cid: string, tid: string, p: Partial<Topic>) =>
    setChapters((cs) => cs!.map((c) => (c.id === cid ? { ...c, topics: c.topics.map((t) => (t.id === tid ? { ...t, ...p, dirty: true } : t)) } : c)));

  const problems = useMemo(() => {
    const out: string[] = [];
    (chapters ?? []).forEach((c, i) => {
      if (!c.title.trim()) out.push(`الفصل ${i + 1}: اكتب العنوان`);
      if (!(c.start >= 1 && c.end >= c.start && c.end <= total)) out.push(`«${c.title || i + 1}»: الصفحات يجب أن تكون بين ١ و${total} والنهاية بعد البداية`);
      c.topics.forEach((t) => {
        if (!t.title.trim()) out.push(`«${c.title}»: موضوع بلا عنوان`);
        else if (t.page < c.start || t.page > c.end) out.push(`الموضوع «${t.title}» خارج صفحات فصله (${c.start}–${c.end})`);
      });
    });
    return out;
  }, [chapters, total]);

  const save = () => run(async () => {
    if (problems.length) throw new Error(problems[0]);
    const cs = chapters!;
    if (removed.length) await check(supabase.from('document_outline').delete().in('id', removed));
    let sort = 0;
    const rows: Record<string, unknown>[] = [];
    for (const c of cs) {
      rows.push({ id: c.id, document_id: doc.id, parent_id: null, level: 1, title: c.title.trim(), start_page: c.start, end_page: c.end, sort: sort++, embedding: null });
      const sorted = [...c.topics].sort((a, b) => a.page - b.page);
      sorted.forEach((t, i) => {
        const next = sorted[i + 1]?.page;
        rows.push({ id: t.id, document_id: doc.id, parent_id: c.id, level: 2, title: t.title.trim(), start_page: t.page, end_page: next && next > t.page ? next - 1 : c.end, sort: sort++, embedding: null });
      });
    }
    // المتجهات تُحسب من جديد لكل العناوين بعد الحفظ (الصفوف المحدَّثة تفرغ حقلها)
    // الفصول قبل مواضيعها (المفتاح الأجنبي)
    await check(supabase.from('document_outline').upsert(rows.filter((r) => r.level === 1), { onConflict: 'id' }));
    if (rows.some((r) => r.level === 2)) await check(supabase.from('document_outline').upsert(rows.filter((r) => r.level === 2), { onConflict: 'id' }));
    await check(supabase.from('documents').update({ outline_status: 'done', outline_error: null }).eq('id', doc.id));
    // ربط العناوين المعدَّلة دلالياً بالكتب والملازم الأخرى (فشله لا يمنع الحفظ)
    await embedDocumentOutline(doc.id).catch(() => toast('حُفظ الفهرس، لكن تعذّر تحديث الربط بين الملفات (رصيد Gemini). أعد الحفظ لاحقاً.', true));
    await load();
  }, 'حُفظ الفهرس');

  const rebuild = () => run(async () => {
    if (!(await askConfirm('إعادة بناء الفهرس بالذكاء الاصطناعي؟ سيُستبدل الفهرس الحالي وتعديلاتك عليه.'))) return;
    const r = await buildDocumentOutline(doc.id);
    embedDocumentOutline(doc.id).catch(() => {}); // الربط بين الملفات في الخلفية
    toast(`بُني الفهرس: ${r.chapters} فصل و${r.topics} موضوع`);
    await load();
  });

  const open = (page: number) => run(async () => { window.open(`${await signedUrl(doc.file_key)}#page=${page}`, '_blank'); });
  const addChapter = () => setChapters((cs) => {
    const last = cs![cs!.length - 1];
    const start = last ? Math.min(total, last.end + 1) : 1;
    return [...cs!, { id: uid(), title: '', start, end: total, topics: [], isNew: true }];
  });

  return (
    <Modal title={`فهرس: ${doc.title}`} onClose={onClose}>
      <p className="small dim" style={{ margin: 0 }}>الفصول والمواضيع التي يفتح منها الطالب الملف مباشرة. صفحات الملف بترقيم الـ PDF (١ إلى {doc.pages ?? '؟'}).</p>
      <div className="row">
        <button className="btn primary" onClick={save} disabled={busy || !chapters}>حفظ الفهرس</button>
        <button className="btn" onClick={rebuild} disabled={busy}>إعادة البناء بالذكاء الاصطناعي</button>
        <button className="btn sm" onClick={addChapter} disabled={!chapters}>+ فصل</button>
      </div>
      {problems.length ? <div className="card" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>{problems.slice(0, 3).map((p) => <div key={p} className="small">{p}</div>)}</div> : null}
      {!chapters ? <div className="dim">يحمّل…</div> : chapters.length === 0 ? <div className="dim">لا يوجد فهرس بعد. اضغط «إعادة البناء بالذكاء الاصطناعي».</div> : (
        <div className="ol-list">
          {chapters.map((c, ci) => (
            <div key={c.id} className="ol-chapter">
              <div className="ol-row ch">
                <b className="ol-no">{ci + 1}</b>
                <input className="input" value={c.title} placeholder="عنوان الفصل" onChange={(e) => patchCh(c.id, { title: e.target.value })} />
                <input className="input num" type="number" min={1} max={total} value={c.start} aria-label="من صفحة" onChange={(e) => patchCh(c.id, { start: Number(e.target.value) })} />
                <input className="input num" type="number" min={1} max={total} value={c.end} aria-label="إلى صفحة" onChange={(e) => patchCh(c.id, { end: Number(e.target.value) })} />
                <button className="btn sm" onClick={() => open(c.start)}>فتح</button>
                <button className="btn danger sm" onClick={async () => {
                  if (!(await askConfirm(`حذف الفصل «${c.title || ci + 1}» ومواضيعه؟`))) return;
                  setRemoved((r) => [...r, c.id, ...c.topics.map((t) => t.id)]);
                  setChapters((cs) => cs!.filter((x) => x.id !== c.id));
                }}>حذف</button>
              </div>
              {c.topics.map((t) => (
                <div key={t.id} className="ol-row tp">
                  <span className="ol-dot" />
                  <input className="input" value={t.title} placeholder="عنوان الموضوع" onChange={(e) => patchTp(c.id, t.id, { title: e.target.value })} />
                  <input className="input num" type="number" min={c.start} max={c.end} value={t.page} aria-label="الصفحة" onChange={(e) => patchTp(c.id, t.id, { page: Number(e.target.value) })} />
                  <button className="btn sm" onClick={() => open(t.page)}>فتح</button>
                  <button className="btn danger sm" onClick={() => {
                    setRemoved((r) => [...r, t.id]);
                    setChapters((cs) => cs!.map((x) => (x.id === c.id ? { ...x, topics: x.topics.filter((y) => y.id !== t.id) } : x)));
                  }}>حذف</button>
                </div>
              ))}
              <div><button className="btn sm" onClick={() => setChapters((cs) => cs!.map((x) => (x.id === c.id ? { ...x, topics: [...x.topics, { id: uid(), title: '', page: x.start, isNew: true }] } : x)))}>+ موضوع</button></div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
