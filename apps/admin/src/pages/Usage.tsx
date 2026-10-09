import { useEffect, useMemo, useState } from 'react';
import { Empty, Field, Tabs, check, useAction } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { callFunction, must, supabase } from '../lib/supabase';

/**
 * استخدام Gemini: كم طلباً بقي لكل مفتاح ولكل نموذج اليوم، وما المقفل ومتى يعود، وكم استخدم كل طالب.
 * حصة Google المجانية: ٢٠ طلباً يومياً و٥ في الدقيقة لكل نموذج في كل مشروع.
 * اليوم يتجدد ٣:٠٠ فجراً بتوقيت بغداد (= منتصف الليل UTC).
 */
interface Slots { slots: string[]; per_model: number; models: string[]; fallback: string[] }
interface UsageRow { day: string; slot: string; model: string; requests: number; errors: number; last_status: number | null; last_error: string | null; last_at: string | null }
interface Block { slot: string; model: string; blocked_until: string; reason: string | null }
interface StudentUse { user_id: string; day: string; count: number; profiles: { full_name: string; sections: { name: string } | null } | null }

const EMBED = 'gemini-embedding-001';
const short = (m: string) => m.replace('gemini-', '').replace('-flash-lite', ' Flash-Lite').replace('-flash', ' Flash');
export const slotLabel = (s: string) => s === 'GEMINI_ADMIN_API_KEY' ? 'مفتاح لوحة التحكم' : s === 'GEMINI_API_KEY' ? 'مفتاح الطلاب ١' : `مفتاح الطلاب ${s.replace('GEMINI_API_KEY_', '')}`;
const ar = (n: number) => n.toLocaleString('ar-IQ');
const time = (iso: string) => new Date(iso).toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' });
/** يوم الحصة: يبدأ ٣ فجراً بغداد = منتصف الليل UTC */
const quotaDay = (d = new Date()) => d.toISOString().slice(0, 10);

function untilReset(now: number) {
  const n = new Date(now);
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  const m = Math.max(0, Math.round((next - now) / 60000));
  return `${ar(Math.floor(m / 60))} س ${ar(m % 60)} د`;
}

type View = 'keys' | 'students';

