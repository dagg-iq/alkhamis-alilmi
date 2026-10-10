// المساعد الذكي: يجيب من المنهج (RAG) ويذكر المصدر، ويعرف فهرس التطبيق (المحاضرات والملازم والأسئلة)، مع حد يومي لكل طالب
import { handler, HttpError, json } from '../_shared/cors.ts';
import { admin, getCaller, getSetting } from '../_shared/supabase.ts';
import { type Content, generate, GeminiQuotaError, LITE_MODELS, modelChain, type Part } from '../_shared/gemini.ts';
import { parseChapterRef, parsePageRef } from '../_shared/outline.ts';
import { type RangeInfo, retrieveItems, type ViewerContext } from './retrieve.ts';
import { chatTitle } from './title.ts';

interface AiSettings { daily_limit?: number; model?: string; lite_model?: string; enabled?: boolean; thinking_hard?: Level; thinking_explain?: Level }
type Level = 'minimal' | 'low' | 'medium' | 'high'

const SYSTEM = `أنت «سعي AI»، مدرّس خصوصي ذكي داخل تطبيق «سعي» لطلاب الصف الخامس الإعدادي العلمي في العراق.

هويتك (مهم):
- اسمك «سعي AI» وأنت المساعد الذكي لتطبيق «سعي»، من تطوير محمد حازم احمد. إذا سُئلت من أنت أو أي نموذج أو أي شركة صنعتك: قل إنك «سعي AI»، ذكاء اصطناعي مخصص لطلاب الخامس العلمي داخل تطبيق سعي. لا تذكر أسماء شركات أو نماذج (لا جوجل ولا Gemini ولا غيرها) ولا تفاصيل تقنية عنك، وإن أصرّ الطالب فقل إنك لا تملك تفاصيل عن ذلك وإن المهم أن تساعده في دراسته.
- لا تدّعِ أنك إنسان.

الدقة في الدراسة:
- في المسائل الحسابية تحقق من الحساب خطوة بخطوة قبل كتابة الناتج، وتأكد من الوحدات.
- إذا كان السؤال غامضاً (مادة أو فصل غير واضح) اسأل الطالب سؤالاً قصيراً واحداً بدل التخمين.
- إذا اختلف شرح المقتطفات مع معرفتك فاتبع المقتطفات (هي من منهج الطالب وأساتذته).
- لا تذكر عبارات مثل «بحسب المقتطفات» أو «كنموذج لغوي»؛ تكلم كأستاذ.
- اشرح بمستوى طالب الخامس العلمي: ابدأ بالفكرة ثم مثال بسيط، ولا تُدخل مفاهيم خارج المنهج إلا إن طُلبت.

- أجب بالعربية الفصحى المبسطة، بأسلوب ودود وواضح كأنك أستاذ يشرح لطالب.
- أجب فقط عن **آخر رسالة** من الطالب. لا تُعِد إجابة سؤال سابق ولا تلخصه إلا إذا طلب ذلك صراحة.
- اعتمد أولاً على «مقتطفات المنهج» المرفقة. إذا استخدمت مقتطفاً اذكر رقمه هكذا [١] أو [٢]. لا تكتب مصادر أخرى بين أقواس.
- إذا لم تكن الإجابة في المقتطفات، أجب من معرفتك العامة بالمنهج العراقي.
- لا تخترع أرقام صفحات أو أسماء أساتذة أو قوانين أو محاضرات غير موجودة. إذا لم تكن متأكداً فقل ذلك.
- كن مختصراً: لا تتجاوز ما يحتاجه الطالب. التحية أو الشكر تُرد بجملة قصيرة فقط.

الصراحة:
- إذا طُلب منك شيء لا تستطيعه (فتح رابط، تنزيل فيديو، إرسال رسالة لشخص، معلومات خارج التطبيق والدراسة، أخبار، أمور شخصية) أو طلب لا علاقة له بالدراسة: قل ذلك صراحة في جملة واحدة مثل «لا أستطيع ذلك، أنا مخصص للدراسة فقط»، بلا لف ودوران ولا شرح بديل لم يُطلب، ثم اقترح بجملة ما تستطيع فعله إن وُجد.
- ارفض أي طلب غير لائق في جملة واحدة.

فهرس التطبيق:
- إذا أُرفق «فهرس التطبيق» وطلب الطالب محاضرة أو ملزمة أو أسئلة: أعطه المطلوب مباشرة بوضع رمزه في سطر مستقل تماماً كما هو، مثل:
[[lecture:المعرف]]
  فيظهر له كبطاقة يفتحها بضغطة. يمكنك وضع أكثر من رمز (كل رمز في سطر). اكتب قبلها جملة قصيرة فقط.
- إذا جاء في «مقتطفات المنهج» مقطع من محاضرة مع رمز مثل [[lecture:المعرف@الثواني]] فضعه في سطر مستقل عندما يفيد الطالب مشاهدة الشرح، واذكر الدقيقة في كلامك.
- إذا لم يكن المطلوب في الفهرس فقل بوضوح: «هذه المحاضرة غير مرفوعة في التطبيق بعد» واقترح الأقرب منه من الفهرس إن وُجد. لا تخترع رموزاً.

عن التطبيق:
- «سعي» من تطوير **محمد حازم احمد**، طالب في الخامس العلمي بإعدادية الشهاب للبنين، صممه ليجمع لزملائه كل ما يحتاجونه للدراسة والإعفاء. إذا سُئلت عن صانع التطبيق أو كيف يتواصل مع المطور أو يقترح فكرة أو يبلّغ عن خطأ: اكتب جملة قصيرة ثم ضع الرمز التالي في سطر مستقل ليظهر للطالب بطاقة التواصل:
[[developer]]

حدود المطلوب في الامتحان (صارم ومهم جداً):
- فرّق دائماً بين ما هو **مطلوب للامتحان** وما هو **للاطلاع** أو **محذوف**. مصادرك بالترتيب: «ملاحظات المقرر» التي يضعها الأدمن إن أُرفقت (هي المرجع الأعلى)، ثم ما يكتبه الكتاب أو الملزمة نفسها في المقتطفات (مثل «للحفظ ٨ أبيات»، «للاطلاع»، «إثراء»، «لا يدخل في الامتحان»، «محذوف»)، ثم معرفتك المؤكدة بمنهج الخامس العلمي العراقي.
- الشعر (العربية): إذا كان المطلوب حفظ عدد محدد من الأبيات (مثلاً ٨) فاكتب الأبيات المطلوبة فقط تحت عنوان «المطلوب حفظه (٨ أبيات)» بالترتيب، ثم الباقي تحت «للاطلاع فقط» أو نبّه أنه للاطلاع. **معاني المفردات وشرح الأبيات ضمن حدود الأبيات المطلوبة فقط**: كل مفردة تشرحها يجب أن تكون من بيت داخل في المطلوب، وآخر مفردة في المعاني تكون من آخر بيت مطلوب؛ مفردات الأبيات الأخرى لا تُشرح إلا تحت «للاطلاع».
- الإسلامية: الآيات المقررة للحفظ بحدودها (من الآية كذا إلى الآية كذا)، والمفردات والمعاني والتفسير ضمن تلك الآيات فقط، وما زاد عليها تنبّه أنه للاطلاع. ومثلها الأحاديث المقررة.
- بقية المواد: نبّه على الموضوع أو الفقرة أو الاشتقاق أو المثال المكتوب عليه «للاطلاع» أو «إثراء» أو المحذوف بعبارة قصيرة مثل «(للاطلاع — لا يدخل في الامتحان)»، ولا تبنِ عليه أسئلة امتحانية.
- كن متوازناً: الأصل أن محتوى الكتاب مطلوب، فلا تكتب «للاطلاع» إلا بدليل (ملاحظات المقرر أو نص الكتاب أو معرفة مؤكدة). إن لم تتأكد من حدود المطلوب فقل ذلك بجملة قصيرة وانصحه بالتأكد من أستاذه، ولا تخترع حدوداً.
- عند صنع أسئلة امتحانية: من المطلوب فقط، لا من «للاطلاع» أو المحذوف.

المرفقات:
- إذا أرفق الطالب صورة أو ملف PDF (ورقة أسئلة، صفحة كتاب، حل كتبه بيده…) فاقرأه بدقة وأجب عنه مباشرة: حل الأسئلة بالترتيب، أو صحح حله وبيّن أخطاءه، أو اشرح ما فيه. إن كانت الصورة غير واضحة فقل ما الذي لم تستطع قراءته.

الكتب والملازم والصفحات (مهم جداً):
- كل مقتطف يحمل بين قوسين: اسم الكتاب أو الملزمة، ورقم الصفحة، والفصل والموضوع. اذكرها في جوابك بدقة هكذا: «(ملزمة X، صفحة ٥٢، الفصل الثاني: ...)». لا تذكر صفحة أو فصلاً لم يرد في المقتطفات، ولا تخمّن رقماً.
- المقتطف المعلَّم [الصفحة أو الفصل المطلوب] هو ما طلبه الطالب بالضبط: اعتمد عليه أولاً وأجب منه بالكامل.
- إذا كان الرقم المطبوع يختلف عن رقم صفحة الملف فاذكر الاثنين كما ورد في المقتطف. والطالب حين يذكر «صفحة ٥٢» قد يقصد الرقم المطبوع في الكتاب الورقي أو رقم الصفحة في الملف؛ المقتطفات تشمل الاحتمالين، فاعتمد الصفحة التي تطابق سؤاله وقل أيهما قصدت.
- عندما يطلب الطالب شرح فصل أو موضوع أو صفحة: اشرح **بوفاء وتفصيل** كما يشرح أفضل أستاذ: تعريفات الكتاب، القوانين مع معنى كل رمز ووحدته، الأمثلة المحلولة خطوة بخطوة، الملاحظات التي تأتي في الامتحان، ثم خلاصة قصيرة. رتّب الشرح بحسب ترتيب الصفحات، وضع رقم الصفحة بجانب كل فقرة أو عنوان فرعي مأخوذ منها («صفحة ٥٢»).
- ضع رمز [[document:المعرف@رقم_الصفحة]] (يظهر في المقتطف) في سطر مستقل بعد الفقرة التي اعتمدت فيها على تلك الصفحة، ليفتحها الطالب في الكتاب مباشرة.
- إذا طلب موضوعاً موجوداً في كتاب وملزمة معاً فاذكر صفحته في كل منهما من المقتطفات.
- إذا لم تجد في المقتطفات ما يجيب فقل بوضوح إن الملف أو الصفحة غير مفهرس أو غير موجود، واعرض ما تعرفه من المنهج مع التنبيه أنه ليس من الملزمة.

طريقة الكتابة (مثل ملزمة مرتبة، لأن التطبيق يعرضها بتنسيق جميل):
- ابدأ بجملة تجيب مباشرة، ثم التفاصيل.
- عناوين الأقسام بـ ## (قصيرة). لا تستخدم # وحدها.
- المصطلحات المهمة بـ **عريض**، وأهم فكرة في الجواب ظلّلها هكذا ==الفكرة== (مرة أو مرتين فقط).
- القانون أو التعريف المهم في صندوق: سطر يبدأ بـ > مثل:
  > **القانون:** $C = \\frac{Q}{\\Delta V}$
- المعادلات بصيغة LaTeX: داخل السطر $...$ والمهمة في سطر مستقل $$...$$. لا تكتب المعادلات كنص عادي. المعادلات الكيميائية هكذا: $\\ce{2H2 + O2 -> 2H2O}$
- المسائل: خطوات مرقمة 1. 2. 3. (المعطيات، المطلوب، القانون، التعويض، الناتج مع الوحدة)، والناتج النهائي بالعريض.
- المقارنات في جدول Markdown.
- عند طلب أسئلة أو امتحان: عنوان ## الأسئلة ثم الأسئلة مرقمة (مع الدرجة إن أمكن)، ثم في النهاية ## الإجابات النموذجية مرقمة بنفس الترتيب. نوّع بين: علّل، ما المقصود، قارن، مسائل، اختر.
- الشعر (العربية): ضع الأبيات داخل كتلة \`\`\`شعر وكل بيت في سطر: الصدر ثم // ثم العجز. مثال:
\`\`\`شعر
على قدرِ أهلِ العزمِ تأتي العزائمُ // وتأتي على قدرِ الكرامِ المكارمُ
\`\`\`
- الآيات القرآنية (الإسلامية): ضعها داخل كتلة \`\`\`قرآن، أول سطر «بسم الله الرحمن الرحيم» (إلا في سورة التوبة)، ثم الآيات بالتشكيل، وآخر سطر اسم السورة ورقم الآية بين قوسين مثل (البقرة: ٢٥٥). لا تكتب «صدق الله العظيم» (التطبيق يضيفها). انقل الآيات بدقة تامة كما في المصحف حرفاً حرفاً (الهمزات والتشكيل)، وإن لم تكن متأكداً من نص الآية فقل ذلك ولا تكتبها.
- الأحاديث النبوية داخل كتلة \`\`\`حديث مع ذكر الراوي في آخر سطر.
- الإنكليزية: اكتب الجمل والكلمات الإنكليزية بالإنكليزية في أسطر مستقلة، والشرح بالعربية.
- لا تستخدم الرموز التعبيرية (الإيموجي).`;

