import { admin } from './supabase.ts';

const API = 'https://generativelanguage.googleapis.com';

/**
 * المفاتيح («خانات» بأسماء أسرارها، ولا نحفظ المفتاح نفسه في أي مكان):
 * - الطلاب: GEMINI_API_KEY ثم GEMINI_API_KEY_2 … GEMINI_API_KEY_8 (كل مفتاح من مشروع/حساب مختلف بحصته الخاصة)
 * - لوحة التحكم: GEMINI_ADMIN_API_KEY أولاً ثم مفاتيح الطلاب احتياطاً
 *
 * حصة Google المجانية لكل مشروع: ٢٠ طلباً يومياً و٥ في الدقيقة **لكل نموذج**.
 * لذلك الترتيب: كل نماذج المفتاح الأول (3.8 ← 3.7 ← … ← 3.1) ثم المفتاح الثاني… ثم 2.5 احتياطاً على كل المفاتيح.
 * النموذج الذي تنتهي حصته يُقفل في قاعدة البيانات حتى الوقت الذي تحدده Google (retryDelay)،
 * فلا تضيع طلبات عليه من أي دالة أو طالب آخر.
 */
export type Pool = 'student' | 'admin';
export const STUDENT_VARS = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GEMINI_API_KEY_7', 'GEMINI_API_KEY_8'];
export const ADMIN_VAR = 'GEMINI_ADMIN_API_KEY';
export const DAILY_PER_MODEL = 20;

export interface KeySlot { slot: string; key: string }

/** المفاتيح المضافة فعلاً بالترتيب (بلا تكرار لنفس المفتاح) */
export function poolSlots(pool: Pool = 'student'): KeySlot[] {
  const vars = pool === 'admin' ? [ADMIN_VAR, ...STUDENT_VARS] : STUDENT_VARS;
  const seen = new Set<string>();
  const out: KeySlot[] = [];
  for (const v of vars) {
    const key = (Deno.env.get(v) ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: v, key });
  }
  if (!out.length) throw new Error('GEMINI_API_KEY is not set');
  return out;
}

/** للتوافق: المفاتيح فقط */
export function poolKeys(pool: Pool = 'student'): string[] {
  return poolSlots(pool).map((s) => s.key);
}

export type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };
export interface Content { role: 'user' | 'model'; parts: Part[] }

export interface GenerateOptions {
  system?: string;
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  /** مقدار التفكير قبل الإجابة: minimal للتحية والأسئلة البسيطة (أسرع بكثير) */
  thinking?: 'minimal' | 'low' | 'medium' | 'high';
  /** مجموعة المفاتيح (الافتراضي: الطلاب) */
  pool?: Pool;
  /** مفتاح محدد باسم خانته (ملف رُفع إلى Gemini بمفتاح معيّن لا يقرؤه غيره) */
  slot?: string;
  /** للتوافق مع الروابط القديمة: رقم المفتاح في المجموعة */
  keyIndex?: number;
  /** لم يعد مستخدماً (الترتيب دائماً: المفتاح الأول بكل نماذجه ثم الذي بعده) */
  spread?: boolean;
  /** إعدادات إضافية لـ generationConfig (مثل mediaResolution للفيديو) */
  extraConfig?: Record<string, unknown>;
  /** آخر وقت مسموح (Date.now()): بعده يُقطع الطلب ويُرمى GeminiTimeoutError (دوال الخادم محدودة ~١٥٠ ث) */
  deadline?: number;
  /**
   * مسار القارئ (للعمل المتوازي): القارئ رقم n يبدأ بالمفتاح n ثم يدور على البقية،
   * فلا يتزاحم القرّاء على مفتاح واحد ونموذجه (حد ٥ طلبات في الدقيقة لكل نموذج).
   */
  lane?: number;
}

export class GeminiTimeoutError extends Error {}

export class GeminiQuotaError extends Error {}

/** النماذج بالترتيب على كل مفتاح (الأقوى أولاً) */
export const MAIN_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
/** التحية والأسئلة القصيرة: الخفيفة أولاً (توفّر حصة النماذج القوية) */
export const LITE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];
/** الاحتياط الأخير بعد انتهاء كل النماذج على كل المفاتيح */
export const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/**
 * سلسلة النماذج: ثابتة بالترتيب أعلاه. إعداد النموذج القديم في لوحة التحكم حُذف ويُتجاهل
 * (قيمة قديمة مثل gemini-2.5-flash كانت ستقدّم نموذجاً ضعيفاً على الأقوى).
 */