/** دائرة نسبة (SVG) بلون حسب الامتلاء */
function Ring({ value, label, center, sub, color }: { value: number; label: string; center: string; sub?: string; color?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 52;
  const c = 2 * Math.PI * r;
  const col = color ?? (v >= 0.9 ? 'var(--bad)' : v >= 0.7 ? 'var(--warn)' : 'var(--accent)');
  return (
    <div className="card usage-ring">
      <svg viewBox="0 0 130 130" width="130" height="130" aria-hidden="true">
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        <circle cx="65" cy="65" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray .6s' }} />
        <text x="65" y="64" textAnchor="middle" fontSize={center.length > 6 ? 17 : 24} fontWeight="900" fill="currentColor">{center}</text>
        {sub ? <text x="65" y="86" textAnchor="middle" fontSize="11" fill="var(--ink2)">{sub}</text> : null}
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function Usage() {
  const [view, setView] = useState<View>('keys');
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // تشغيل المساعد وحد الأسئلة اليومي لكل طالب (النماذج تُختار تلقائياً بالترتيب، فلا إعداد لها)
  const { run, busy } = useAction();
  const [aiCfg, setAiCfg] = useState<{ enabled: boolean; daily_limit: number } | null>(null);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'ai').maybeSingle().then(({ data }) => {
      const v = (data?.value ?? {}) as { enabled?: boolean; daily_limit?: number };
      setAiCfg({ enabled: v.enabled !== false, daily_limit: v.daily_limit ?? 20 });
    });
  }, []);
  const saveAi = () => run(async () => {
    if (!aiCfg) return;
    if (!Number.isFinite(aiCfg.daily_limit) || aiCfg.daily_limit < 0 || aiCfg.daily_limit > 500) throw new Error('عدد الأسئلة اليومية غير صحيح.');
    await check(supabase.from('app_settings').upsert({ key: 'ai', value: { enabled: aiCfg.enabled, daily_limit: Math.round(aiCfg.daily_limit) }, updated_at: new Date().toISOString() }));
  }, 'حُفظ');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const q = useLoad(async () => {
    const today = quotaDay();
    const week = quotaDay(new Date(Date.now() - 6 * 86400000));
    const [slots, usage, blocks, students] = await Promise.all([
      callFunction<Slots>('content-ai', { action: 'key_slots' }),
      must(supabase.from('ai_key_usage').select('*').eq('day', today)) as Promise<UsageRow[]>,
      must(supabase.from('ai_key_blocks').select('*').gt('blocked_until', new Date().toISOString())) as Promise<Block[]>,
      must(supabase.from('ai_usage').select('user_id, day, count, profiles(full_name, sections(name))').gte('day', week).order('count', { ascending: false }).limit(1000)) as unknown as Promise<StudentUse[]>,
    ]);
    return { slots, usage, blocks, students, today };
  });
  // تحديث تلقائي كل دقيقة
  useEffect(() => { const t = setInterval(() => q.reload(), 60_000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const d = q.data;
  const calc = useMemo(() => {
    if (!d) return null;
    const models = [...d.slots.models, ...d.slots.fallback];
    const per = d.slots.per_model;
    const blockOf = (slot: string, model: string) => d.blocks.find((b) => b.slot === slot && (b.model === model || b.model === '*'));
    const useOf = (slot: string, model: string) => d.usage.find((u) => u.slot === slot && u.model === model);
    const keys = d.slots.slots.map((slot) => {
      const dead = d.blocks.find((b) => b.slot === slot && b.model === '*');
      const rows = models.map((model) => {
        const u = useOf(slot, model);
        const b = blockOf(slot, model);
        const used = u?.requests ?? 0;
        const daily = !!b && (/اليومية/.test(b.reason ?? '') || Date.parse(b.blocked_until) - now > 10 * 60_000);
        const left = dead ? 0 : daily ? 0 : Math.max(0, per - used);
        return { model, used, errors: u?.errors ?? 0, left, block: b, daily, lastError: u?.last_error };
      });
      const used = rows.reduce((a, r) => a + r.used, 0);
      const left = rows.reduce((a, r) => a + r.left, 0);
      const embed = useOf(slot, EMBED);
      return { slot, dead, rows, used, left, embed };
    });
    const working = keys.filter((k) => !k.dead);
    const capacity = working.length * models.length * per;
    const used = keys.reduce((a, k) => a + k.used, 0);
    const left = keys.reduce((a, k) => a + k.left, 0);
    // الطلاب: اليوم وآخر ٧ أيام
    const byStudent = new Map<string, { name: string; section: string; today: number; week: number }>();
    for (const r of d.students) {
      const cur = byStudent.get(r.user_id) ?? { name: r.profiles?.full_name ?? '—', section: r.profiles?.sections?.name ?? '', today: 0, week: 0 };
      cur.week += r.count;
      if (r.day === d.today) cur.today += r.count;
      byStudent.set(r.user_id, cur);
    }
    const students = [...byStudent.values()].sort((a, b) => b.today - a.today || b.week - a.week);
    const studentsToday = students.reduce((a, s) => a + s.today, 0);
    return { keys, capacity, used, left, students, studentsToday, models, per, working: working.length, total: keys.length };
  }, [d, now]);

  if (q.error) return <><div className="head"><h1>الاستخدام</h1></div><Empty>{q.error}</Empty></>;
  if (!d || !calc) return <><div className="head"><h1>الاستخدام</h1></div><Empty>جارٍ التحميل…</Empty></>;

  return (
    <>
      <div className="head">
        <h1>الاستخدام</h1>
        <button className="btn" onClick={() => q.reload()}>تحديث</button>
      </div>
      <p className="small dim" style={{ marginTop: 0 }}>
        حصة Google المجانية: {ar(calc.per)} طلباً يومياً و٥ في الدقيقة <b>لكل نموذج في كل مفتاح</b>. الترتيب: كل نماذج المفتاح الأول (3.8 ← 3.7 ← … ← 3.1) ثم المفتاح التالي، ثم 2.5 احتياطاً.
        يتجدد العدّ <b>٣:٠٠ فجراً</b> (بعد {untilReset(now)}). النموذج الذي تنتهي حصته يُقفل حتى الوقت الذي تحدده Google.
      </p>

      <div className="usage-rings">
        <Ring value={calc.capacity ? calc.used / calc.capacity : 0} label="المستخدم من السعة اليومية"
          center={`${ar(Math.round(calc.capacity ? (calc.used / calc.capacity) * 100 : 0))}٪`} sub={`${ar(calc.used)} من ${ar(calc.capacity)}`} />
        {(() => {
          // اليوم من ٣:٠٠ فجراً إلى ٣:٠٠ فجراً: كم مضى وكم بقي حتى تتجدد كل النماذج
          const n = new Date(now);
          const start = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
          const passed = (now - start) / 86400000;
          return <Ring value={passed} color="var(--ok)" label="الوقت حتى تجدد الحصة (٣:٠٠ فجراً)" center={untilReset(now)} sub={`مضى ${ar(Math.round(passed * 100))}٪`} />;
        })()}
        <Ring value={calc.total ? calc.working / calc.total : 0} color="var(--accent)" label="المفاتيح التي تعمل" center={`${ar(calc.working)}/${ar(calc.total)}`} sub="مفتاح" />
      </div>

      <div className="grid">
        <div className="card stat hero"><b className="num">{ar(calc.left)}</b><span>طلباً متبقياً اليوم (تقريباً)</span></div>
        <div className="card stat"><b className="num">{ar(calc.used)}</b><span className="dim">طلباً استُخدم اليوم</span></div>
        <div className="card stat"><b className="num">{ar(calc.capacity)}</b><span className="dim">السعة اليومية ({ar(calc.working)} مفتاح يعمل × {ar(calc.models.length)} نماذج × {ar(calc.per)})</span></div>
        <div className="card stat"><b className="num">{ar(calc.studentsToday)}</b><span className="dim">سؤالاً من الطلاب للمساعد اليوم</span></div>
      </div>
      <div className="card soft" style={{ marginTop: 14 }}>
        <b>حساب السعة:</b> كل مفتاح = {ar(calc.models.length)} نماذج × {ar(calc.per)} = {ar(calc.models.length * calc.per)} طلباً يومياً.
        {' '}بـ٥ مفاتيح ≈ {ar(5 * calc.models.length * calc.per)}، وبـ٧ مفاتيح ≈ {ar(7 * calc.models.length * calc.per)} طلباً يومياً (منها {ar(2 * calc.per)} لكل مفتاح من 2.5 الاحتياطي).
        {' '}فهرسة كتاب ≈ عدد صفحاته ÷ ٦ طلباً (كتاب ٢٣٢ صفحة ≈ ٤٠ طلباً). كل مفتاح يجب أن يكون من <b>حساب Google مختلف</b> (مفاتيح الحساب الواحد تتشارك نفس الحصة).
      </div>

      {aiCfg ? (
        <div className="card" style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={aiCfg.enabled} onChange={(e) => setAiCfg({ ...aiCfg, enabled: e.target.checked })} /> المساعد الذكي مفعّل للطلاب</label>
          <div style={{ width: 220 }}>
            <Field label="عدد الأسئلة اليومية لكل طالب">
              <input className="input" type="number" min={0} max={500} value={aiCfg.daily_limit} onChange={(e) => setAiCfg({ ...aiCfg, daily_limit: Number(e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) })} />
            </Field>
          </div>
          <button className="btn primary" onClick={saveAi} disabled={busy}>حفظ</button>
          <span className="small dim" style={{ flexBasis: '100%' }}>
            مع {ar(calc.capacity)} طلباً يومياً: حد {ar(aiCfg.daily_limit)} سؤالاً يكفي {ar(Math.floor(calc.capacity / Math.max(1, aiCfg.daily_limit)))} طالباً يستخدمون حدهم كاملاً (والفهرسة تأخذ من نفس السعة).
          </span>
        </div>
      ) : null}

      <Tabs<View> value={view} onChange={setView} options={[
        { key: 'keys', label: 'المفاتيح والنماذج' },
        { key: 'students', label: 'الطلاب', count: calc.students.length },
      ]} />

      {view === 'keys' ? calc.keys.map((k) => (
        <div key={k.slot} className="card" style={{ marginBottom: 14 }}>
          <button className="usage-key-head" onClick={() => setOpen((o) => ({ ...o, [k.slot]: !o[k.slot] }))} aria-expanded={!!open[k.slot]}>
            <span className="usage-chev" style={{ transform: open[k.slot] ? 'rotate(180deg)' : undefined }}>▾</span>
            <div style={{ flex: 1, textAlign: 'start' }}>
              <b style={{ fontSize: 17 }}>{slotLabel(k.slot)}</b> <span className="small dim">({k.slot})</span>
              {!k.dead ? <div className="progress" style={{ marginTop: 8, maxWidth: 360 }}><div style={{ width: `${Math.min(100, (k.used / (calc.models.length * calc.per)) * 100)}%` }} /></div> : null}
            </div>
            {k.dead ? <span className="pill bad">متوقف</span>
              : <span className={`pill ${k.left > 0 ? 'ok' : 'warn'}`}>بقي {ar(k.left)} من {ar(calc.models.length * calc.per)}</span>}
          </button>
          {k.dead ? <p className="small" style={{ color: 'var(--bad)' }}>Google رفضت هذا المفتاح، فيُتخطى تلقائياً حتى {time(k.dead.blocked_until)} ثم يُجرَّب من جديد. السبب من Google: «{k.dead.reason}».</p> : null}
          {k.dead || !open[k.slot] ? null : <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>النموذج</th><th>استُخدم</th><th style={{ width: '30%' }} /><th>الحالة</th><th>أخطاء</th></tr></thead>
              <tbody>
                {k.rows.map((r) => (
                  <tr key={r.model}>
                    <td><b>{short(r.model)}</b>{calc.models.indexOf(r.model) >= calc.models.length - 2 ? <span className="pill" style={{ marginInlineStart: 6 }}>احتياط</span> : null}</td>
                    <td className="num">{ar(r.used)} / {ar(calc.per)}</td>
                    <td><div className="progress"><div style={{ width: `${Math.min(100, (r.used / calc.per) * 100)}%`, background: r.left === 0 ? 'var(--bad)' : undefined }} /></div></td>
                    <td>
                      {k.dead ? <span className="pill bad">المفتاح متوقف</span>
                        : r.block ? <span className={`pill ${r.daily ? 'bad' : 'warn'}`} title={r.block.reason ?? ''}>{r.daily ? 'انتهت حصته' : r.block.reason ?? 'مقفل'} — يعود {time(r.block.blocked_until)}</span>
                          : r.left > 0 ? <span className="pill ok">متاح ({ar(r.left)})</span> : <span className="pill warn">قارب الانتهاء</span>}
                    </td>
                    <td className="small dim" title={r.lastError ?? ''}>{r.errors ? ar(r.errors) : '—'}</td>
                  </tr>
                ))}
                {k.embed ? <tr><td className="small dim">التضمين (البحث)</td><td className="num small">{ar(k.embed.requests)}</td><td /><td className="small dim">حصة منفصلة</td><td className="small dim">{k.embed.errors ? ar(k.embed.errors) : '—'}</td></tr> : null}
              </tbody>
            </table>
          </div>}
        </div>
      )) : (
        calc.students.length === 0 ? <Empty>لم يسأل أي طالب المساعد خلال آخر ٧ أيام</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>الطالب</th><th>الشعبة</th><th>اليوم</th><th>آخر ٧ أيام</th></tr></thead>
              <tbody>
                {calc.students.map((s, i) => (
                  <tr key={`${s.name}-${i}`}>
                    <td className="dim">{ar(i + 1)}</td>
                    <td><b>{s.name}</b></td>
                    <td>{s.section ? `شعبة ${s.section}` : '—'}</td>
                    <td className="num">{ar(s.today)}</td>
                    <td className="num">{ar(s.week)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