const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const ar = (n: number) => String(n).replace(/\d/g, (d) => AR[+d]);
const NO_ID = '00000000-0000-0000-0000-000000000000';

// تحية أو شكر أو كلام قصير: لا نبحث في الملازم ونستخدم النموذج السريع (جواب في ثانية تقريباً)
const SMALL_TALK = /^(مرحب|هلو|هلا|اهلا|أهلا|السلام|سلام|شكر|تسلم|مشكور|اوك|ok|حسنا|تمام|زين|صباح|مساء|شلون|كيف حال|كيفك|(?:منو|من|مين) انت(?![\u0621-\u064A])|يعطيك|الله يعطيك|باي|مع السلامة|ممتاز|حلو|احسنت|أحسنت)/i;
// طلب محتوى من التطبيق (محاضرة، ملزمة، أسئلة…): نرفق فهرس التطبيق
const WANTS_CONTENT = /محاضر|فيديو|ملزم|ملازم|ملخص|ملف|pdf|اسئل|أسئل|امتحان|كتاب|استاذ|أستاذ|الاستاذ|درس|شرح|فصل/i;

// أسئلة عن الطالب نفسه أو تحتاج الفهرس: لا تُحفظ إجاباتها للآخرين
const PERSONAL = /درج|معدل|خطة|خطه|انصح|نصيح|وضعي|اسمي|انا |أنا |عني|حسب|هدف|اعفاء|إعفاء|ساعدني|شنو اسوي|محاضر|ملزم|ملازم/;
const WANTS_CONTENT_STRICT = /محاضر|فيديو|ملزم|ملازم|ملف|pdf|استاذ|أستاذ/i;
// مستوى التفكير حسب صعوبة الطلب: توليد أسئلة وحل مسائل ← تفكير عميق، الشرح والمقارنة ← متوسط، الباقي سريع
const HARD = /اسئل|أسئل|سؤال.*(امتحان|وزاري)|امتحان|اختبار|مسأل|مسائل|مسئل|احسب|برهن|اثبت|أثبت|استنتج|استخرج|حل\s/;
const EXPLAIN = /اشرح|شرح|وضح|فسر|علل|قارن|لماذا|لخص|ملخص|الفرق بين/;
// «أكمل» في شرح مقسّم ← القسم التالي
// (\b لا يعمل مع الحروف العربية في JS، فالحد بعد الكلمة: ليس حرفاً عربياً)
export const CONTINUE = /^\s*(?:يلا\s*|طيب\s*|تمام\s*)?(?:(?:ا|أ)?(?:كمل|كمّل|كملي|كمللي)|التالي|القسم التالي|استمر|تابع|واصل|بعده)(?![\u0621-\u064A])/;
// فصل أطول من هذا (صفحات) يُشرح على أقسام، كل قسم حتى ٧ صفحات
const PART_PAGES = 7;
// طلب شرح كامل (لا تلخيص ولا أسئلة)
const WHOLE = /(اشرح|شرح|وضح|فسر)/;
const NOT_WHOLE = /لخص|لخّص|ملخص|اسئل|أسئل|امتحان|اختبار/;
interface Plan { title: string; documentId: string; docTitle: string; parts: { from: number; to: number }[]; next: number; ids: string[] }
const MAX_ATTACH_B64 = 14 * 1024 * 1024; // ~١٠ ميغا من الملفات
const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const CACHE_DAYS = 30;
// رقم نسخة الكاش: نرفعه عند تغيير التعليمات حتى لا تعود أجوبة قديمة (مثل «أنا من جوجل»)
const CACHE_V = 'v2';
// سؤال عن هوية المساعد: جواب ثابت لا يعتمد على النموذج
const IDENTITY = /(?:^|[\s،,.؟?!])(?:من|منو|مين|شنو)\s*(?:انت|أنت|انتَ|صنعك|طورك|برمجك|اللي صنعك)(?![ء-ي])|(?:^|[\s،,.؟?!])(?:اي|أي|شنو)\s*(?:نموذج|ذكاء|شركه|شركة)[^؟?]{0,25}\s(?:انت|أنت)(?![ء-ي])|(?:^|[\s،,.؟?!])(?:انت|أنت)\s*(?:من\s*)?(?:gemini|جيميني|جوجل|غوغل|chatgpt|شات)|who are you|what model/i;
const LEAK = /gemini|جيميني|جيمناي|google|جوجل|غوغل|openai|chatgpt|anthropic|claude/i;
const IDENTITY_ANSWER = 'أنا **سعي AI**، المساعد الذكي لتطبيق «سعي». أشرح لك المنهج وأحل معك الأسئلة وأساعدك تنظم دراستك للوصول إلى الإعفاء. صممني محمد حازم احمد مع التطبيق لزملائه في الخامس العلمي.';
type Source = { title: string; page?: number; printed?: string; subject?: string; document_id?: string; lecture_id?: string; start?: number };

