// اختبار ذاتي لفصل: يُولَّد مرة واحدة ويُحفظ ويُعاد لكل الطلاب
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { embed, generate, GeminiQuotaError, parseJson } from '../_shared/gemini.ts';

interface Q { question: string; choices: string[]; answer: number; explanation?: string }

Deno.serve(handler(async (req) => {
  const caller = await getCaller(req);
  const { chapterId, regenerate } = await req.json();

  if (!regenerate) {
    const { data: existing } = await admin.from('quiz_questions').select('*').eq('chapter_id', chapterId);
    if (existing && existing.length >= 5) return json({ questions: existing });
  } else if (caller.role === 'student') {
    throw new HttpError(403, 'إعادة التوليد للأدمن والمشرفين فقط.');
  }

  const { data: chapter } = await admin
    .from('chapters').select('id, title, number, books!inner(subject_id, subjects!inner(name))').eq('id', chapterId).single();
  if (!chapter) throw new HttpError(404, 'الفصل غير موجود.');
  // deno-lint-ignore no-explicit-any
  const book = chapter.books as any;
  const subjectId: string = book.subject_id;
  const subjectName: string = book.subjects.name;

  // مقتطفات الفصل: المرتبطة به مباشرة، وإلا الأقرب دلالياً لعنوانه
  let { data: chunks } = await admin.from('content_chunks').select('content').eq('chapter_id', chapterId).limit(12);
  if (!chunks?.length) {
    try {
      const [qv] = await embed([`${subjectName} — ${chapter.title}`], 'RETRIEVAL_QUERY');
      const { data } = await admin.rpc('match_chunks', { query_embedding: qv, match_count: 10, p_subject: subjectId });
      chunks = data ?? [];
    } catch {
      chunks = [];
    }
  }
  const context = (chunks ?? []).map((c: { content: string }) => c.content).join('\n---\n');

  const ai = await getSetting<{ model?: string }>('ai');
  let questions: Q[];
  try {
    const raw = await generate(ai.model ?? 'gemini-2.5-flash', [{
      role: 'user',
      parts: [{
        text: `أنشئ ١٠ أسئلة اختيار من متعدد لمادة ${subjectName}، الفصل ${chapter.number}: «${chapter.title}» — منهج الخامس الإعدادي العلمي في العراق.
${context ? `اعتمد على هذا المحتوى من الملازم:\n${context}\n` : ''}
- لكل سؤال ٤ خيارات، خيار واحد صحيح فقط، ونوّع موقع الإجابة الصحيحة.
- مستوى متدرج: ٤ سهلة، ٤ متوسطة، ٢ صعبة بنمط الأسئلة الوزارية.
- المعادلات بـ LaTeX بين $...$.
- شرح مختصر (سطر أو سطران) لسبب صحة الإجابة.
أعد JSON فقط: [{"question": "...", "choices": ["...","...","...","..."], "answer": رقم_الخيار_الصحيح_من_0, "explanation": "..."}]`,
      }],
    }], { json: true, temperature: 0.5, maxOutputTokens: 8192 });
    questions = parseJson<Q[]>(raw).filter((q) =>
      q.question && Array.isArray(q.choices) && q.choices.length === 4 && q.answer >= 0 && q.answer < 4);
  } catch (e) {
    if (e instanceof GeminiQuotaError) throw new HttpError(503, 'المساعد مشغول الآن، جرّب بعد قليل.');
    throw e;
  }
  if (!questions.length) throw new HttpError(500, 'تعذّر إنشاء الاختبار، حاول مرة أخرى.');

  if (regenerate) await admin.from('quiz_questions').delete().eq('chapter_id', chapterId);
  const { data: saved, error } = await admin.from('quiz_questions').insert(questions.map((q) => ({
    chapter_id: chapterId, question: q.question, choices: q.choices, answer: q.answer, explanation: q.explanation ?? null,
  }))).select('*');
  if (error) throw error;
  return json({ questions: saved });
}));
