import { DOCUMENT_KIND_LABELS, type Book, type Chapter, type DocumentKind, type Subject, type Teacher } from '@saey/shared';
import { useState } from 'react';
import { Empty, Field, Tabs, useAction, useToast } from '../components/ui';
import { ensureChapter, ensureTeachers, indexLecture, ingestDocument } from '../lib/content-ai';
import { useLoad } from '../lib/hooks';
import { callFunction, must, supabase, uploadFile } from '../lib/supabase';

/**
 * مساعد المحتوى: يلصق المشرف رابط قائمة تشغيل أو يسحب ملفات PDF،
 * والذكاء الاصطناعي يقترح المادة والفصل والأستاذ والعنوان، ثم «إضافة الكل» وفهرسة للمساعد.
 */
interface Video { youtube_id: string; title: string; duration_sec: number | null; channel?: string | null; exists: boolean }
interface LectureRow extends Video {
  include: boolean;
  subject_id: string;
  chapter: string; // معرّف فصل، أو new:<رقم>:<عنوان>
  teacher: string; // معرّف أستاذ، أو new:<اسم>
  number: number | null;
}
interface FileRow {
  name: string;
  key: string;
  size: number;
  pages: number | null;
  include: boolean;
  subject_id: string;
  chapter_id: string;
  teacher: string;
  kind: DocumentKind;
  title: string;
  scanned: boolean;
  status: string;
}

const NEW = 'new:';
const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');

export default function Assistant() {
  const [tab, setTab] = useState<'lectures' | 'files'>('lectures');
  const q = useLoad(async () => {
    const [subjects, books, chapters, teachers] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('books').select('*').order('sort')),
      must(supabase.from('chapters').select('*').order('sort').order('number')),
      must(supabase.from('teachers').select('*').order('name')),
    ]);
    return { subjects: subjects as Subject[], books: books as Book[], chapters: chapters as Chapter[], teachers: teachers as Teacher[] };
  });
  if (!q.data) return <><div className="head"><h1>مساعد المحتوى</h1></div><Empty>جارٍ التحميل…</Empty></>;
  return (
    <>
      <div className="head">
        <h1>مساعد المحتوى</h1>
      </div>
      <p className="dim">الصق رابطاً أو اسحب ملفات، والذكاء الاصطناعي يرتّبها لك. راجع الجدول ثم اضغط «إضافة». يعمل بمفتاح لوحة التحكم ولا يأخذ من حصة الطلاب.</p>
      <Tabs options={[{ key: 'lectures', label: 'محاضرات يوتيوب' }, { key: 'files', label: 'ملازم وكتب PDF' }]} value={tab} onChange={setTab} />
      {tab === 'lectures' ? <LecturesTab data={q.data} reload={q.reload} /> : <FilesTab data={q.data} reload={q.reload} />}
    </>
  );
}

type Data = { subjects: Subject[]; books: Book[]; chapters: Chapter[]; teachers: Teacher[] };

function useCurriculum(d: Data) {
  const chaptersOf = (sid: string) => d.chapters.filter((c) => d.books.some((b) => b.id === c.book_id && b.subject_id === sid));
  return { chaptersOf };
}