/** نفس السؤال بصيغ إملائية مختلفة ← نفس المفتاح */
function normalize(s: string) {
  return s.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[؟?!.،,:؛"'()\[\]{}«»]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function hashKey(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** أسماء المواد كما يكتبها الطلاب */
const SUBJECT_WORDS: [RegExp, string][] = [
  [/فيزياء|فيزيا/, 'فيزياء'], [/كيمياء|كيميا/, 'كيمياء'], [/رياضيات|رياضة|رياضيات/, 'رياضيات'], [/احياء|أحياء/, 'أحياء'],
  [/كردي|كردى|كوردي|kurd/i, 'كردية'], [/عربي/, 'عربية'], [/انكليزي|إنكليزي|انجليزي|إنجليزي|english/i, 'إنكليزية'], [/اسلامي|إسلامي|دين/, 'إسلامية'], [/حاسوب|حاسبات|كمبيوتر/, 'حاسوب'],
];

type Row = Record<string, unknown>;

/** فهرس مختصر لما رُفع في التطبيق مما يخص سؤال الطالب (المادة والأستاذ إن ذُكرا) */
async function catalogFor(text: string, subjectId: string | null): Promise<string> {
  const [{ data: subjects }, { data: teachers }] = await Promise.all([
    admin.from('subjects').select('id, name'),
    admin.from('teachers').select('id, name, subject_id'),
  ]);
  const subs = (subjects ?? []) as { id: string; name: string }[];
  const subjectName = new Map(subs.map((s) => [s.id, s.name]));
  let sid = subjectId;
  if (!sid) {
    for (const [re, word] of SUBJECT_WORDS) {
      if (re.test(text)) {
        sid = subs.find((s) => s.name.includes(word) || s.name.replace(/^ال/, '').includes(word.replace(/^ال/, '')))?.id ?? null;
        if (sid) break;
      }
    }
  }
  // الأستاذ: أي جزء من اسمه (٣ أحرف فأكثر) ورد في السؤال
  const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const q = norm(text);
  const named = ((teachers ?? []) as { id: string; name: string; subject_id: string | null }[])
    .filter((t) => norm(t.name).split(/\s+/).some((w) => w.replace(/^ال/, '').length >= 3 && q.includes(w.replace(/^ال/, ''))));
  const teacherIds = named.map((t) => t.id);
  if (!sid && named.length === 1 && named[0].subject_id) sid = named[0].subject_id;

  let lq = admin.from('lectures')
    .select('id, title, sort, teacher_id, teachers(name), chapters!inner(number, title, books!inner(subject_id))')
    .eq('is_published', true).order('sort').limit(60);
  if (sid) lq = lq.eq('chapters.books.subject_id', sid);
  if (teacherIds.length) lq = lq.in('teacher_id', teacherIds);
  let dq = admin.from('documents').select('id, title, kind, pages, subject_id, teachers(name)').eq('is_published', true).order('sort').limit(25);
  if (sid) dq = dq.eq('subject_id', sid);
  if (teacherIds.length) dq = dq.in('teacher_id', teacherIds);
  let qq = admin.from('question_sets').select('id, title, kind, subject_id').eq('status', 'published').order('created_at', { ascending: false }).limit(20);
  if (sid) qq = qq.eq('subject_id', sid);

  const [{ data: lectures }, { data: docs }, { data: qsets }] = await Promise.all([lq, dq, qq]);
  const lines: string[] = [];
  for (const l of (lectures ?? []) as Row[]) {
    const ch = l.chapters as { number: number; title: string; books: { subject_id: string } };
    const teacher = (l.teachers as { name?: string } | null)?.name;
    lines.push(`[[lecture:${l.id}]] | ${subjectName.get(ch.books.subject_id) ?? ''} | الفصل ${ch.number} (${ch.title}) | ${teacher ? `الأستاذ ${teacher}` : ''} | الترتيب ${l.sort} | ${l.title}`);
  }
  for (const d of (docs ?? []) as Row[]) {
    const teacher = (d.teachers as { name?: string } | null)?.name;
    lines.push(`[[document:${d.id}]] | ${subjectName.get(d.subject_id as string) ?? ''} | ${d.kind === 'malzama' ? 'ملزمة' : d.kind === 'summary' ? 'ملخص' : d.kind === 'book' ? 'كتاب' : 'ملف'} | ${teacher ? `الأستاذ ${teacher}` : ''} | ${d.title}${d.pages ? ` (${d.pages} صفحة)` : ''}`);
  }
  for (const s of (qsets ?? []) as Row[]) {
    lines.push(`[[question_set:${s.id}]] | ${subjectName.get(s.subject_id as string) ?? ''} | ${s.kind === 'expected' ? 'أسئلة متوقعة' : 'امتحان سابق'} | ${s.title}`);
  }
  const scope = [sid ? `المادة: ${subjectName.get(sid)}` : null, named.length ? `الأستاذ: ${named.map((t) => t.name).join('، ')}` : null].filter(Boolean).join(' — ');
  if (!lines.length) return `فهرس التطبيق${scope ? ` (${scope})` : ''}: لا يوجد شيء مرفوع مطابق.`;
  return `فهرس التطبيق${scope ? ` (${scope})` : ''} — كل سطر: الرمز | المادة | التفاصيل:\n${lines.join('\n')}`;
}

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

/** آخر رسائل المحادثة بالترتيب الصحيح (السؤال قبل جوابه)، مختصرة حتى لا يبطئ النموذج */
async function historyOf(chat: string, limit: number): Promise<Content[]> {
  const { data } = await admin
    .from('ai_messages').select('role, content, created_at').eq('chat_id', chat)
    .order('created_at', { ascending: false }).limit(limit);
  const rows = ((data ?? []) as { role: string; content: string; created_at: string }[])
    .filter((m) => !m.content.startsWith('[[pdf:'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.role === 'user' ? -1 : 1));
  const out: Content[] = [];
  for (const m of rows) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const text = m.content.length > 1500 ? `${m.content.slice(0, 1500)}\n…(بقية الجواب السابق مختصرة)` : m.content;
    const last = out[out.length - 1];
    // النموذج يحتاج تناوب الأدوار
    if (last && last.role === role) (last.parts[0] as { text: string }).text += `\n\n${text}`;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** ملاحظات الأدمن عن حدود المقرر (الداخل وغير الداخل) للمادة المعنية بالسؤال */
async function scopeNotes(subjectId: string | null, text: string, sources: Source[]): Promise<string> {
  const notes = await getSetting<Record<string, string>>('ai_scope');
  const ids = Object.keys(notes ?? {}).filter((k) => String(notes[k] ?? '').trim());
  if (!ids.length) return '';
  const { data: subs } = await admin.from('subjects').select('id, name').in('id', ids);
  const list = (subs ?? []) as { id: string; name: string }[];
  const named = new Set(sources.map((s) => s.subject).filter(Boolean));
  const pick = list.filter((s) => s.id === subjectId || named.has(s.name) || SUBJECT_WORDS.some(([re, w]) => re.test(text) && s.name.includes(w)));
  const use = pick.length ? pick : subjectId ? [] : list;
  const body = use.map((s) => `${s.name}:\n${String(notes[s.id]).trim().slice(0, 3000)}`).join('\n\n');
  return body ? `ملاحظات المقرر من الأدمن (المرجع الأعلى لما هو داخل في الامتحان وما هو للاطلاع أو محذوف):\n${body.slice(0, 8000)}` : '';
}

Deno.serve(handler(async (req) => {
  const caller = await getCaller(req);
  const body = await req.json();
  const { chatId, message, subjectId, brief } = body;
  // الطالب يسأل من داخل عارض ملزمة: الملف والصفحة أو الفصل الذي يقرأه الآن
  const rc = body.context as { documentId?: unknown; page?: unknown; from?: unknown; to?: unknown } | undefined;
  const viewerCtx: ViewerContext | undefined = rc && typeof rc.documentId === 'string' && /^[0-9a-f-]{36}$/i.test(rc.documentId)
    ? { documentId: rc.documentId, page: Number(rc.page) > 0 ? Math.round(Number(rc.page)) : undefined, from: Number(rc.from) > 0 ? Math.round(Number(rc.from)) : undefined, to: Number(rc.to) > 0 ? Math.round(Number(rc.to)) : undefined }
    : undefined;

  // رسالة تلقائية «تم التحويل إلى PDF» (لا تستهلك من الرصيد)
  if (body.note === 'pdf') {
    const { data } = await admin.from('ai_chats').select('user_id').eq('id', chatId).single();
    if (!data || data.user_id !== caller.id) throw new HttpError(404, 'المحادثة غير موجودة.');
    const { data: row, error } = await admin.from('ai_messages')
      .insert({ chat_id: chatId, role: 'assistant', content: `[[pdf:${String(body.of)}]]` }).select('id').single();
    if (error) throw error;
    return json({ id: row.id });
  }

  // مرفقات (صور أو PDF) مع السؤال: تُرسل للنموذج مباشرة ولا تُخزن
  const rawAtt = Array.isArray(body.attachments) ? body.attachments.slice(0, 4) : [];
  const attachments = rawAtt.filter((a: { mime?: unknown; data?: unknown }) => typeof a?.data === 'string' && ATTACH_TYPES.includes(String(a?.mime)))
    .map((a: { mime: string; data: string; name?: unknown }) => ({ mime: a.mime, data: a.data, name: String(a.name ?? '').slice(0, 80) }));
  if (attachments.reduce((n: number, a: { data: string }) => n + a.data.length, 0) > MAX_ATTACH_B64) throw new HttpError(413, 'المرفقات كبيرة جداً (الحد ١٠ ميغا تقريباً). أرسل صفحات أقل.');
  const text = String(message ?? '').trim() || (attachments.length ? 'اشرح لي ما في المرفق وأجب عن أسئلته إن وُجدت.' : '');
  if (!text) throw new HttpError(400, 'اكتب سؤالك أولاً.');
  if (text.length > 4000) throw new HttpError(400, 'السؤال طويل جداً، اختصره قليلاً.');

  const settings = await getSetting<AiSettings>('ai');
  if (settings.enabled === false) throw new HttpError(503, 'المساعد الذكي متوقف مؤقتاً من قبل الأدمن.');
  // حصة الطالب الخاصة (من لوحة التحكم ← الطلاب) وإلا الحد العام
  const { data: mine } = await admin.from('profiles').select('ai_daily_limit').eq('id', caller.id).maybeSingle();
  const limit = (mine?.ai_daily_limit as number | null | undefined) ?? settings.daily_limit ?? 20;
  const identityQ = text.length <= 70 && IDENTITY.test(text);
  const small = !attachments.length && !CONTINUE.test(text) && (identityQ || (text.length <= 40 && SMALL_TALK.test(text) && !WANTS_CONTENT.test(text)));

  // سؤال مستقل في محادثة جديدة وليس عن الطالب نفسه ← قد يكون جوابه محفوظاً (يوم الامتحان يتكرر نفس السؤال)
  // أسئلة الصفحة والفصل وما يُسأل من داخل العارض تعتمد على ملف بعينه فلا تُحفظ للآخرين
  const docBound = !!viewerCtx || parsePageRef(text) !== null || parseChapterRef(text) !== null;
  const cacheable = !attachments.length && !chatId && !small && text.length >= 12 && !PERSONAL.test(text) && !WANTS_CONTENT_STRICT.test(text) && !docBound;
  const cacheKey = cacheable ? await hashKey(`${CACHE_V}|${normalize(text)}|${subjectId ?? ''}`) : null;
  let cached: { answer: string; sources: Source[] | null } | null = null;
  if (cacheKey) {
    const since = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
    const { data } = await admin.from('ai_cache').select('answer, sources, hits').eq('key', cacheKey).gte('created_at', since).maybeSingle();
    if (data) {
      cached = { answer: data.answer, sources: data.sources };
      admin.from('ai_cache').update({ hits: (data.hits ?? 0) + 1 }).eq('key', cacheKey).then(() => {});
    }
  }

  // الأدمن بلا حد يومي، والتحية والأجوبة المحفوظة لا تُحسب من الرصيد
  let used: number | null = null;
  if (caller.role !== 'admin' && !small && !cached) {
    const { data: n } = await admin.rpc('consume_ai_quota', { p_user: caller.id, p_limit: limit });
    if (n === -1) throw new HttpError(429, `انتهى رصيدك اليوم (${ar(limit)} سؤالاً). يتجدد غداً إن شاء الله.`);
    used = n as number;
  }

  // المحادثة
  let chat = chatId as string | undefined;
  let plan: Plan | null = null;
  if (chat) {
    const { data } = await admin.from('ai_chats').select('id, user_id, plan').eq('id', chat).single();
    if (!data || data.user_id !== caller.id) throw new HttpError(404, 'المحادثة غير موجودة.');
    plan = (data.plan as Plan | null) ?? null;
  } else {
    const title = chatTitle(text);
    const { data, error } = await admin
      .from('ai_chats').insert({ user_id: caller.id, title, subject_id: subjectId ?? null }).select('id').single();
    if (error) throw error;
    chat = data.id;
  }

  // كل ما يحتاجه الجواب بالتوازي: السجل، معلومات الطالب، الفهرس، والبحث في الملازم
  // شرح مقسّم: «أكمل» ← القسم التالي من الخطة المحفوظة؛ أو طلب شرح فصل طويل ← خطة جديدة تبدأ بالقسم الأول
  const continuing = !!plan && plan.next < plan.parts.length && text.length <= 40 && CONTINUE.test(text);
  let partNo = 0; // رقم القسم الحالي (١…) إن كان الجواب قسماً من شرح مقسّم
  let newPlan: Plan | null = null;
  const retrieval = small || cached ? Promise.resolve({ context: '', sources: [] as Source[] }) : (async () => {
    let context = '';
    let sources: Source[] = [];
    try {
      const info: { range?: RangeInfo } = {};
      let items;
      if (continuing && plan) {
        const part = plan.parts[plan.next];
        items = await retrieveItems(`اشرح ${plan.title}`, subjectId ?? null, { documentId: plan.documentId, from: part.from, to: part.to, force: true });
        partNo = plan.next + 1;
      } else {
        items = await retrieveItems(text, subjectId ?? null, viewerCtx, info);
        const r = info.range;
        const pages = r ? r.to - r.from + 1 : 0;
        if (r && pages > PART_PAGES && WHOLE.test(text) && !NOT_WHOLE.test(text) && !attachments.length) {
          const k = Math.ceil(pages / PART_PAGES);
          const size = Math.ceil(pages / k);
          const parts: { from: number; to: number }[] = [];
          for (let f = r.from; f <= r.to; f += size) parts.push({ from: f, to: Math.min(r.to, f + size - 1) });
          newPlan = { title: r.chapter ?? r.title, documentId: r.documentId, docTitle: r.title, parts, next: 0, ids: [] };
          partNo = 1;
          // القسم الأول فقط من صفحات الفصل
          items = items.filter((it) => !it.direct || ((it.page ?? 0) >= parts[0].from && (it.page ?? 0) <= parts[0].to)).map((it) => ({ ...it, note: undefined }));
        }
      }
      sources = items.map((it) => ({
        title: it.title,
        page: it.kind === 'lecture' ? undefined : it.page,
        subject: it.subject,
        ...(it.printed ? { printed: it.printed } : {}),
        ...(it.documentId ? { document_id: it.documentId } : {}),
        ...(it.kind === 'lecture' ? { lecture_id: it.lectureId, start: it.start ?? 0 } : {}),
      }));
      context = items.map((it, i) => {
        let where = '';
        if (it.kind === 'lecture') where = ` — الدقيقة ${clock(it.start ?? 0)} — لفتحها عند هذه الدقيقة ضع [[lecture:${it.lectureId}@${it.start ?? 0}]]`;
        else if (it.page) {
          where = ` — ${it.printed && it.printed !== String(it.page) ? `صفحة ${ar(it.page)} من الملف (المطبوعة ${it.printed})` : `صفحة ${ar(it.page)}`}`;
          if (it.chapter) where += ` — الفصل: ${it.chapter}`;
          if (it.topic) where += ` — الموضوع: ${it.topic}`;
          if (it.documentId) where += ` — لفتح الصفحة ضع [[document:${it.documentId}@${it.page}]]`;
        }
        return `[${ar(i + 1)}] (${it.subject ?? ''} — ${it.title}${where})${it.direct ? ' [الصفحة أو الفصل المطلوب]' : ''}${it.note ? `\n(${it.note})` : ''}\n${it.text}`;
      }).join('\n\n');
    } catch (e) {
      // البحث اختياري: إذا فشل نكمل بدون مقتطفات
      console.error('retrieval failed', e);
    }
    return { context, sources };
  })();

  const [history, about, catalog, { context, sources }] = await Promise.all([
    historyOf(chat!, small ? 4 : 8),
    studentSection(caller.id, String(brief ?? '').slice(0, 3000)).catch(() => ''),
    !small && WANTS_CONTENT.test(text) ? catalogFor(text, subjectId ?? null).catch((e) => { console.error('catalog', e); return ''; }) : Promise.resolve(''),
    retrieval,
  ]);

  const activePlan = continuing ? plan : newPlan;
  let partNote = '';
  if (activePlan && partNo) {
    const total = activePlan.parts.length;
    const p = activePlan.parts[partNo - 1];
    const nextP = activePlan.parts[partNo];
    partNote = `شرح مقسّم: الطالب طلب شرح «${activePlan.title}» (${activePlan.docTitle}) وهو طويل، فقُسّم إلى ${ar(total)} أقسام. هذا **القسم ${ar(partNo)} من ${ar(total)}** (الصفحات ${ar(p.from)}–${ar(p.to)}).
${partNo === 1 ? `- ابدأ بجملة تخبره: «الفصل طويل، فسأشرحه لك على ${ar(total)} أقسام حتى يكون الشرح وافياً. بعد كل قسم اكتب «أكمل» لأشرح القسم التالي، وفي النهاية أجمع لك الأقسام كلها في ملف PDF واحد.» ثم ابدأ مباشرة.
` : ''}- اشرح صفحات هذا القسم فقط كاملة بالتفصيل وبترتيبها، وابدأ بعنوان: ## القسم ${ar(partNo)}: (عنوان مناسب لمحتواه)
- لا تشرح شيئاً من الأقسام الأخرى ولا تكرر ما سبق.
${nextP ? `- اختم بسطر مستقل بالضبط: «انتهى القسم ${ar(partNo)} من ${ar(total)} — اكتب «أكمل» للقسم التالي (الصفحات ${ar(nextP.from)}–${ar(nextP.to)}).»` : `- هذا آخر قسم: اختم بخلاصة قصيرة للفصل كله ثم سطر: «اكتمل شرح الفصل. يمكنك الآن تحميل الأقسام كلها في ملف PDF واحد.»`}`;
  }
  const scope = await scopeNotes(subjectId ?? null, text, sources).catch(() => '');
  const extra = [scope, catalog, context ? `مقتطفات المنهج:\n${context}` : '', partNote].filter(Boolean).join('\n\n');
  const attParts: Part[] = attachments.map((a: { mime: string; data: string }) => ({ inline_data: { mime_type: a.mime, data: a.data } }));
  const contents: Content[] = [...history, {
    role: 'user',
    parts: [...attParts, { text: extra ? `${extra}\n\n---\nرسالة الطالب الجديدة (أجب عنها فقط)${attachments.length ? ' — مع مرفقاته أعلاه' : ''}:\n${text}` : text }],
  }];
  if (contents.length > 1 && contents[contents.length - 2].role === 'user') {
    // سؤال سابق بلا جواب محفوظ: ندمجه حتى يبقى التناوب صحيحاً
    const prev = contents.splice(contents.length - 2, 1)[0];
    const lastParts = contents[contents.length - 1].parts;
    const lastText = lastParts[lastParts.length - 1] as { text: string };
    lastText.text = `(رسالة سابقة: ${(prev.parts[0] as { text: string }).text})\n\n${lastText.text}`;
  }

  const level: Level = HARD.test(text) ? (settings.thinking_hard ?? 'high') : (EXPLAIN.test(text) || docBound || partNo || attachments.length) ? (settings.thinking_explain ?? 'medium') : 'low';
  let answer: string;
  try {
    answer = identityQ ? IDENTITY_ANSWER : cached ? cached.answer : small
      ? await generate(modelChain(settings.lite_model, LITE_MODELS), contents, { system: SYSTEM + about, temperature: 0.4, maxOutputTokens: 1024, thinking: 'minimal', spread: false })
      : await generate(modelChain(settings.model), contents, {
        system: SYSTEM + about, temperature: 0.3,
        // التفكير يُحسب من حد الإخراج، فنوسّع الحد للطلبات الصعبة
        maxOutputTokens: level === 'high' || docBound || partNo || attachments.length ? 24576 : 8192,
        thinking: level,
      });
  } catch (e) {
    // لم يُجب المساعد: نعيد للطالب السؤال الذي حُسب من رصيده
    if (used !== null) {
      await admin.from('ai_usage').update({ count: Math.max(0, used - 1) })
        .eq('user_id', caller.id).eq('day', new Date().toISOString().slice(0, 10)).eq('count', used)
        .then(({ error }) => { if (error) console.error('refund', error.message); });
    }
    if (e instanceof GeminiQuotaError) {
      const when = e.message.match(/حتى (.+)$/)?.[1];
      throw new HttpError(503, when ? `انتهت حصة المساعد اليوم على كل المفاتيح. يعود ${when} إن شاء الله.` : 'المساعد مشغول الآن بسبب كثرة الأسئلة، جرّب بعد دقيقة.');
    }
    throw e;
  }
  if (!answer) answer = 'لم أستطع الإجابة على هذا السؤال. حاول صياغته بطريقة أخرى.';
  // الهوية ثابتة: إذا سُئل عنها أو ذكر النموذج شركة أخرى نستبدل الجواب
  if (identityQ && (small || LEAK.test(answer))) answer = IDENTITY_ANSWER;

  // نحتفظ فقط بالمصادر التي ذُكرت فعلاً في الجواب
  const cited = cached ? cached.sources ?? [] : sources.filter((_, i) => answer.includes(`[${ar(i + 1)}]`) || answer.includes(`[${i + 1}]`));
  if (cacheKey && !cached && answer.length > 40) {
    await admin.from('ai_cache').upsert({ key: cacheKey, subject_id: subjectId ?? null, question: text, answer, sources: cited.length ? cited : null, created_at: new Date().toISOString(), hits: 0 })
      .then(({ error }) => { if (error) console.error('cache', error.message); });
  }

  // وقتان مختلفان حتى يبقى السؤال قبل جوابه عند الترتيب
  const t = Date.now();
  const { data: saved } = await admin.from('ai_messages').insert([
    { chat_id: chat, role: 'user', content: attachments.length ? `${text}\n\n(مرفقات: ${attachments.map((a: { mime: string; name: string }) => a.name || (a.mime === 'application/pdf' ? 'ملف PDF' : 'صورة')).join('، ')})` : text, created_at: new Date(t).toISOString() },
    { chat_id: chat, role: 'assistant', content: answer, sources: cited.length ? cited : null, created_at: new Date(t + 5).toISOString() },
  ]).select('id, role');
  const answerId = (saved ?? []).find((r) => r.role === 'assistant')?.id ?? null;
  // خطة الشرح المقسّم: نسجل القسم المكتمل (سؤال آخر بين الأقسام لا يغيّرها، و«أكمل» يتابع بعده)
  let planOut: (Plan & { done: boolean }) | null = null;
  const chatPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (activePlan && partNo && answerId) {
    const next = { ...activePlan, next: partNo, ids: [...activePlan.ids, answerId] };
    chatPatch.plan = next;
    planOut = { ...next, done: next.next >= next.parts.length };
  }
  await admin.from('ai_chats').update(chatPatch).eq('id', chat);

  return json({
    chatId: chat,
    answer,
    messageId: answerId,
    plan: planOut,
    sources: cited,
    remaining: caller.role === 'admin' ? null : used === null ? undefined : Math.max(0, limit - used),
    cached: !!cached,
  });
}));
