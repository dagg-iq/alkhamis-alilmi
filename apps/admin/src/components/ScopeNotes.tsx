import type { Subject } from '@saey/shared';
import { useEffect, useState } from 'react';
import { useLoad } from '../lib/hooks';
import { must, supabase } from '../lib/supabase';
import { check, useAction } from './ui';

/**
 * حدود المقرر لكل مادة (الداخل في الامتحان وما هو للاطلاع أو محذوف) — المساعد الذكي يعتبرها المرجع الأعلى.
 * تُحفظ في app_settings بالمفتاح ai_scope: { [subject_id]: نص }.
 */
export function ScopeNotes() {
  const { run, busy } = useAction();
  const q = useLoad(async () => {
    const [subjects, row] = await Promise.all([
      must(supabase.from('subjects').select('*').order('sort')) as Promise<Subject[]>,
      supabase.from('app_settings').select('value').eq('key', 'ai_scope').maybeSingle(),
    ]);
    return { subjects, notes: (row.data?.value ?? {}) as Record<string, string> };
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setNotes(q.data.notes); }, [q.data]);

  const save = () => run(async () => {
    const clean = Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    await check(supabase.from('app_settings').upsert({ key: 'ai_scope', value: clean, updated_at: new Date().toISOString() }));
  }, 'حُفظت حدود المقرر');

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>حدود المقرر للمساعد الذكي</h2>
        <button className="btn primary sm" onClick={save} disabled={busy || !q.data}>حفظ الحدود</button>
      </div>
      <p className="small dim" style={{ margin: 0 }}>
        اكتب لكل مادة ما هو داخل في الامتحان وما هو للاطلاع أو محذوف. المساعد يلتزم بها بصرامة (يذكر المطلوب فقط ويُعلّم الباقي «للاطلاع»).
        بدونها يعتمد على ما يكتبه الكتاب نفسه («للحفظ»، «للاطلاع»، «إثراء»).
        مثال للعربية: «قصيدة المتنبي: المطلوب حفظ ٨ أبيات (من ١ إلى ٨)، والمعاني ضمنها فقط». مثال للإسلامية: «سورة الكهف: الحفظ من الآية ١ إلى ١٠».
      </p>
      {(q.data?.subjects ?? []).map((s) => (
        <label key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <b className="small">{s.name}</b>
          <textarea className="input" rows={3} style={{ height: 'auto', paddingTop: 8, resize: 'vertical' }} maxLength={3000}
            value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
            placeholder="مثلاً: الفصل الرابع محذوف. موضوع كذا للاطلاع. القصيدة: حفظ ٨ أبيات…" />
        </label>
      ))}
    </div>
  );
}