// ---------------------------------------------------------------- المحاضرات
function LecturesTab({ data: d, reload }: { data: Data; reload: () => Promise<void> }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const { chaptersOf } = useCurriculum(d);
  const [links, setLinks] = useState('');
  const [subjectHint, setSubjectHint] = useState('');
  const [teacherHint, setTeacherHint] = useState('');
  const [rows, setRows] = useState<LectureRow[]>([]);
  const [step, setStep] = useState('');
  const [indexAfter, setIndexAfter] = useState(true);

  const fetchAndClassify = () => run(async () => {
    setStep('أسحب الفيديوهات من يوتيوب…');
    const { videos } = await callFunction<{ videos: Video[] }>('content-ai', { action: 'videos', links });
    if (!videos.length) throw new Error('لم أجد فيديوهات في هذه الروابط.');
    const fresh = videos.filter((v) => !v.exists);
    setStep(`يرتّبها الذكاء الاصطناعي (${fresh.length} فيديو)…`);
    const { items } = await callFunction<{ items: Record<string, unknown>[] }>('content-ai', {
      action: 'classify_lectures', videos: fresh, subjectId: subjectHint || null, teacherId: teacherHint || null,
    });
    const byId = new Map(items.map((it) => [String(it.youtube_id), it]));
    setRows(videos.map((v) => {
      const it = byId.get(v.youtube_id) ?? {};
      const sid = String(it.subject_id ?? subjectHint ?? '') || d.subjects[0]?.id || '';
      const validSubject = d.subjects.some((s) => s.id === sid) ? sid : subjectHint || d.subjects[0]?.id || '';
      const chId = String(it.chapter_id ?? '');
      const nc = it.new_chapter as { number?: number; title?: string } | null;
      const chapter = chaptersOf(validSubject).some((c) => c.id === chId) ? chId
        : nc?.number ? `${NEW}${nc.number}:${nc.title ?? ''}` : chaptersOf(validSubject)[0]?.id ?? '';
      const tId = String(it.teacher_id ?? teacherHint ?? '');
      const teacher = d.teachers.some((t) => t.id === tId) ? tId : it.new_teacher ? `${NEW}${it.new_teacher}` : '';
      return {
        ...v, include: !v.exists && !it.skip, subject_id: validSubject, chapter, teacher,
        number: typeof it.lecture_number === 'number' ? it.lecture_number : null,
        title: String(it.title ?? v.title),
      };
    }));
    setStep('');
  }).finally(() => setStep(''));

  const patch = (i: number, p: Partial<LectureRow>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const save = () => run(async () => {
    const chosen = rows.filter((r) => r.include);
    if (!chosen.length) throw new Error('اختر محاضرة واحدة على الأقل.');
    if (chosen.some((r) => !r.chapter)) throw new Error('كل محاضرة تحتاج فصلاً.');
    setStep('أُنشئ الأساتذة والفصول الجديدة…');
    const teachers = await ensureTeachers(chosen.filter((r) => r.teacher.startsWith(NEW)).map((r) => ({ name: r.teacher.slice(NEW.length), subject_id: r.subject_id })));
    const chapterIds = new Map<string, string>();
    for (const r of chosen) {
      if (!r.chapter.startsWith(NEW) || chapterIds.has(`${r.subject_id}|${r.chapter}`)) continue;
      const [num, ...title] = r.chapter.slice(NEW.length).split(':');
      chapterIds.set(`${r.subject_id}|${r.chapter}`, await ensureChapter(r.subject_id, Number(num) || 1, title.join(':') || `الفصل ${num}`));
    }
    setStep('أضيف المحاضرات…');
    const counts = new Map<string, number>();
    const added: { id: string; title: string }[] = [];
    for (const r of chosen) {
      const chapter_id = r.chapter.startsWith(NEW) ? chapterIds.get(`${r.subject_id}|${r.chapter}`)! : r.chapter;
      const teacher_id = r.teacher.startsWith(NEW) ? teachers.get(r.teacher.slice(NEW.length).trim()) ?? null : r.teacher || null;
      if (!counts.has(chapter_id)) {
        const { count } = await supabase.from('lectures').select('id', { count: 'exact', head: true }).eq('chapter_id', chapter_id);
        counts.set(chapter_id, count ?? 0);
      }
      const sort = r.number ?? counts.get(chapter_id)! + 1;
      counts.set(chapter_id, Math.max(counts.get(chapter_id)!, sort));
      const row = await must(supabase.from('lectures').insert({
        chapter_id, teacher_id, title: r.title.trim() || r.youtube_id, youtube_id: r.youtube_id, sort, duration_sec: r.duration_sec,
      }).select('id').single()) as { id: string };
      added.push({ id: row.id, title: r.title });
    }
    setRows([]);
    setLinks('');
    await reload();
    toast(`أُضيفت ${added.length} محاضرة`);
    if (indexAfter) {
      let ok = 0;
      for (let i = 0; i < added.length; i++) {
        try {
          await indexLecture(added[i].id, (s, total) => setStep(`فهرسة بالدقيقة (${i + 1}/${added.length}) «${added[i].title}» — الجزء ${s}${total ? ` من ${total}` : ''}`));
          ok++;
        } catch (e) {
          toast(`${added[i].title}: ${e instanceof Error ? e.message : 'فشلت الفهرسة'}`, true);
          if (e instanceof Error && e.message.includes('رصيد')) break;
        }
      }
      toast(`فُهرست ${ok} من ${added.length} — المساعد يعرف مواضيعها بالدقيقة الآن`);
    }
  }).finally(() => setStep(''));

  const chosenCount = rows.filter((r) => r.include).length;
  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="روابط يوتيوب: قائمة تشغيل، قناة الأستاذ، أو فيديوهات (كل رابط في سطر)">
          <textarea className="input" dir="ltr" value={links} onChange={(e) => setLinks(e.target.value)}
            placeholder={'https://www.youtube.com/playlist?list=...\nhttps://www.youtube.com/@teacher\nhttps://youtu.be/...'} />
        </Field>
        <div className="form">
          <Field label="المادة (اختياري — يساعد الترتيب)">
            <select className="input" value={subjectHint} onChange={(e) => setSubjectHint(e.target.value)}>
              <option value="">يحددها الذكاء الاصطناعي</option>
              {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="الأستاذ (اختياري)">
            <select className="input" value={teacherHint} onChange={(e) => setTeacherHint(e.target.value)}>
              <option value="">يحدده الذكاء الاصطناعي</option>
              {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          <button className="btn primary" onClick={fetchAndClassify} disabled={busy || !links.trim()}>{busy && step ? step : 'اسحب ورتّب'}</button>
        </div>
      </div>

      {rows.length ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{rows.length} فيديو — المحدد {chosenCount}</b>
            <div className="row">
              <button className="btn sm" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: !x.exists })))}>تحديد الكل</button>
              <button className="btn sm" onClick={() => setRows((r) => r.map((x) => ({ ...x, include: false })))}>إلغاء التحديد</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>الفيديو</th><th>العنوان</th><th>المادة</th><th>الفصل</th><th>الأستاذ</th><th>رقم</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const chs = chaptersOf(r.subject_id);
                  return (
                    <tr key={r.youtube_id} style={{ opacity: r.include ? 1 : 0.5 }}>
                      <td data-label=""><input type="checkbox" checked={r.include} disabled={r.exists} onChange={(e) => patch(i, { include: e.target.checked })} aria-label="تضمين" /></td>
                      <td data-label="الفيديو">
                        <a href={`https://youtu.be/${r.youtube_id}`} target="_blank" rel="noreferrer">
                          <img src={`https://i.ytimg.com/vi/${r.youtube_id}/mqdefault.jpg`} alt="" style={{ width: 96, borderRadius: 8, display: 'block' }} />
                        </a>
                        <div className="small dim">{mmss(r.duration_sec)}{r.exists ? ' · موجودة مسبقاً' : ''}</div>
                      </td>
                      <td data-label="العنوان">
                        <input className="input" style={{ minWidth: 200 }} value={r.title} onChange={(e) => patch(i, { title: e.target.value })} />
                        <div className="small dim" style={{ marginTop: 2 }}>{r.channel ?? ''}</div>
                      </td>
                      <td data-label="المادة">
                        <select className="input" style={{ minWidth: 140 }} value={r.subject_id} onChange={(e) => patch(i, { subject_id: e.target.value, chapter: chaptersOf(e.target.value)[0]?.id ?? '' })}>
                          {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td data-label="الفصل">
                        <select className="input" style={{ minWidth: 140 }} value={r.chapter} onChange={(e) => patch(i, { chapter: e.target.value })}>
                          {r.chapter.startsWith(NEW) ? <option value={r.chapter}>جديد: الفصل {r.chapter.slice(NEW.length).replace(':', ' — ')}</option> : null}
                          {!chs.length && !r.chapter.startsWith(NEW) ? <option value="">— لا فصول —</option> : null}
                          {chs.map((c) => <option key={c.id} value={c.id}>الفصل {c.number} {c.title}</option>)}
                        </select>
                      </td>
                      <td data-label="الأستاذ">
                        <select className="input" style={{ minWidth: 140 }} value={r.teacher} onChange={(e) => patch(i, { teacher: e.target.value })}>
                          <option value="">—</option>
                          {r.teacher.startsWith(NEW) ? <option value={r.teacher}>جديد: {r.teacher.slice(NEW.length)}</option> : null}
                          {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                      <td data-label="الرقم" style={{ width: 80 }}>
                        <input className="input" type="number" value={r.number ?? ''} onChange={(e) => patch(i, { number: e.target.value ? Number(e.target.value) : null })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="check"><input type="checkbox" checked={indexAfter} onChange={(e) => setIndexAfter(e.target.checked)} /> فهرسة بالدقيقة بعد الإضافة (الذكاء الاصطناعي يشاهد كل فيديو ويستخرج مواضيعه ووقتها — دقيقة أو أكثر لكل فيديو)</label>
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy || !chosenCount}>{busy && step ? step : `إضافة ${chosenCount} محاضرة`}</button>
          </div>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- الملازم والكتب
function FilesTab({ data: d, reload }: { data: Data; reload: () => Promise<void> }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const { chaptersOf } = useCurriculum(d);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [step, setStep] = useState('');
  const [indexAfter, setIndexAfter] = useState(true);
  const patch = (i: number, p: Partial<FileRow>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const pick = (files: FileList | null) => run(async () => {
    const list = [...(files ?? [])].filter((f) => f.type === 'application/pdf');
    if (!list.length) throw new Error('اختر ملفات PDF.');
    const start = rows.length;
    setRows((r) => [...r, ...list.map((f) => ({
      name: f.name, key: '', size: f.size, pages: null, include: true, subject_id: d.subjects[0]?.id ?? '', chapter_id: '', teacher: '',
      kind: 'malzama' as DocumentKind, title: f.name.replace(/\.pdf$/i, ''), scanned: false, status: 'بالانتظار',
    }))]);
    for (let i = 0; i < list.length; i++) {
      const idx = start + i;
      const f = list[i];
      try {
        setStep(`رفع ${i + 1}/${list.length}: ${f.name}`);
        const key = await uploadFile(f, 'material', (p) => patch(idx, { status: `يرفع ${Math.round(p * 100)}٪` }));
        patch(idx, { key, status: 'يقرأه الذكاء الاصطناعي…' });
        const s = await callFunction<Record<string, unknown>>('content-ai', { action: 'classify_document', key, name: f.name });
        const sid = d.subjects.some((x) => x.id === s.subject_id) ? String(s.subject_id) : d.subjects[0]?.id ?? '';
        const ch = chaptersOf(sid).some((c) => c.id === s.chapter_id) ? String(s.chapter_id) : '';
        const teacher = d.teachers.some((t) => t.id === s.teacher_id) ? String(s.teacher_id) : s.new_teacher ? `${NEW}${s.new_teacher}` : '';
        const kind = (['malzama', 'summary', 'book', 'other'] as const).includes(s.kind as DocumentKind) ? s.kind as DocumentKind : 'malzama';
        patch(idx, {
          subject_id: sid, chapter_id: ch, teacher, kind, title: String(s.title ?? f.name.replace(/\.pdf$/i, '')),
          pages: typeof s.pages === 'number' ? s.pages : null, scanned: !!s.scanned, status: 'جاهز للمراجعة',
        });
      } catch (e) {
        patch(idx, { status: `خطأ: ${e instanceof Error ? e.message : ''}`, include: false });
      }
    }
  }).finally(() => setStep(''));

  const save = () => run(async () => {
    const chosen = rows.filter((r) => r.include && r.key);
    if (!chosen.length) throw new Error('لا توجد ملفات جاهزة.');
    setStep('أحفظ الملفات…');
    const teachers = await ensureTeachers(chosen.filter((r) => r.teacher.startsWith(NEW)).map((r) => ({ name: r.teacher.slice(NEW.length), subject_id: r.subject_id })));
    const added: { id: string; title: string }[] = [];
    for (const r of chosen) {
      const teacher_id = r.teacher.startsWith(NEW) ? teachers.get(r.teacher.slice(NEW.length).trim()) ?? null : r.teacher || null;
      const row = await must(supabase.from('documents').insert({
        subject_id: r.subject_id, chapter_id: r.chapter_id || null, teacher_id, kind: r.kind, title: r.title.trim() || r.name,
        file_key: r.key, size_bytes: r.size, pages: r.pages,
      }).select('id').single()) as { id: string };
      added.push({ id: row.id, title: r.title });
    }
    setRows((rs) => rs.filter((r) => !chosen.includes(r)));
    await reload();
    toast(`حُفظ ${added.length} ملف`);
    if (indexAfter) {
      for (let i = 0; i < added.length; i++) {
        try {
          await ingestDocument(added[i].id, (n, total) => setStep(`فهرسة (${i + 1}/${added.length}) «${added[i].title}» — ${n}/${total} صفحة`));
        } catch (e) {
          toast(`${added[i].title}: ${e instanceof Error ? e.message : 'فشلت الفهرسة'}`, true);
          if (e instanceof Error && e.message.includes('رصيد')) break;
        }
      }
      toast('اكتملت الفهرسة — المساعد يعرف هذه الملفات الآن');
    }
  }).finally(() => setStep(''));

  const ready = rows.filter((r) => r.include && r.key).length;
  return (
    <>
      <label className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', padding: 28, borderStyle: 'dashed', cursor: 'pointer' }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}>
        <b>اسحب ملفات PDF هنا أو اضغط للاختيار</b>
        <span className="small dim">عدة ملفات معاً. الحد ٥٠ ميغا للملف. الملازم المصوّرة تُقرأ صفحاتها بالصور.</span>
        <input type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      </label>
      {step ? <p className="small dim">{step}</p> : null}

      {rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>الملف</th><th>العنوان</th><th>المادة</th><th>الفصل</th><th>الأستاذ</th><th>النوع</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}${i}`} style={{ opacity: r.include ? 1 : 0.5 }}>
                    <td data-label=""><input type="checkbox" checked={r.include} disabled={!r.key} onChange={(e) => patch(i, { include: e.target.checked })} aria-label="تضمين" /></td>
                    <td data-label="الملف">
                      <div className="small"><b>{r.name}</b></div>
                      <div className="small dim">{(r.size / 1048576).toFixed(1)} ميغا{r.pages ? ` · ${r.pages} صفحة` : ''}{r.scanned ? ' · مصوّرة' : ''}</div>
                      <div className="small dim">{r.status}</div>
                    </td>
                    <td data-label="العنوان"><input className="input" value={r.title} onChange={(e) => patch(i, { title: e.target.value })} /></td>
                    <td data-label="المادة">
                      <select className="input" style={{ minWidth: 140 }} value={r.subject_id} onChange={(e) => patch(i, { subject_id: e.target.value, chapter_id: '' })}>
                        {d.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td data-label="الفصل">
                      <select className="input" style={{ minWidth: 140 }} value={r.chapter_id} onChange={(e) => patch(i, { chapter_id: e.target.value })}>
                        <option value="">المادة كاملة</option>
                        {chaptersOf(r.subject_id).map((c) => <option key={c.id} value={c.id}>الفصل {c.number} {c.title}</option>)}
                      </select>
                    </td>
                    <td data-label="الأستاذ">
                      <select className="input" style={{ minWidth: 140 }} value={r.teacher} onChange={(e) => patch(i, { teacher: e.target.value })}>
                        <option value="">—</option>
                        {r.teacher.startsWith(NEW) ? <option value={r.teacher}>جديد: {r.teacher.slice(NEW.length)}</option> : null}
                        {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td data-label="النوع">
                      <select className="input" style={{ minWidth: 140 }} value={r.kind} onChange={(e) => patch(i, { kind: e.target.value as DocumentKind })}>
                        {Object.entries(DOCUMENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check"><input type="checkbox" checked={indexAfter} onChange={(e) => setIndexAfter(e.target.checked)} /> فهرسة للمساعد بعد الحفظ (يقرأ كل الصفحات حتى يجيب منها الطلاب)</label>
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy || !ready}>{busy && step ? step : `حفظ ${ready} ملف`}</button>
            <button className="btn ghost" onClick={() => setRows([])} disabled={busy}>مسح القائمة</button>
          </div>
        </>
      ) : null}
    </>
  );
}

