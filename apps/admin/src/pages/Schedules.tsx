import {
  SCHEDULE_KIND_LABELS, WEEKDAYS, minutesOf, parseScheduleSettings,
  type Schedule, type ScheduleItem, type ScheduleKind, type ScheduleSettings, type Section, type Subject,
} from '@saey/shared';
import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../components/dialog';
import { Empty, Field, check, useAction, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { printSchedule } from '../lib/print-schedule';
import { must, supabase } from '../lib/supabase';

const SCHOOL = 'إعدادية الشهاب للبنين';
const KIND_PILL: Record<ScheduleKind, string> = { weekly: 'accent', exam: 'warn', custom: 'ok' };

interface Row {
  id: string; day: number | null; on_date: string; sort: number; start_time: string; end_time: string;
  subject_id: string; title: string; teacher: string; place: string; note: string;
}
const uid = () => crypto.randomUUID();
const toRow = (i: ScheduleItem): Row => ({
  id: i.id, day: i.day, on_date: i.on_date ?? '', sort: i.sort, start_time: i.start_time ?? '', end_time: i.end_time ?? '',
  subject_id: i.subject_id ?? '', title: i.title ?? '', teacher: i.teacher ?? '', place: i.place ?? '', note: i.note ?? '',
});
const blank = (over: Partial<Row>): Row => ({
  id: uid(), day: null, on_date: '', sort: 1, start_time: '', end_time: '', subject_id: '', title: '', teacher: '', place: '', note: '', ...over,
});
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toItem = (r: Row, scheduleId: string) => ({
  id: r.id, schedule_id: scheduleId, day: r.day, on_date: r.on_date || null, sort: r.sort,
  start_time: r.start_time || null, end_time: r.end_time || null, subject_id: r.subject_id || null,
  title: r.title.trim() || null, teacher: r.teacher.trim() || null, place: r.place.trim() || null, note: r.note.trim() || null,
});

export default function Schedules() {
  const { isAdmin } = useAuth();
  const { run } = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null); // معرف أو 'new'
  const q = useLoad(async () => {
    const [schedules, items, sections, subjects, settings] = await Promise.all([
      must(supabase.from('schedules').select('*').order('kind').order('sort').order('created_at')),
      must(supabase.from('schedule_items').select('id, schedule_id')),
      must(supabase.from('sections').select('*').order('sort')),
      must(supabase.from('subjects').select('*').order('sort')),
      supabase.from('app_settings').select('value').eq('key', 'schedule').maybeSingle(),
    ]);
    const counts: Record<string, number> = {};
    for (const i of items as { schedule_id: string }[]) counts[i.schedule_id] = (counts[i.schedule_id] ?? 0) + 1;
    return {
      schedules: schedules as Schedule[], counts, sections: sections as Section[], subjects: subjects as Subject[],
      settings: parseScheduleSettings(settings.data?.value),
    };
  }, [editing]);

  if (editing && q.data) {
    return <Editor id={editing === 'new' ? null : editing} data={q.data} onClose={() => setEditing(null)} />;
  }

  const sectionName = (id: string | null) => (id ? `شعبة ${q.data?.sections.find((s) => s.id === id)?.name ?? ''}` : 'كل الشعب');

  const duplicate = (s: Schedule) => run(async () => {
    const { data: copy, error } = await supabase.from('schedules').insert({
      title: `${s.title} (نسخة)`, subtitle: s.subtitle, kind: s.kind, section_id: s.section_id, is_published: false, sort: s.sort,
    }).select('id').single();
    if (error) throw new Error(error.message);
    const items = await must(supabase.from('schedule_items').select('*').eq('schedule_id', s.id)) as ScheduleItem[];
    if (items.length) await check(supabase.from('schedule_items').insert(items.map(({ id: _id, ...rest }) => ({ ...rest, schedule_id: copy.id }))));
    await q.reload();
  }, 'تم النسخ (كمسودة)');

  const printOne = async (s: Schedule) => {
    try {
      const items = await must(supabase.from('schedule_items').select('*').eq('schedule_id', s.id)) as ScheduleItem[];
      printSchedule({ schedule: s, items, subjects: q.data!.subjects, sections: q.data!.sections, settings: q.data!.settings, school: SCHOOL });
    } catch (e) { toast(e instanceof Error ? e.message : 'تعذّرت الطباعة', true); }
  };

  return (
    <>
      <div className="head">
        <h1>الجداول</h1>
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!q.data}>+ جدول جديد</button>
      </div>
      <p className="dim small">جدول الحصص الأسبوعي، وجداول الامتحانات الشهرية ونصف السنة، وأي جدول تريده. ما تنشره يظهر للطلاب في التطبيق (للشعبة المحددة أو للجميع).</p>

      {q.data && isAdmin ? <SettingsCard settings={q.data.settings} onSaved={q.reload} /> : null}

      {!q.data?.schedules.length ? <Empty>لا توجد جداول بعد. اضغط «جدول جديد».</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الجدول</th><th>النوع</th><th>لمن</th><th>العناصر</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {q.data.schedules.map((s) => (
                <tr key={s.id}>
                  <td data-label="الجدول"><b>{s.title}</b><div className="small dim">{s.subtitle}</div></td>
                  <td data-label="النوع"><span className={`pill ${KIND_PILL[s.kind]}`}>{SCHEDULE_KIND_LABELS[s.kind]}</span></td>
                  <td data-label="لمن">{sectionName(s.section_id)}</td>
                  <td data-label="العناصر" className="num">{q.data!.counts[s.id] ?? 0}</td>
                  <td data-label="الحالة">{s.is_published ? <span className="pill ok">منشور</span> : <span className="pill">مسودة</span>}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="btn sm primary" onClick={() => setEditing(s.id)}>تعديل</button>
                      <button className="btn sm" onClick={() => printOne(s)}>طباعة</button>
                      <button className="btn sm" onClick={() => duplicate(s)}>نسخ</button>
                      <button className="btn danger sm" onClick={async () => (await askConfirm(`حذف «${s.title}» وكل ما فيه؟`)) && run(async () => { await check(supabase.from('schedules').delete().eq('id', s.id)); await q.reload(); }, 'تم الحذف')}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** إعدادات الجدول الذكي: أيام الدوام وساعة التحويل (للأدمن) */
function SettingsCard({ settings, onSaved }: { settings: ScheduleSettings; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = () => run(async () => {
    if (!s.school_days.length) throw new Error('اختر يوم دوام واحداً على الأقل.');
    if ((minutesOf(s.start) ?? 0) >= (minutesOf(s.end) ?? 0)) throw new Error('بداية الدوام يجب أن تسبق نهايته.');
    await check(supabase.from('app_settings').upsert({ key: 'schedule', value: s, updated_at: new Date().toISOString() }));
    onSaved();
  }, 'حُفظت إعدادات الجدول');
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>الجدول الذكي</h3>
      <p className="dim small" style={{ margin: 0 }}>
        يُبرز التطبيق للطالب جدول <b>اليوم</b> إن فتحه قبل ساعة التحويل (حتى لو كان في السابعة صباحاً)، وبعدها يُبرز <b>يوم الدوام التالي</b> تلقائياً، ويتخطى العطلة.
      </p>
      <div className="row">
        {WEEKDAYS.map((d, i) => (
          <label key={d} className="check"><input type="checkbox" checked={s.school_days.includes(i)}
            onChange={(e) => setS({ ...s, school_days: e.target.checked ? [...s.school_days, i].sort() : s.school_days.filter((x) => x !== i) })} /> {d}</label>
        ))}
      </div>
      <div className="form">
        <Field label="بداية الدوام"><input className="input" type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} /></Field>
        <Field label="نهاية الدوام"><input className="input" type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} /></Field>
        <Field label="بعد هذه الساعة يعرض اليوم التالي"><input className="input" type="time" value={s.switch_after} onChange={(e) => setS({ ...s, switch_after: e.target.value })} /></Field>
        <button className="btn primary" onClick={save} disabled={busy}>حفظ الإعدادات</button>
      </div>
    </div>
  );
}

type EditorData = { schedules: Schedule[]; sections: Section[]; subjects: Subject[]; settings: ScheduleSettings };

function Editor({ id: initialId, data, onClose }: { id: string | null; data: EditorData; onClose: () => void }) {
  const { run, busy } = useAction();
  const toast = useToast();
  const existing = data.schedules.find((s) => s.id === initialId);
  const [id, setId] = useState<string | null>(initialId);
  const [meta, setMeta] = useState({
    title: existing?.title ?? '', subtitle: existing?.subtitle ?? '', kind: (existing?.kind ?? 'weekly') as ScheduleKind,
    section_id: existing?.section_id ?? '', is_published: existing?.is_published ?? false, sort: existing?.sort ?? 0,
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(!initialId);
  const [auto, setAuto] = useState({ start: data.settings.start, lesson: 45, gap: 5 });
  const days = data.settings.school_days;
  const weekly = meta.kind === 'weekly';

  useEffect(() => {
    if (!initialId) return;
    must(supabase.from('schedule_items').select('*').eq('schedule_id', initialId)).then((items) => {
      const loadedRows = (items as ScheduleItem[]).map(toRow);
      // الحصص الفارغة لا تُحفظ؛ نعيدها صفوفاً فارغة في مكانها حتى لا تتزحزح الحصص عند التعديل
      for (const d of new Set(loadedRows.filter((r) => r.day !== null).map((r) => r.day!))) {
        const have = new Set(loadedRows.filter((r) => r.day === d).map((r) => r.sort));
        for (let n = 1; n <= Math.max(...have); n++) if (!have.has(n)) loadedRows.push(blank({ day: d, sort: n }));
      }
      setRows(loadedRows);
      setLoaded(true);
    }).catch((e) => toast(e instanceof Error ? e.message : 'تعذّر التحميل', true));
  }, [initialId, toast]);

  const patch = (rid: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === rid ? { ...r, ...p } : r)));
  const dayRows = (d: number) => rows.filter((r) => r.day === d).sort((a, b) => a.sort - b.sort);

  const setCount = (d: number, n: number) => setRows((rs) => {
    const mine = rs.filter((r) => r.day === d).sort((a, b) => a.sort - b.sort);
    const others = rs.filter((r) => r.day !== d);
    // بلا إعادة ترقيم: كل حصة تبقى في رقمها (وإلا تنتقل المواد لحصص أخرى وأوقاتها باقية)
    const next = mine.slice(0, n);
    let sort = next.reduce((m, r) => Math.max(m, r.sort), 0);
    while (next.length < n) next.push(blank({ day: d, sort: ++sort }));
    return [...others, ...next];
  });
  const removeRow = (r: Row) => setRows((rs) => {
    const left = rs.filter((x) => x.id !== r.id);
    return r.day === null ? left : left.map((x) => (x.day === r.day && x.sort > r.sort ? { ...x, sort: x.sort - 1 } : x));
  });
  const copyDay = (from: number) => setRows((rs) => {
    const src = rs.filter((r) => r.day === from).sort((a, b) => a.sort - b.sort);
    const keep = rs.filter((r) => r.day === from || !days.includes(r.day ?? -1));
    const copies = days.filter((d) => d !== from).flatMap((d) => src.map((r) => ({ ...r, id: uid(), day: d })));
    return [...keep, ...copies];
  });
  const applyTimes = () => {
    const start = minutesOf(auto.start);
    if (start === null) return toast('اكتب وقت بداية صحيحاً', true);
    setRows((rs) => rs.map((r) => {
      if (r.day === null) return r;
      const s = start + (r.sort - 1) * (auto.lesson + auto.gap);
      return { ...r, start_time: hhmm(s), end_time: hhmm(s + auto.lesson) };
    }));
    toast('طُبّقت الأوقات على كل الأيام (لم تُحفظ بعد)');
  };

  const save = () => run(async () => {
    if (!meta.title.trim()) throw new Error('اكتب اسم الجدول');
    const clean = rows.filter((r) => r.subject_id || r.title.trim() || r.on_date);
    for (const r of clean) {
      for (const t of [r.start_time, r.end_time]) if (t && !/^[0-2]\d:[0-5]\d$/.test(t)) throw new Error('وقت غير صحيح في أحد الصفوف');
      if (meta.kind === 'exam' && !r.on_date) throw new Error('كل موعد في جدول الامتحانات يحتاج تاريخاً');
    }
    const head = {
      title: meta.title.trim(), subtitle: meta.subtitle.trim() || null, kind: meta.kind,
      section_id: meta.section_id || null, is_published: meta.is_published, sort: meta.sort, updated_at: new Date().toISOString(),
    };
    let sid = id;
    if (sid) await check(supabase.from('schedules').update(head).eq('id', sid));
    else {
      const { data: row, error } = await supabase.from('schedules').insert(head).select('id').single();
      if (error) throw new Error(error.message);
      sid = row.id as string;
      setId(sid);
    }
    // العناصر: upsert للموجود والجديد، وحذف ما أُزيل
    const payload = clean.map((r, i) => toItem(weekly ? r : { ...r, sort: i + 1 }, sid!));
    if (payload.length) await check(supabase.from('schedule_items').upsert(payload, { onConflict: 'id' }));
    const keep = payload.map((p) => p.id);
    const del = supabase.from('schedule_items').delete().eq('schedule_id', sid!);
    await check(keep.length ? del.not('id', 'in', `(${keep.join(',')})`) : del);
    setRows(clean);
  }, 'حُفظ الجدول');

  const print = () => {
    try {
      const items = rows.filter((r) => r.subject_id || r.title.trim() || r.on_date).map((r) => ({ ...toItem(r, id ?? 'x'), id: r.id })) as ScheduleItem[];
      const schedule = { id: id ?? 'x', ...meta, subtitle: meta.subtitle || null, section_id: meta.section_id || null, created_at: '', updated_at: '' } as Schedule;
      printSchedule({ schedule, items, subjects: data.subjects, sections: data.sections, settings: data.settings, school: SCHOOL });
    } catch (e) { toast(e instanceof Error ? e.message : 'تعذّرت الطباعة', true); }
  };

  const subjectSelect = (r: Row) => (
    <select className="input" value={r.subject_id} onChange={(e) => patch(r.id, { subject_id: e.target.value })} aria-label="المادة">
      <option value="">— المادة —</option>
      {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  const total = useMemo(() => rows.filter((r) => r.subject_id || r.title.trim() || r.on_date).length, [rows]);

  return (
    <>
      <div className="head">
        <h1>{id ? 'تعديل الجدول' : 'جدول جديد'}</h1>
        <div className="row">
          <button className="btn" onClick={print}>طباعة A4</button>
          <button className="btn" onClick={onClose}>رجوع للقائمة</button>
          <button className="btn primary" onClick={save} disabled={busy || !loaded}>حفظ</button>
        </div>
      </div>

      <div className="card">
        <div className="form">
          <Field label="اسم الجدول"><input className="input" value={meta.title} placeholder="مثال: جدول الحصص — شعبة أ" onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
          <Field label="وصف قصير (اختياري)"><input className="input" value={meta.subtitle} placeholder="مثال: الفصل الدراسي الأول" onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })} /></Field>
          <Field label="النوع">
            <select className="input" value={meta.kind} disabled={!!id && rows.length > 0} onChange={(e) => setMeta({ ...meta, kind: e.target.value as ScheduleKind })}>
              {(Object.keys(SCHEDULE_KIND_LABELS) as ScheduleKind[]).map((k) => <option key={k} value={k}>{SCHEDULE_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="لمن؟">
            <select className="input" value={meta.section_id} onChange={(e) => setMeta({ ...meta, section_id: e.target.value })}>
              <option value="">كل الشعب</option>
              {data.sections.map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
            </select>
          </Field>
          <Field label="الترتيب في التطبيق"><input className="input" type="number" value={meta.sort} onChange={(e) => setMeta({ ...meta, sort: Number(e.target.value) || 0 })} /></Field>
          <label className="check"><input type="checkbox" checked={meta.is_published} onChange={(e) => setMeta({ ...meta, is_published: e.target.checked })} /> منشور للطلاب</label>
        </div>
      </div>

      {!loaded ? <Empty>يحمّل…</Empty> : weekly ? (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3>أوقات تلقائية</h3>
            <div className="form">
              <Field label="بداية الحصة الأولى"><input className="input" type="time" value={auto.start} onChange={(e) => setAuto({ ...auto, start: e.target.value })} /></Field>
              <Field label="مدة الحصة (دقيقة)"><input className="input" type="number" min={10} value={auto.lesson} onChange={(e) => setAuto({ ...auto, lesson: Number(e.target.value) || 45 })} /></Field>
              <Field label="الاستراحة بين الحصص (دقيقة)"><input className="input" type="number" min={0} value={auto.gap} onChange={(e) => setAuto({ ...auto, gap: Number(e.target.value) || 0 })} /></Field>
              <button className="btn" onClick={applyTimes}>تطبيق على كل الأيام</button>
            </div>
          </div>
          {days.map((d) => {
            const list = dayRows(d);
            return (
              <div key={d} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{WEEKDAYS[d]} <span className="pill">{list.length} حصص</span></h3>
                  <div className="row">
                    <label className="row small dim" style={{ gap: 6 }}>عدد الحصص
                      <input className="input" type="number" min={0} max={12} style={{ width: 70, height: 36 }} value={list.length} onChange={(e) => setCount(d, Math.max(0, Math.min(12, Number(e.target.value) || 0)))} />
                    </label>
                    <button className="btn sm" onClick={() => copyDay(d)} disabled={!list.length}>نسخ هذا اليوم لبقية الأيام</button>
                  </div>
                </div>
                {list.length ? list.map((r) => (
                  <div key={r.id} className="sch-row">
                    <b className="sch-no">{r.sort}</b>
                    {subjectSelect(r)}
                    <input className="input" placeholder="أو عنوان حر (مثل: نشاط)" value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
                    <input className="input" placeholder="الأستاذ" value={r.teacher} onChange={(e) => patch(r.id, { teacher: e.target.value })} />
                    <input className="input" type="time" value={r.start_time} onChange={(e) => patch(r.id, { start_time: e.target.value })} aria-label="من" />
                    <input className="input" type="time" value={r.end_time} onChange={(e) => patch(r.id, { end_time: e.target.value })} aria-label="إلى" />
                    <button className="btn danger sm" onClick={() => removeRow(r)} aria-label="حذف الحصة">حذف</button>
                  </div>
                )) : <div className="dim small">لا حصص — حدد العدد أعلاه أو اضغط إضافة.</div>}
                <div><button className="btn sm" onClick={() => setCount(d, list.length + 1)}>+ حصة</button></div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{meta.kind === 'exam' ? 'مواعيد الامتحانات' : 'عناصر الجدول'} <span className="pill">{total}</span></h3>
            <button className="btn sm primary" onClick={() => setRows((rs) => [...rs, blank({ sort: rs.length + 1 })])}>+ إضافة موعد</button>
          </div>
          {[...rows].sort((a, b) => (a.on_date || '9').localeCompare(b.on_date || '9') || a.sort - b.sort).map((r) => (
            <div key={r.id} className="sch-row dated">
              <input className="input" type="date" value={r.on_date} onChange={(e) => patch(r.id, { on_date: e.target.value })} aria-label="التاريخ" />
              {subjectSelect(r)}
              <input className="input" placeholder="أو عنوان حر" value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
              <input className="input" type="time" value={r.start_time} onChange={(e) => patch(r.id, { start_time: e.target.value })} aria-label="من" />
              <input className="input" type="time" value={r.end_time} onChange={(e) => patch(r.id, { end_time: e.target.value })} aria-label="إلى" />
              <input className="input" placeholder="المكان / القاعة" value={r.place} onChange={(e) => patch(r.id, { place: e.target.value })} />
              <input className="input" placeholder="ملاحظة" value={r.note} onChange={(e) => patch(r.id, { note: e.target.value })} />
              <button className="btn danger sm" onClick={() => removeRow(r)} aria-label="حذف">حذف</button>
            </div>
          ))}
          {!rows.length ? <Empty>أضف أول موعد. الجداول الشهرية ونصف السنة تُنشأ كلٌّ بجدول مستقل باسمه.</Empty> : null}
        </div>
      )}
      <p className="small dim">{total} عنصر · اضغط «حفظ» لتثبيت التعديلات، و«طباعة A4» تطبع ما تراه الآن.</p>
    </>
  );
}