export function modelChain(_setting: string | undefined | null, defaults: string[] = MAIN_MODELS): string[] {
  return [...new Set(defaults)];
}

// ───────────────── أقفال النماذج المشتركة (قاعدة البيانات + نسخة في الذاكرة لثوانٍ) ─────────────────
const blocks = new Map<string, number>(); // "slot|model" ← حتى متى
let blocksLoadedAt = 0;
const bk = (slot: string, model: string) => `${slot}|${model}`;

export async function refreshBlocks(force = false) {
  if (!force && Date.now() - blocksLoadedAt < 15_000) return;
  try {
    const { data } = await admin.from('ai_key_blocks').select('slot, model, blocked_until').gt('blocked_until', new Date().toISOString());
    blocks.clear();
    for (const r of (data ?? []) as { slot: string; model: string; blocked_until: string }[]) blocks.set(bk(r.slot, r.model), Date.parse(r.blocked_until));
    blocksLoadedAt = Date.now();
  } catch { /* الجدول غير موجود بعد: نعمل بالذاكرة فقط */ }
}

function blockedUntil(slot: string, model: string): number {
  const now = Date.now();
  const a = blocks.get(bk(slot, model)) ?? 0;
  const b = blocks.get(bk(slot, '*')) ?? 0;
  const t = Math.max(a, b);
  return t > now ? t : 0;
}

async function block(slot: string, model: string, ms: number, reason: string) {
  const until = Date.now() + ms;
  if ((blocks.get(bk(slot, model)) ?? 0) >= until) return;
  blocks.set(bk(slot, model), until);
  try {
    await admin.from('ai_key_blocks').upsert({ slot, model, blocked_until: new Date(until).toISOString(), reason: reason.slice(0, 200), updated_at: new Date().toISOString() });
  } catch { /* تجاهل */ }
}

async function logCall(slot: string, model: string, ok: boolean, status?: number, error?: string) {
  try {
    await admin.rpc('ai_log_call', { p_slot: slot, p_model: model, p_ok: ok, p_status: status ?? null, p_error: error ?? null });
  } catch { /* العداد اختياري */ }
}

/** مدة الانتظار التي تطلبها Google بعد 429: retryDelay أو «Please retry in 3h35m54s» */
export function retryAfterMs(detail: string): number | null {
  const d = detail.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (d) return Math.ceil(Number(d[1]) * 1000);
  const m = detail.match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
  return null;
}

/**
 * حصة يومية (لا دقيقة)؟ الحد اليومي في الطبقة المجانية ٢٠ لكل نموذج ويتجدد ٣:٠٠ فجراً بتوقيت العراق لكل النماذج،
 * وحد الدقيقة ٥ (انتظاره ثوانٍ). فـ «limit: 20» أو انتظار أطول من ١٠ دقائق = يومي.
 */
export const isDailyQuota = (detail: string) => {
  if (/PerDay|per_day|per day|daily/i.test(detail)) return true;
  if (/PerMinute|per_minute|per minute/i.test(detail)) return false;
  const limit = Number(detail.match(/limit:\s*(\d+)/)?.[1]);
  if (limit >= 10) return true;
  return (retryAfterMs(detail) ?? 0) > 10 * 60_000;
};

/** ٣:٠٠ فجراً القادمة بتوقيت العراق (UTC+3 ثابت بلا توقيت صيفي) = منتصف الليل UTC */
export function nextIraqReset(now = Date.now()): number {
  const n = new Date(now);
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
}

/**
 * ترتيب المحاولات:
 * - الطلاب: كل نماذج المفتاح الأول ثم الثاني… (يوزع الاستهلاك ويحفظ النماذج القوية للمفاتيح التالية)
 * - لوحة التحكم (strongFirst): أقوى نموذج على كل المفاتيح أولاً ثم الذي يليه — الفهرسة تأخذ أفضل جودة متاحة
 * ثم نماذج الاحتياط (2.5) بنفس الطريقة.
 */
export function attemptOrder(slots: string[], models: string[], fallback: string[] = FALLBACK_MODELS, strongFirst = false): { slot: string; m: string }[] {
  const out: { slot: string; m: string }[] = [];
  const fb = fallback.filter((m) => !models.includes(m));
  for (const list of [models, fb]) {
    if (strongFirst) for (const m of list) for (const slot of slots) out.push({ slot, m });
    else for (const slot of slots) for (const m of list) out.push({ slot, m });
  }
  return out;
}

