// المساعد الذكي: يجيب من المنهج (RAG) ويذكر المصدر، مع حد يومي لكل طالب
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { type Content, embed, generate, GeminiQuotaError, modelChain } from '../_shared/gemini.ts';

interface AiSettings { daily_limit?: number; model?: string; enabled?: boolean }

const SYSTEM = `أنت «مساعد سعي»، مدرّس خصوصي ذكي لطلاب الصف الخامس الإعدادي العلمي في العراق.
- أجب بالعربية الفصحى المبسطة، بأسلوب ودود وواضح كأنك أستاذ يشرح لطالب.
- اعتمد أولاً على «مقتطفات المنهج» المرفقة. إذا استخدمت مقتطفاً اذكر رقمه هكذا [١] أو [٢].
- إذا لم تكن الإجابة في المقتطفات، أجب من معرفتك العامة بالمنهج العراقي وقل صراحة: «هذا من خارج الملازم المرفوعة».
- لا تخترع أرقام صفحات أو أسماء أساتذة أو قوانين غير موجودة. إذا لم تكن متأكداً فقل ذلك.
- كن مختصراً: لا تتجاوز ما يحتاجه الطالب.

طريقة الكتابة (مثل ملزمة مرتبة، لأن التطبيق يعرضها بتنسيق جميل):
- ابدأ بجملة تجيب مباشرة، ثم التفاصيل.
- عناوين الأقسام بـ ## (قصيرة). لا تستخدم # وحدها.
- المصطلحات المهمة بـ **عريض**، وأهم فكرة في الجواب ظلّلها هكذا ==الفكرة== (مرة أو مرتين فقط).
- القانون أو التعريف المهم في صندوق: سطر يبدأ بـ > مثل:
  > **القانون:** $C = \\frac{Q}{\\Delta V}$
- المعادلات بصيغة LaTeX: داخل السطر $...$ والمهمة في سطر مستقل $$...$$. لا تكتب المعادلات كنص عادي.
- المسائل: خطوات مرقمة 1. 2. 3. (المعطيات، المطلوب، القانون، التعويض، الناتج مع الوحدة)، والناتج النهائي بالعريض.
- المقارنات في جدول Markdown.
- عند طلب أسئلة أو امتحان: عنوان ## الأسئلة ثم الأسئلة مرقمة (مع الدرجة إن أمكن)، ثم في النهاية ## الإجابات النموذجية مرقمة بنفس الترتيب. نوّع بين: علّل، ما المقصود، قارن، مسائل، اختر.
- لا تستخدم الرموز التعبيرية (الإيموجي).
- ارفض بلطف أي طلب لا علاقة له بالدراسة أو غير لائق، ووجّه الطالب للدراسة.`;

/** ما يعرفه المساعد عن الطالب (اسمه، شعبته، درجاته، دراسته) ليعطي نصائح شخصية */
async function studentSection(userId: string, brief: string): Promise<string> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: p }, { data: study }] = await Promise.all([
    admin.from('profiles').select('full_name, sections(name)').eq('id', userId).maybeSingle(),
    admin.from('study_sessions').select('minutes').eq('user_id', userId).gte('started_at', since),
  ]);
  const name = (p?.full_name as string | undefined)?.split(' ')[0];
  const section = (p?.sections as { name?: string } | null)?.name;
  const minutes = (study ?? []).reduce((a, r) => a + (r.minutes as number), 0);
  const lines = [
    name ? `اسم الطالب: ${name}${section ? ` (شعبة ${section})` : ''}` : null,
    `دراسته بمؤقت سعي في آخر ٧ أيام: ${minutes} دقيقة`,
    brief ? `درجاته وهدفه:\n${brief}` : 'لم يُدخل درجاته بعد.',
  ].filter(Boolean);
  return `\n\nمعلومات عن الطالب الذي تحادثه (استخدمها فقط إذا سأل عن درجاته أو وضعه أو طلب نصيحة أو خطة دراسة. في أسئلة المنهج العادية لا تذكر هدفه ولا درجاته إطلاقاً، وادخل في الجواب مباشرة بلا مقدمات أو مديح):\n${lines.join('\n')}`;
}

const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const ar = (n: number) => String(n).replace(/\d/g, (d) => AR[+d]);

