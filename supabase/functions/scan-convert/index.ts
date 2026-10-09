// تحويل صور ورقة (أسئلة امتحان مثلاً) إلى صفحات HTML بنفس تنسيق الأصل (مواضع النصوص، الجداول، الصناديق، الترقيم)،
// ثم يحوّلها التطبيق إلى PDF/صور. متاح لكل طالب مقبول، ويُحسب من رصيد المساعد اليومي (الأدمن بلا حد).
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { generate, GeminiQuotaError, MAIN_MODELS, modelChain } from '../_shared/gemini.ts';

const PROMPT = `هذه صور (بالترتيب) لصفحات ورقة مطبوعة أو مكتوبة (غالباً أسئلة امتحان لطلاب الخامس العلمي في العراق).
أعد بناء كل صفحة كملف HTML نظيف يبدو **مطابقاً للأصل**: نفس ترتيب العناصر، ونفس اتجاه النص (عربي من اليمين، إنكليزي من اليسار)، ونفس المحاذاة (وسط/يمين/يسار)، ونفس الترقيم والعناوين والأقواس، ونفس الخط العريض والمسطّر والمائل، ونفس الجداول والصناديق والإطارات والخطوط الفاصلة والنقاط الفارغة للإجابة، ونفس تقسيم الأعمدة، ونفس الأسطر وأماكن فواصلها.

القواعد:
- أخرج HTML فقط بلا أي شرح وبلا \`\`\`. لكل صورة عنصر واحد: <section class="page"> … </section> بنفس ترتيب الصور.
- انسخ النص كما هو بدقة تامة حرفاً حرفاً بلا تلخيص أو تصحيح أو إعادة صياغة (حتى أخطاء الأصل). إن لم تتبيّن كلمة اكتب [؟].
- استخدم: div, p, span, b, i, u, br, hr, sub, sup, table/tr/td/th, ul/ol/li، مع style مضمّن (text-align, border, padding, margin, font-size, font-weight, width, display:flex, justify-content, gap, direction).
- اكتب الترقيم المطبوع كنص حرفي (مثل «س١» و«أ-» و«1.») ولا تعتمد على ترقيم HTML التلقائي.
- كل معادلة أو رمز رياضي/فيزيائي/كيميائي بصيغة LaTeX بين $...$ (والمعادلة المستقلة بين $$...$$). المعادلات الكيميائية: $\\ce{2H2 + O2 -> 2H2O}$.
- الأسطر الفارغة للإجابة: <div class="line"></div>، والنقاط المتصلة: <span class="dots"></span>.
- الأشكال والرسوم والصور: ضع مكانها <img data-page="رقم الصورة بدءاً من 1" data-box="ymin,xmin,ymax,xmax" style="width:..%"> حيث الإحداثيات من 0 إلى 1000 (نسبة من ارتفاع/عرض الصورة) تحيط بالشكل بدقة، وسيقصّه التطبيق من الصورة الأصلية. لا تحاول رسم الأشكال بنفسك.
- تجاهل خط يد الطالب والشطب والظلال وحواف الصورة والخلفية، وأعد المطبوع/المكتوب من الأستاذ فقط.
- لا تضف شيئاً غير موجود في الأصل. لا scripts ولا روابط ولا موارد خارجية.
- الصفحة عرضها يمتلئ 100% وارتفاعها يتبع المحتوى؛ لا تضع أرقام صفحات من عندك.`;

const clean = (html: string) => html
  .replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '')
  .replace(/<\s*(script|iframe|object|embed|link|meta|style|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
  .replace(/<\s*(script|iframe|object|embed|link|meta|style|base|form)\b[^>]*>/gi, '')
  .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/(href|src)\s*=\s*("\s*(?:https?:|javascript:|data:)[^"]*"|'\s*(?:https?:|javascript:|data:)[^']*')/gi, '')
  .trim();

Deno.serve(handler(async (req) => {
  const caller = await getCaller(req);
  const { images } = await req.json();
  const isStaff = caller.role !== 'student';
  const max = isStaff ? 10 : 8;
  if (!Array.isArray(images) || !images.length) throw new HttpError(400, 'صوّر الورقة أولاً.');
  if (images.length > max) throw new HttpError(400, `الحد الأقصى ${max} صور في المرة الواحدة.`);
  for (const b of images) {
    if (typeof b !== 'string' || b.length < 1000) throw new HttpError(400, 'صورة غير صالحة.');
    if (b.length > 4_500_000) throw new HttpError(413, 'إحدى الصور كبيرة جداً، صوّرها من جديد.');
  }

  const settings = await getSetting<{ model?: string; daily_limit?: number; enabled?: boolean }>('ai');
  if (settings.enabled === false) throw new HttpError(503, 'الذكاء الاصطناعي متوقف مؤقتاً من قبل الأدمن.');
  if (!isStaff) {
    const limit = settings.daily_limit ?? 20;
    const { data: n } = await admin.rpc('consume_ai_quota', { p_user: caller.id, p_limit: limit });
    if (n === -1) throw new HttpError(429, 'انتهى رصيدك اليوم من الذكاء الاصطناعي. يتجدد غداً إن شاء الله.');
  }

  let raw: string;
  try {
    raw = await generate(modelChain(settings.model, MAIN_MODELS), [{
      role: 'user',
      parts: [
        ...images.flatMap((b: string, i: number) => [
          { text: `الصورة ${i + 1}:` },
          { inline_data: { mime_type: 'image/jpeg', data: b } },
        ]),
        { text: PROMPT },
      ],
    }], { temperature: 0.1, maxOutputTokens: 32768, thinking: 'low', pool: isStaff ? 'admin' : 'student', extraConfig: { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
  } catch (e) {
    if (e instanceof GeminiQuotaError) throw new HttpError(503, 'الذكاء الاصطناعي مشغول الآن، جرّب بعد دقيقة.');
    throw e;
  }
  const html = clean(raw);
  if (!/<section/i.test(html) || html.length < 40) throw new HttpError(502, 'لم أستطع قراءة الورقة. صوّرها بإضاءة أوضح وحاول مرة أخرى.');
  return json({ html });
}));