/** أفضل مفتاح للوحة: الذي عنده أقوى نموذج متاح الآن (لرفع ملف الفهرسة إليه) */
export async function strongestSlot(pool: Pool, models: string[] = MAIN_MODELS): Promise<{ slot: string; rank: number } | null> {
  await refreshBlocks(true);
  const all = [...models, ...FALLBACK_MODELS.filter((m) => !models.includes(m))];
  for (let r = 0; r < all.length; r++) {
    for (const s of poolSlots(pool)) if (!blockedUntil(s.slot, all[r])) return { slot: s.slot, rank: r };
  }
  return null;
}

/** ترتيب أقوى نموذج متاح على مفتاح محدد (أصغر = أقوى)، أو null إن انتهى كله */
export async function slotRank(slot: string, models: string[] = MAIN_MODELS): Promise<number | null> {
  await refreshBlocks(true);
  const all = [...models, ...FALLBACK_MODELS.filter((m) => !models.includes(m))];
  const r = all.findIndex((m) => !blockedUntil(slot, m));
  return r < 0 ? null : r;
}

/** هل لهذا المفتاح نموذج متاح الآن؟ (لنقل ملف الفهرسة إلى مفتاح آخر عند انتهاء حصة الأول) */
export async function slotAvailable(slot: string, models: string[] = MAIN_MODELS): Promise<boolean> {
  await refreshBlocks(true);
  return [...models, ...FALLBACK_MODELS].some((m) => !blockedUntil(slot, m));
}

/** أول مفتاح فيه نموذج متاح (عدا المستثنى) */
export async function firstAvailableSlot(pool: Pool, models: string[] = MAIN_MODELS, exclude: string[] = []): Promise<string | null> {
  await refreshBlocks(true);
  for (const s of poolSlots(pool)) {
    if (exclude.includes(s.slot)) continue;
    if ([...models, ...FALLBACK_MODELS].some((m) => !blockedUntil(s.slot, m))) return s.slot;
  }
  return null;
}

