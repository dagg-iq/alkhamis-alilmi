// تصوير أسئلة الامتحان ← نص واضح (Markdown + LaTeX) + ملف PDF من الصور ← مسودة للمراجعة
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { generate, GeminiQuotaError, toBase64 } from '../_shared/gemini.ts';
import { getObject, putObject } from '../_shared/storage.ts';

const PROMPT = `هذه صور لورقة أسئلة امتحان لطلاب الخامس الإعدادي العلمي في العراق.
انسخ الأسئلة كاملة بدقة تامة إلى Markdown:
- حافظ على ترقيم الأسئلة والفروع (س١، أ، ب…) والدرجات إن وُجدت.
- اكتب كل معادلة أو رمز رياضي/كيميائي بصيغة LaTeX بين $...$.
- تجاهل خط يد الطالب والإجابات والشطب، وانسخ الأسئلة المطبوعة/المكتوبة من الأستاذ فقط.
- إذا كانت كلمة غير واضحة اكتب [غير واضح].
- إذا كان في السؤال رسم أو شكل اكتب: [شكل: وصف مختصر].
- لا تضف أي تعليق أو مقدمة أو حلول. أعد Markdown فقط.`;

Deno.serve(handler(async (req) => {
  const caller = await getCaller(req, { staff: true });
  const { scanKeys, subjectId, period, kind, title, sectionId, source } = await req.json();
  if (!Array.isArray(scanKeys) || !scanKeys.length) throw new HttpError(400, 'صوّر ورقة الأسئلة أولاً.');
  if (scanKeys.length > 10) throw new HttpError(400, 'الحد الأقصى ١٠ صور في المرة الواحدة.');
  if (scanKeys.some((k: string) => !k.startsWith('scans/'))) throw new HttpError(400, 'مفتاح غير صالح.');

  const images = await Promise.all(scanKeys.map((k: string) => getObject(k)));

  // ١. PDF من الصور (صفحة لكل صورة)
  const pdf = await PDFDocument.create();
  for (let i = 0; i < images.length; i++) {
    const bytes = images[i];
    const isPng = scanKeys[i].endsWith('.png');
    const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const pdfKey = `generated/${crypto.randomUUID()}.pdf`;
  await putObject(pdfKey, await pdf.save(), 'application/pdf');

  // ٢. النص
  const ai = await getSetting<{ model?: string }>('ai');
  let content = '';
  try {
    content = await generate(ai.model ?? 'gemini-2.5-flash', [{
      role: 'user',
      parts: [
        ...images.map((b, i) => ({
          inline_data: { mime_type: scanKeys[i].endsWith('.png') ? 'image/png' : 'image/jpeg', data: toBase64(b) },
        })),
        { text: PROMPT },
      ],
    }], { temperature: 0.1, maxOutputTokens: 8192 });
  } catch (e) {
    if (!(e instanceof GeminiQuotaError)) console.error(e);
    content = '> تعذّر استخراج النص تلقائياً الآن. ملف PDF جاهز، ويمكنك إعادة المحاولة لاحقاً أو كتابة الأسئلة يدوياً.';
  }
  content = content.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();

  const { data, error } = await admin.from('question_sets').insert({
    subject_id: subjectId,
    kind: kind ?? 'school_exam',
    period,
    section_id: sectionId ?? null,
    title: title || 'أسئلة امتحان',
    source: source ?? null,
    content_md: content,
    pdf_key: pdfKey,
    scan_keys: scanKeys,
    status: 'draft',
    created_by: caller.id,
  }).select('id').single();
  if (error) throw error;

  return json({ id: data.id, content, pdfKey });
}));
