import {
  PERIOD_LABELS, PERIODS, QUESTION_KIND_LABELS, type Period, type QuestionKind, type Section, type Subject,
} from '@saey/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { convertImages, imagesToPdf, pagesToPdf, PAGE_CSS } from '../lib/scan-convert';
import { supabase, uploadFile } from '../lib/supabase';
import { Field, Markdown, Modal, Tabs, check, useAction } from './ui';

type Mode = 'images' | 'pdf' | 'text';
const AI_KEY = 'saey.questions.ai';
const readAi = () => { try { return localStorage.getItem(AI_KEY) !== '0'; } catch { return true; } };

/**
 * إضافة أسئلة بثلاث طرق في نافذة واحدة: صور (مع تحويل ذكي اختياري إلى PDF أو بدونه) أو ملف PDF جاهز أو نص.
 * الصور بلا ذكاء اصطناعي تُنشر كما هي (كل صورة صفحة) فلا تُستهلك حصة Gemini.
 */
export function QuestionComposer({ subjects, sections, onClose, onSaved }: { subjects: Subject[]; sections: Section[]; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useAction();
  const [mode, setMode] = useState<Mode>('images');
  const [ai, setAi] = useState(readAi);
  const [files, setFiles] = useState<File[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; previews: string[] } | null>(null);
  const [meta, setMeta] = useState({ title: '', source: '', subject_id: subjects[0]?.id ?? '', kind: 'expected' as QuestionKind, period: 'month1' as Period, section_id: '' });
  const stage = useRef<HTMLDivElement>(null);
  const thumbs = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  const setAiPref = (v: boolean) => { setAi(v); setResult(null); setHtml(null); try { localStorage.setItem(AI_KEY, v ? '1' : '0'); } catch { /* تجاهل */ } };
  const reset = () => { setResult(null); setHtml(null); };
  const move = (i: number, d: number) => { reset(); setFiles((fs) => {
    const j = i + d;
    if (j < 0 || j >= fs.length) return fs;
    const n = [...fs];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  }); };

  const convert = () => run(async () => {
    if (!files.length) throw new Error('اختر الصور أولاً');
    setResult(null);
    try {
      if (!ai) {
        setResult(await imagesToPdf(files, setStep));
        return;
      }
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

  const ready = mode === 'images' ? !!result : mode === 'pdf' ? !!pdfFile : !!text.trim();

  const save = (status: 'draft' | 'published') => run(async () => {
    if (!meta.title.trim()) throw new Error('اكتب عنوان الأسئلة');
    if (!meta.subject_id) throw new Error('اختر المادة');
    if (!ready) throw new Error(mode === 'images' ? 'اضغط «جهّز الملف» أولاً' : mode === 'pdf' ? 'اختر ملف PDF' : 'اكتب نص الأسئلة');
    let pdfKey: string | null = null;
    if (mode !== 'text') {
      const blob = mode === 'images' ? result!.blob : pdfFile!;
      const file = new File([blob], `${meta.title.trim().slice(0, 50) || 'أسئلة'}.pdf`, { type: 'application/pdf' });
      setStep('رفع الملف…');
      try { pdfKey = await uploadFile(file, 'material', (p) => setStep(`رفع الملف… ${Math.round(p * 100)}٪`)); } finally { setStep(null); }
    }
    await check(supabase.from('question_sets').insert({
      subject_id: meta.subject_id, kind: meta.kind, period: meta.period, section_id: meta.kind === 'school_exam' ? meta.section_id || null : null,
      title: meta.title.trim(), source: meta.source.trim() || null,
      content_md: mode === 'text' ? text : null, pdf_key: pdfKey, scan_keys: [], status,
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
    <Modal title="إضافة أسئلة" onClose={onClose}>
      <Tabs<Mode> value={mode} onChange={setMode} options={[
        { key: 'images', label: 'من صور' }, { key: 'pdf', label: 'ملف PDF' }, { key: 'text', label: 'كتابة نص' },
      ]} />

      {mode === 'images' ? (
        <>
          <p className="small dim" style={{ margin: 0 }}>ارفع صور ورقة الأسئلة بالترتيب (حتى ١٠). تُنشر كما هي، أو يعيد الذكاء الاصطناعي بناء الورقة بنفس تنسيقها كملف PDF منظّم.</p>
          <label className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ai} onChange={(e) => setAiPref(e.target.checked)} style={{ marginTop: 4 }} />
            <span><b>تحويل بالذكاء الاصطناعي (اختياري)</b><br /><span className="small dim">{ai ? 'يعيد كتابة الورقة بخط واضح ومعادلات منسّقة (يستهلك حصة Gemini وقد يستغرق دقيقة).' : 'بدونه: كل صورة تصبح صفحة كما هي، سريع ولا يستهلك شيئاً.'}</span></span>
          </label>
          <div className="row">
            <label className="btn primary" style={{ cursor: 'pointer' }}>
              + اختر الصور
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; setFiles((fs) => [...fs, ...picked].slice(0, 10)); reset(); }} />
            </label>
            {files.length ? <button className="btn sm" onClick={() => { setFiles([]); reset(); }}>مسح الكل</button> : null}
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
                    <button onClick={() => { setFiles(files.filter((_, j) => j !== i)); reset(); }} aria-label="حذف">×</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {mode === 'pdf' ? (
        <>
          <p className="small dim" style={{ margin: 0 }}>ارفع ملف PDF جاهزاً ليُنشر للطلاب كما هو، بلا أي تحويل.</p>
          <div className="row">
            <label className="btn primary" style={{ cursor: 'pointer' }}>
              + اختر ملف PDF
              <input type="file" accept="application/pdf" hidden onChange={(e) => { setPdfFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            {pdfFile ? <span className="small"><b>{pdfFile.name}</b> · {(pdfFile.size / 1048576).toFixed(1)} م.ب</span> : null}
          </div>
        </>
      ) : null}

      {mode === 'text' ? (
        <>
          <div className="tabs">
            <button className={!showText ? 'on' : ''} onClick={() => setShowText(false)}>تحرير</button>
            <button className={showText ? 'on' : ''} onClick={() => setShowText(true)}>معاينة</button>
          </div>
          {showText
            ? <div className="card" style={{ minHeight: 200 }}><Markdown text={text} /></div>
            : <Field label="النص (Markdown — المعادلات بين $...$)"><textarea className="input" style={{ minHeight: 260 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
        </>
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
        <Field label="المصدر (اختياري)"><input className="input" value={meta.source} placeholder="مثلاً: ملزمة الأستاذ…" onChange={(e) => setMeta({ ...meta, source: e.target.value })} /></Field>
      </div>

      {mode === 'images' ? (
        <div className="row">
          <button className="btn primary" onClick={convert} disabled={busy || !files.length}>
            {step ? 'جارٍ التجهيز…' : result ? (ai ? 'إعادة التحويل' : 'إعادة التجهيز') : (ai ? 'حوّل إلى PDF' : 'جهّز الملف')}
          </button>
          {result ? <button className="btn" onClick={download}>تنزيل PDF</button> : null}
        </div>
      ) : null}
      {step ? <div className="card soft"><b>{step}</b></div> : null}
      {mode === 'images' && result ? <div className="sc-prev">{result.previews.map((p, i) => <img key={i} src={p} alt={`الصفحة ${i + 1}`} />)}</div> : null}

      <div className="row">
        <button className="btn primary" onClick={() => save('published')} disabled={busy || !ready}>حفظ ونشر للطلاب</button>
        <button className="btn" onClick={() => save('draft')} disabled={busy || !ready}>حفظ كمسودة</button>
      </div>

      {/* صفحات التحويل الذكي تُرسم هنا (خارج الشاشة) ثم تُلتقط كصور لـ PDF */}
      <style>{PAGE_CSS}</style>
      <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden="true">
        <div ref={stage} className="sc-pages" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      </div>
    </Modal>
  );
}