const AR_TIME = (t: number) => new Date(t).toLocaleTimeString('ar-IQ', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' });

export async function generate(model: string | string[], contents: Content[], opts: GenerateOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      ...opts.extraConfig,
    },
  };
  if (opts.system) body.system_instruction = { parts: [{ text: opts.system }] };
  const config = body.generationConfig as Record<string, unknown>;

  const all = poolSlots(opts.pool);
  const keyOf = new Map(all.map((s) => [s.slot, s.key]));
  const pinned = opts.slot ?? (opts.keyIndex !== undefined ? all[opts.keyIndex]?.slot : undefined);
  if (pinned && !keyOf.has(pinned)) throw new GeminiQuotaError(`key ${pinned} not available`);
  let slots = pinned ? [pinned] : all.map((s) => s.slot);
  if (!pinned && opts.lane !== undefined && slots.length > 1) {
    const k = ((opts.lane % slots.length) + slots.length) % slots.length;
    slots = [...slots.slice(k), ...slots.slice(0, k)];
  }
  const models = Array.isArray(model) ? model : modelChain(model);
  await refreshBlocks();
  const order = attemptOrder(slots, models, FALLBACK_MODELS, opts.pool === 'admin');
  const failures: string[] = [];
  let busy = false;
  let tried = 0;
  for (const a of order) {
    // مقفل (حصته انتهت أو مشغول): نتخطاه، ونعدّه «مشغولاً» حتى تكون الرسالة للطالب صحيحة
    if (blockedUntil(a.slot, a.m)) { if (!blockedUntil(a.slot, '*')) busy = true; continue; }
    tried++;
    let thinking = opts.thinking;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (thinking) config.thinkingConfig = { thinkingLevel: thinking };
      else delete config.thinkingConfig;
      let res: Response;
      const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
      if (left < 3000) throw new GeminiTimeoutError('انتهت المهلة');
      const ctl = Number.isFinite(left) ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), left) : undefined;
      try {
        res = await fetch(`${API}/v1beta/models/${a.m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyOf.get(a.slot)! },
          body: JSON.stringify(body),
          ...(ctl ? { signal: ctl.signal } : {}),
        });
        if (res.ok && timer) { const t = await res.text(); clearTimeout(timer); res = new Response(t, { status: res.status }); }
        else if (timer) clearTimeout(timer);
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (ctl?.signal.aborted) throw new GeminiTimeoutError('انتهت المهلة');
        busy = true;
        failures.push(`${a.slot}/${a.m}: network ${String((e as Error).message ?? e).slice(0, 60)}`);
        break;
      }
      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('').trim();
        await logCall(a.slot, a.m, true, 200);
        if (text) return text;
        break; // جواب فارغ (حظر أو قطع): نجرب غيره
      }
      const status = res.status;
      const detail = (await res.text()).slice(0, 4000);
      const msg = (detail.match(/"message":\s*"([^"]{0,200})/)?.[1] ?? '').trim();
      failures.push(`${a.slot}/${a.m}: ${status} ${msg.slice(0, 120)}`);
      await logCall(a.slot, a.m, false, status, msg || detail.slice(0, 200));
      if (status === 404) { await block(a.slot, a.m, 6 * 3600_000, 'النموذج غير متاح لهذا المفتاح'); break; }
      if (status === 400 && thinking && attempt === 0 && /thinking/i.test(detail)) {
        thinking = undefined; // نموذج لا يدعم مستوى التفكير: نعيد بدونه
        continue;
      }
      if (status === 429) {
        // انتهت حصة هذا النموذج على هذا المفتاح: نقفله حتى الوقت الذي تحدده Google وننتقل للتالي
        busy = true;
        // يومي ← مقفل حتى ٣:٠٠ فجراً بتوقيت العراق (موعد تجدد كل النماذج)؛ دقيقة ← المدة التي تطلبها Google
        if (isDailyQuota(detail)) await block(a.slot, a.m, nextIraqReset() - Date.now() + 30_000, 'انتهت الحصة اليومية — تعود ٣:٠٠ فجراً');
        else await block(a.slot, a.m, (retryAfterMs(detail) ?? 60_000) + 2000, 'حد الدقيقة (٥ طلبات)');
        break;
      }
      if (status === 503) { busy = true; await block(a.slot, a.m, 2 * 60_000, 'مشغول عند Google'); break; }
      if (status === 500 && attempt === 0) { busy = true; continue; }
      if (status >= 500) { busy = true; await block(a.slot, a.m, 60_000, `خطأ ${status} عند Google`); break; }
      if (status === 401 || status === 403) {
        console.error(`Gemini ${a.slot} ${a.m} ${status}: ${detail.slice(0, 300)}`);
        // المفتاح نفسه مرفوض (غير صالح/موقوف/المشروع محجوب): نقفل المفتاح كله
        if (status === 401 || /API_KEY_INVALID|API key not valid|SERVICE_DISABLED|has been suspended|denied access|PERMISSION_DENIED.*project/i.test(detail)) {
          await block(a.slot, '*', 6 * 3600_000, msg || `مرفوض ${status}`);
        }
        if (pinned) throw new Error(`Gemini ${a.m} ${status}: ${msg || detail.slice(0, 200)}`);
        break;
      }
      if (status === 400) {
        if (/API_KEY_INVALID|API key not valid/i.test(detail)) { await block(a.slot, '*', 6 * 3600_000, 'مفتاح غير صالح'); break; }
        // طلب غير مقبول (محتوى/ملف): لا علاقة له بالحصة
        if (pinned) throw new Error(`Gemini ${a.m} ${status}: ${msg || detail.slice(0, 200)}`);
        break;
      }
      throw new Error(`Gemini ${a.m} ${status}: ${msg || detail.slice(0, 200)}`);
    }
  }
  if (busy || !tried) {
    await refreshBlocks(true);
    const next = Math.min(...order.map((a) => blockedUntil(a.slot, a.m)).filter(Boolean));
    throw new GeminiQuotaError(Number.isFinite(next) ? `كل النماذج مشغولة أو انتهت حصتها حتى ${AR_TIME(next)}` : 'all models busy');
  }
  throw new Error(`Gemini لم يُجب. ${[...new Set(failures)].slice(0, 6).join(' | ') || 'جواب فارغ'}`);
}

const EMBED_MODEL = 'gemini-embedding-001';
const DIMS = 768;

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export async function embed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', pool: Pool = 'student'): Promise<number[][]> {
  const slots = poolSlots(pool);
  await refreshBlocks();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    let done = false;
    let quota = false;
    let lastErr = '';
    const usable = slots.filter((s) => !blockedUntil(s.slot, EMBED_MODEL));
    for (const s of usable.length ? usable : slots) {
      const res = await fetchEmbed(s.key, batch, taskType).catch(() => null);
      if (!res) { lastErr = 'network'; continue; }
      if (res.ok) {
        const data = await res.json();
        for (const e of data.embeddings) out.push(normalize(e.values));
        await logCall(s.slot, EMBED_MODEL, true, 200);
        done = true;
        break;
      }
      const detail = (await res.text()).slice(0, 2000);
      lastErr = `${res.status}: ${detail.slice(0, 200)}`;
      await logCall(s.slot, EMBED_MODEL, false, res.status, detail.slice(0, 200));
      if (res.status === 429) {
        quota = true;
        await block(s.slot, EMBED_MODEL, isDailyQuota(detail) ? nextIraqReset() - Date.now() + 30_000 : (retryAfterMs(detail) ?? 60_000) + 2000, 'حصة التضمين');
      } else if (res.status === 401 || res.status === 403) {
        await block(s.slot, '*', 6 * 3600_000, `مرفوض ${res.status}`);
      } else if (res.status < 500 && res.status !== 400) {
        break;
      }
    }
    if (!done) {
      if (quota) throw new GeminiQuotaError('embed quota');
      throw new Error(`Gemini embed ${lastErr}`);
    }
  }
  return out;
}

function fetchEmbed(k: string, batch: string[], taskType: string) {
  return fetch(`${API}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
    body: JSON.stringify({
      requests: batch.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: DIMS,
      })),
    }),
  });
}