Deno.serve(handler(async (req) => {
  const caller = await getCaller(req);
  const { chatId, message, subjectId, brief } = await req.json();
  const text = String(message ?? '').trim();
  if (!text) throw new HttpError(400, 'اكتب سؤالك أولاً.');
  if (text.length > 4000) throw new HttpError(400, 'السؤال طويل جداً، اختصره قليلاً.');

  const settings = await getSetting<AiSettings>('ai');
  if (settings.enabled === false) throw new HttpError(503, 'المساعد الذكي متوقف مؤقتاً من قبل الأدمن.');
  const limit = settings.daily_limit ?? 20;
  const model = modelChain(settings.model);

  // الأدمن بلا حد يومي
  let used = 0;
  if (caller.role !== 'admin') {
    const { data: n } = await admin.rpc('consume_ai_quota', { p_user: caller.id, p_limit: limit });
    if (n === -1) throw new HttpError(429, `انتهى رصيدك اليوم (${ar(limit)} سؤالاً). يتجدد غداً إن شاء الله.`);
    used = n as number;
  }

  // المحادثة
  let chat = chatId as string | undefined;
  if (chat) {
    const { data } = await admin.from('ai_chats').select('id, user_id').eq('id', chat).single();
    if (!data || data.user_id !== caller.id) throw new HttpError(404, 'المحادثة غير موجودة.');
  } else {
    const title = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    const { data, error } = await admin
      .from('ai_chats').insert({ user_id: caller.id, title, subject_id: subjectId ?? null }).select('id').single();
    if (error) throw error;
    chat = data.id;
  }

  const { data: history } = await admin
    .from('ai_messages').select('role, content').eq('chat_id', chat)
    .order('created_at', { ascending: false }).limit(10);

  // البحث في المنهج
  let context = '';
  let sources: { title: string; page?: number; subject?: string }[] = [];
  try {
    const [qv] = await embed([text], 'RETRIEVAL_QUERY');
    const { data: chunks } = await admin.rpc('match_chunks', {
      query_embedding: qv, match_count: 6, p_subject: subjectId ?? null,
    });
    const relevant = (chunks ?? []).filter((c: { similarity: number }) => c.similarity > 0.55);
    if (relevant.length) {
      const docIds = [...new Set(relevant.filter((c: { source_type: string }) => c.source_type === 'document').map((c: { source_id: string }) => c.source_id))];
      const qsIds = [...new Set(relevant.filter((c: { source_type: string }) => c.source_type === 'question_set').map((c: { source_id: string }) => c.source_id))];
      const [{ data: docs }, { data: qsets }, { data: subjects }] = await Promise.all([
        admin.from('documents').select('id, title').in('id', docIds.length ? docIds : ['00000000-0000-0000-0000-000000000000']),
        admin.from('question_sets').select('id, title').in('id', qsIds.length ? qsIds : ['00000000-0000-0000-0000-000000000000']),
        admin.from('subjects').select('id, name'),
      ]);
      const titleOf = new Map<string, string>([...(docs ?? []), ...(qsets ?? [])].map((d) => [d.id, d.title]));
      const subjectOf = new Map<string, string>((subjects ?? []).map((s) => [s.id, s.name]));
      sources = relevant.map((c: { source_id: string; page: number | null; subject_id: string }) => ({
        title: titleOf.get(c.source_id) ?? 'المنهج',
        page: c.page ?? undefined,
        subject: subjectOf.get(c.subject_id),
      }));
      context = relevant
        .map((c: { content: string }, i: number) => {
          const s = sources[i];
          return `[${ar(i + 1)}] (${s.subject ?? ''} — ${s.title}${s.page ? ` — صفحة ${ar(s.page)}` : ''})\n${c.content}`;
        })
        .join('\n\n');
    }
  } catch (e) {
    // البحث اختياري: إذا فشل نكمل بدون مقتطفات
    if (e instanceof GeminiQuotaError) throw new HttpError(503, 'المساعد مشغول الآن، جرّب بعد دقيقة.');
    console.error('retrieval failed', e);
  }

  const contents: Content[] = (history ?? []).reverse().map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: context ? `مقتطفات المنهج:\n${context}\n\n---\nسؤال الطالب:\n${text}` : text }],
  });

  const about = await studentSection(caller.id, String(brief ?? '').slice(0, 3000)).catch(() => '');

  let answer: string;
  try {
    answer = await generate(model, contents, { system: SYSTEM + about, temperature: 0.3, maxOutputTokens: 8192 });
  } catch (e) {
    if (e instanceof GeminiQuotaError) throw new HttpError(503, 'المساعد مشغول الآن بسبب كثرة الأسئلة، جرّب بعد دقيقة.');
    throw e;
  }
  if (!answer) answer = 'لم أستطع الإجابة على هذا السؤال. حاول صياغته بطريقة أخرى.';

  // نحتفظ فقط بالمصادر التي ذُكرت فعلاً في الجواب
  const cited = sources.filter((_, i) => answer.includes(`[${ar(i + 1)}]`) || answer.includes(`[${i + 1}]`));

  await admin.from('ai_messages').insert([
    { chat_id: chat, role: 'user', content: text },
    { chat_id: chat, role: 'assistant', content: answer, sources: cited.length ? cited : null },
  ]);
  await admin.from('ai_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat);

  return json({
    chatId: chat,
    answer,
    sources: cited,
    remaining: caller.role === 'admin' ? null : Math.max(0, limit - used),
  });
}));
