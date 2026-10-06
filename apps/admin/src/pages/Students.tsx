import {
  PERIOD_LABELS, PERIODS, ROLE_LABELS, STATUS_LABELS, effortStatus, formatScore, generalExemption, parseRules,
  type Period, type Profile, type ProfileStatus, type Role, type Section, type Subject, type SubjectScores,
} from '@saey/shared';
import { useState } from 'react';
import { Avatar, Empty, Modal, Tabs, Verified, check, useAction } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

type Filter = 'pending' | 'approved' | 'rejected' | 'banned';
const STATUS_PILL: Record<ProfileStatus, string> = { pending: 'warn', approved: 'ok', rejected: 'bad', banned: 'bad' };

export default function Students({ onChange }: { onChange: () => void }) {
  const { isAdmin, profile: me } = useAuth();
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [gradesFor, setGradesFor] = useState<Profile | null>(null);
  const { run } = useAction();

  const q = useLoad(async () => {
    const [people, sections] = await Promise.all([
      must(supabase.from('profiles').select('*').order('created_at', { ascending: false })),
      must(supabase.from('sections').select('*').order('sort')),
    ]);
    return { people: people as Profile[], sections: sections as Section[] };
  });

  const update = (p: Profile, patch: Partial<Profile>, msg: string) =>
    run(async () => {
      await check(supabase.from('profiles').update(patch).eq('id', p.id));
      await q.reload();
      onChange();
    }, msg);

  const people = (q.data?.people ?? []).filter((p) => (filter === 'pending' ? p.status === 'pending' && p.onboarded : p.status === filter))
    .filter((p) => p.full_name.includes(search.trim()));
  const count = (s: Filter) => (q.data?.people ?? []).filter((p) => (s === 'pending' ? p.status === 'pending' && p.onboarded : p.status === s)).length;
  const sectionName = (id: string | null) => q.data?.sections.find((s) => s.id === id)?.name ?? '—';

  return (
    <>
      <div className="head">
        <h1>الطلاب</h1>
        <input className="input" style={{ maxWidth: 260 }} placeholder="بحث بالاسم" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Tabs<Filter> value={filter} onChange={setFilter} options={[
        { key: 'pending', label: 'طلبات الانضمام', count: count('pending') },
        { key: 'approved', label: 'المعتمدون', count: count('approved') },
        { key: 'rejected', label: 'المرفوضون' },
        { key: 'banned', label: 'المحظورون' },
      ]} />
      {q.loading ? <Empty>جارٍ التحميل…</Empty> : people.length === 0 ? <Empty>لا يوجد أحد هنا</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الطالب</th><th>الشعبة</th><th>الدور</th><th>الحالة</th><th>انضم</th><th /></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={p.full_name} url={p.avatar_url} />
                      <div>
                        <div className="row" style={{ gap: 4 }}><b>{p.full_name || 'بدون اسم'}</b>{p.is_verified ? <Verified /> : null}</div>
                        {p.bio ? <div className="small dim">{p.bio}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <select className="input" style={{ height: 34, width: 110 }} value={p.section_id ?? ''} onChange={(e) => update(p, { section_id: e.target.value || null }, 'تم تغيير الشعبة')}>
                        <option value="">—</option>
                        {q.data!.sections.map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
                      </select>
                    ) : sectionName(p.section_id)}
                  </td>
                  <td>
                    {isAdmin && p.id !== me?.id ? (
                      <select className="input" style={{ height: 34, width: 110 }} value={p.role} onChange={(e) => update(p, { role: e.target.value as Role }, 'تم تغيير الدور')}>
                        {(['student', 'moderator', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : <span className="pill accent">{ROLE_LABELS[p.role]}</span>}
                  </td>
                  <td><span className={`pill ${STATUS_PILL[p.status]}`}>{STATUS_LABELS[p.status]}</span></td>
                  <td className="small dim">{new Date(p.created_at).toLocaleDateString('ar-IQ')}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      {p.status !== 'approved' && isAdmin ? <button className="btn primary sm" onClick={() => update(p, { status: 'approved' }, 'تم القبول')}>قبول</button> : null}
                      {p.status === 'pending' && isAdmin ? <button className="btn danger sm" onClick={() => update(p, { status: 'rejected', onboarded: false }, 'تم الرفض')}>رفض</button> : null}
                      {p.status === 'approved' ? <button className="btn sm" onClick={() => setGradesFor(p)}>الدرجات</button> : null}
                      {p.status === 'approved' && isAdmin ? (
                        <button className="btn sm" onClick={() => update(p, { is_verified: !p.is_verified }, p.is_verified ? 'أُزيل التوثيق' : 'تم التوثيق')}>
                          {p.is_verified ? 'إلغاء التوثيق' : 'توثيق'}
                        </button>
                      ) : null}
                      {p.status === 'approved' && isAdmin && p.id !== me?.id ? (
                        <button className="btn danger sm" onClick={() => confirm(`حظر ${p.full_name}؟`) && update(p, { status: 'banned' }, 'تم الحظر')}>حظر</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isAdmin ? <p className="small dim">قبول الطلاب وتغيير الأدوار للأدمن فقط.</p> : null}
      {gradesFor ? <GradesModal student={gradesFor} onClose={() => setGradesFor(null)} /> : null}
    </>
  );
}

function GradesModal({ student, onClose }: { student: Profile; onClose: () => void }) {
  const q = useLoad(async () => {
    const [subjects, grades, settings] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')),
      must(supabase.from('grades').select('subject_id, period, score').eq('user_id', student.id)),
      supabase.from('app_settings').select('value').eq('key', 'grading').maybeSingle(),
    ]);
    const map: Record<string, SubjectScores> = {};
    for (const g of grades as { subject_id: string; period: Period; score: number }[]) {
      map[g.subject_id] ??= {};
      map[g.subject_id][g.period] = Number(g.score);
    }
    return { subjects: subjects as Subject[], map, rules: parseRules(settings.data?.value) };
  }, [student.id]);

  const d = q.data;
  const general = d ? generalExemption(Object.fromEntries(d.subjects.map((s) => [s.id, d.map[s.id] ?? {}])), d.rules) : null;
  return (
    <Modal title={`درجات ${student.full_name}`} onClose={onClose}>
      {!d ? <Empty>جارٍ التحميل…</Empty> : (
        <>
          <div className="row">
            <span className="pill accent">المعدل {formatScore(general?.average)}</span>
            <span className={`pill ${general?.exempt ? 'ok' : 'warn'}`}>الإعفاء العام: {general?.exempt ? 'على الطريق' : 'غير متحقق'}</span>
          </div>
          <div className="table-wrap wide">
            <table>
              <thead><tr><th>المادة</th>{PERIODS.map((p) => <th key={p}>{PERIOD_LABELS[p]}</th>)}<th>السعي</th></tr></thead>
              <tbody>
                {d.subjects.map((s) => {
                  const g = d.map[s.id] ?? {};
                  const st = effortStatus(g);
                  return (
                    <tr key={s.id}>
                      <td><b>{s.name}</b></td>
                      {PERIODS.map((p) => <td key={p} className="num">{formatScore(g[p])}</td>)}
                      <td className="num"><b>{formatScore(st.annual ?? st.current)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
