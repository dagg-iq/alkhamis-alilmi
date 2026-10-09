import {
  PERIOD_LABELS, PERIODS, QUESTION_KIND_LABELS, type Period, type QuestionKind, type Section, type Subject,
} from '@saey/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { convertImages, pagesToPdf, PAGE_CSS } from '../lib/scan-convert';
import { check, useAction } from './ui';
import { Field, Modal } from './ui';
import { supabase, uploadFile } from '../lib/supabase';

/** رفع صور ورقة أسئلة ← تحويل مباشر إلى PDF بنفس التنسيق ← حفظ ونشر (نفس ميزة التطبيق) */
export function ScanConvert({ subjects, sections, onClose, onSaved }: { subjects: Subject[]; sections: Section[]; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; previews: string[] } | null>(null);
  const [meta, setMeta] = useState({ title: '', subject_id: subjects[0]?.id ?? '', kind: 'expected' as QuestionKind, period: 'month1' as Period, section_id: '' });
  const stage = useRef<HTMLDivElement>(null);
  const thumbs = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  const move = (i: number, d: number) => setFiles((fs) => {
    const j = i + d;
    if (j < 0 || j >= fs.length) return fs;
    const n = [...fs];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const convert = () => run(async () => {
    if (!files.length) throw new Error('اختر صور الورقة أولاً');
    setResult(null);
    try {
      const r = await convertImages(files, setStep);
      setHtml(r.html);
      setStep('إنشاء ملف PDF…');
      // ننتظر رسم الصفحات داخل الحاوية ثم نلتقطها
      await new Promise((res) => setTimeout(res, 400));
      if (!stage.current) throw new Error('تعذّر تجهيز الصفحات');
      setResult(await pagesToPdf(stage.current));
    } finally {
      setStep(null);
    }
  });

  const save = (status: 'draft' | 'published') => run(async () => {
    if (!result) return;
    if (!meta.title.trim()) throw new Error('اكتب عنوان الأسئلة');
    if (!meta.subject_id) throw new Error('اختر المادة');
    const file = new File([result.blob], `${meta.title.trim().slice(0, 50) || 'أسئلة'}.pdf`, { type: 'application/pdf' });
    const key = await uploadFile(file, 'material');
    await check(supabase.from('question_sets').insert({
      subject_id: meta.subject_id, kind: meta.kind, period: meta.period, section_id: meta.kind === 'school_exam' ? meta.section_id || null : null,
      title: meta.title.trim(), content_md: null, pdf_key: key, scan_keys: [], status,
    }));
    onSaved();
    onClose();
  }, status === 'published' ? 'نُشرت للطلاب' : 'حُفظت كمسودة');

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(result.blob);
    a.download = `${meta.title.trim() || 'أسئلة'}.pdf`;
    a.click();
  };

  return (
    <Modal title="أسئلة من صور (تحويل ذكي إلى PDF)" onClose={onClose}>
      <p className="small dim" style={{ margin: 0 }}>ارفع صور ورقة الأسئلة بالترتيب (حتى ١٠). يعيد الذكاء الاصطناعي بناء الورقة بنفس تنسيقها (مواضع النصوص والجداول والأشكال والمعادلات) كملف PDF جاهز للنشر.</p>

      <div className="row">
        <label className="btn primary" style={{ cursor: 'pointer' }}>
          + اختر الصور
          <input type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])].slice(0, 10)); setResult(null); setHtml(null); e.target.value = ''; }} />
        </label>
        {files.length ? <button className="btn sm" onClick={() => { setFiles([]); setResult(null); setHtml(null); }}>مسح الكل</button> : null}
      </div>

      {files.length ? (
        <div className="sc-thumbs">
          {thumbs.map((u, i) => (
            <div key={u} className="sc-thumb">
              <img src={u} alt={`صفحة ${i + 1}`} />
              <b>{i + 1}</b>
              <div className="sc-thumb-act">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="تقديم">→</button>
                <button onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="تأخير">←</button>
                <button onClick={() => { setFiles(files.filter((_, j) => j !== i)); setResult(null); }} aria-label="حذف">×</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="form">
        <Field label="العنوان"><input className="input" value={meta.title} placeholder="مثال: أسئلة الفيزياء — الشهر الأول" onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
        <Field label="المادة">
          <select className="input" value={meta.subject_id} onChange={(e) => setMeta({ ...meta, subject_id: e.target.value })}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="النوع">
          <select className="input" value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as QuestionKind })}>
            <option value="expected">{QUESTION_KIND_LABELS.expected}</option>
            <option value="school_exam">{QUESTION_KIND_LABELS.school_exam}</option>
          </select>
        </Field>
        <Field label="الامتحان">
          <select className="input" value={meta.period} onChange={(e) => setMeta({ ...meta, period: e.target.value as Period })}>
            {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
        </Field>
        {meta.kind === 'school_exam' ? (
          <Field label="الشعبة">
            <select className="input" value={meta.section_id} onChange={(e) => setMeta({ ...meta, section_id: e.target.value })}>
              <option value="">كل الشعب</option>
              {sections.map((s) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
            </select>
          </Field>
        ) : null}
      </div>

      <div className="row">
        <button className="btn primary" onClick={convert} disabled={busy || !files.length}>{step ? 'جارٍ التحويل…' : result ? 'إعادة التحويل' : 'حوّل إلى PDF'}</button>
        {result ? <button className="btn" onClick={download}>تنزيل PDF</button> : null}
      </div>
      {step ? <div className="card soft"><b>{step}</b></div> : null}

      {result ? (
        <>
          <div className="sc-prev">{result.previews.map((p, i) => <img key={i} src={p} alt={`الصفحة ${i + 1}`} />)}</div>
          <div className="row">
            <button className="btn primary" onClick={() => save('published')} disabled={busy}>حفظ ونشر للطلاب</button>
            <button className="btn" onClick={() => save('draft')} disabled={busy}>حفظ كمسودة</button>
          </div>
        </>
      ) : null}

      {/* الصفحات تُرسم هنا (خارج الشاشة) ثم تُلتقط كصور لـ PDF */}
      <style>{PAGE_CSS}</style>
      <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden="true">
        <div ref={stage} className="sc-pages" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      </div>
    </Modal>
  );
}
