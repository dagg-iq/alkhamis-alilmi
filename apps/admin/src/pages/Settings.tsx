import { DEFAULT_RULES, parseRules } from '@saey/shared';
import { useEffect, useState } from 'react';
import { Field, check, useAction } from '../components/ui';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';

interface AiSettings { daily_limit: number; model: string; lite_model: string; enabled: boolean }

export default function Settings() {
  const { run, busy } = useAction();
  const q = useLoad(async () => {
    const rows = await must(supabase.from('app_settings').select('key, value')) as { key: string; value: Record<string, unknown> }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
  const [grading, setGrading] = useState(DEFAULT_RULES);
  const [ai, setAi] = useState<AiSettings>({ daily_limit: 20, model: 'gemini-3.8-flash', lite_model: 'gemini-3.5-flash-lite', enabled: true });
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [dms, setDms] = useState(true);

  useEffect(() => {
    if (!q.data) return;
    setGrading(parseRules(q.data.grading));
    setAi({ ...ai, ...(q.data.ai as Partial<AiSettings>) });
    setRegistrationOpen((q.data.registration as { open?: boolean } | undefined)?.open !== false);
    setDms((q.data.chat as { direct_messages?: boolean } | undefined)?.direct_messages !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = () => run(async () => {
    // حماية من أرقام خاطئة تخرب حسابات كل الطلاب
    const vals = [grading.individualExempt, grading.generalAvg, grading.generalMin, grading.pass];
    if (vals.some((v) => !Number.isFinite(v) || v <= 0 || v > 100)) throw new Error('كل أرقام الإعفاء والنجاح يجب أن تكون بين ١ و١٠٠.');
    if (grading.generalMin > grading.generalAvg) throw new Error('حد أقل مادة لا يمكن أن يكون أعلى من معدل الإعفاء العام.');
    if (grading.pass >= grading.generalMin) throw new Error('درجة النجاح يجب أن تكون أقل من حد الإعفاء العام.');
    if (!Number.isFinite(ai.daily_limit) || ai.daily_limit < 0) throw new Error('عدد الأسئلة اليومية غير صحيح.');
    const rows = [
      { key: 'grading', value: { individual_exempt: grading.individualExempt, general_avg: grading.generalAvg, general_min: grading.generalMin, pass: grading.pass, round: grading.round } },
      { key: 'ai', value: ai },
      { key: 'registration', value: { open: registrationOpen } },
      { key: 'chat', value: { direct_messages: dms } },
    ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    await check(supabase.from('app_settings').upsert(rows));
    await q.reload();
  }, 'حُفظت الإعدادات');

  const num = (v: string) => Number(v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));

  return (
    <>
      <div className="head">
        <h1>الإعدادات</h1>
        <button className="btn primary" onClick={save} disabled={busy}>حفظ كل الإعدادات</button>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>ضوابط الإعفاء والنجاح</h2>
        <p className="small dim">غيّرها إذا أصدرت وزارة التربية ضوابط جديدة — يتحدث كل حساب في التطبيق تلقائياً.</p>
        <div className="form">
          <Field label="الإعفاء الفردي (سعي المادة ≥)"><input className="input" type="number" value={grading.individualExempt} onChange={(e) => setGrading({ ...grading, individualExempt: num(e.target.value) })} /></Field>
          <Field label="الإعفاء العام: المعدل ≥"><input className="input" type="number" value={grading.generalAvg} onChange={(e) => setGrading({ ...grading, generalAvg: num(e.target.value) })} /></Field>
          <Field label="الإعفاء العام: أقل مادة ≥"><input className="input" type="number" value={grading.generalMin} onChange={(e) => setGrading({ ...grading, generalMin: num(e.target.value) })} /></Field>
          <Field label="درجة النجاح/الدخول"><input className="input" type="number" value={grading.pass} onChange={(e) => setGrading({ ...grading, pass: num(e.target.value) })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={grading.round === 'half_up'} onChange={(e) => setGrading({ ...grading, round: e.target.checked ? 'half_up' : 'none' })} /> جبر الكسور (٨٩٫٥ تُحسب ٩٠)</label>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>المساعد الذكي</h2>
        <label className="check"><input type="checkbox" checked={ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} /> المساعد مفعّل</label>
        <div className="form">
          <Field label="عدد الأسئلة اليومية لكل طالب"><input className="input" type="number" min={0} value={ai.daily_limit} onChange={(e) => setAi({ ...ai, daily_limit: num(e.target.value) })} /></Field>
          <Field label="النموذج الرئيسي"><input className="input" dir="ltr" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} /></Field>
          <Field label="النموذج الخفيف (للفهرسة)"><input className="input" dir="ltr" value={ai.lite_model} onChange={(e) => setAi({ ...ai, lite_model: e.target.value })} /></Field>
        </div>
        <p className="small dim">الطبقة المجانية من Gemini محدودة يومياً لكل مشروع. إذا كثرت رسائل «المساعد مشغول» خفّض العدد اليومي.</p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>التسجيل والدردشة</h2>
        <label className="check"><input type="checkbox" checked={registrationOpen} onChange={(e) => setRegistrationOpen(e.target.checked)} /> استقبال طلبات انضمام جديدة</label>
        <label className="check"><input type="checkbox" checked={dms} onChange={(e) => setDms(e.target.checked)} /> السماح بالرسائل الخاصة بين الطلاب</label>
      </div>
    </>
  );
}