/**
 * رفع ملف كبير (PDF) إلى Gemini File API — يبقى ٤٨ ساعة، ولا يقرؤه إلا نفس المفتاح.
 * يعيد «s:<اسم الخانة>|<الرابط>» حتى نستخدم المفتاح نفسه عند القراءة (انظر fileRef).
 * prefer: خانة نريد الرفع إليها (مثلاً عند نقل الفهرسة لمفتاح ما زالت حصته متاحة).
 */
export async function uploadFile(bytes: Uint8Array, mimeType: string, displayName: string, pool: Pool = 'admin', prefer?: string, models: string[] = MAIN_MODELS): Promise<string> {
  await refreshBlocks(true);
  const slots = poolSlots(pool);
  // المفضَّل أولاً، ثم من لديه نماذج متاحة، ثم البقية
  const ranked = [...slots].sort((a, b) => {
    const score = (s: KeySlot) => (s.slot === prefer ? 0 : [...models, ...FALLBACK_MODELS].some((m) => !blockedUntil(s.slot, m)) ? 1 : 2);
    return score(a) - score(b);
  });
  let last: unknown;
  for (const s of ranked) {
    if (blockedUntil(s.slot, '*')) continue;
    try {
      return `s:${s.slot}|${await uploadWith(s.key, bytes, mimeType, displayName)}`;
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new GeminiQuotaError('no key available for upload');
}

/** يفك «s:<خانة>|<الرابط>» أو الصيغة القديمة «k<رقم>|<الرابط>» */
export function fileRef(stored: string): { uri: string; slot?: string; keyIndex: number } {
  const s = stored.match(/^s:([A-Z0-9_]+)\|(.+)$/);
  if (s) return { uri: s[2], slot: s[1], keyIndex: -1 };
  const m = stored.match(/^k(\d+)\|(.+)$/);
  return m ? { uri: m[2], keyIndex: Number(m[1]) } : { uri: stored, keyIndex: 0 };
}

async function uploadWith(apiKey: string, bytes: Uint8Array, mimeType: string, displayName: string): Promise<string> {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error(`Gemini upload start ${start.status}: ${await start.text()}`);
  const done = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  if (!done.ok) throw new Error(`Gemini upload ${done.status}: ${await done.text()}`);
  let file = (await done.json()).file;
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${API}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': apiKey } });
    file = await res.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Gemini file state ${file.state}`);
  return file.uri as string;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** يستخرج JSON حتى لو أحاطه النموذج بعلامات ``` */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned) as T;
}

/** يقطع النص إلى أجزاء ~١٢٠٠ حرف مع تداخل بسيط، على حدود الفقرات قدر الإمكان */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n', end);
      if (para > start + size / 2) end = para;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter(Boolean);
}
