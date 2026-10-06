const API = 'https://generativelanguage.googleapis.com';

/**
 * مجموعات المفاتيح:
 * - الطلاب: GEMINI_API_KEY و GEMINI_API_KEY_2..4 (كل مفتاح من مشروع منفصل بحصته الخاصة)
 * - لوحة التحكم: GEMINI_ADMIN_API_KEY (الفهرسة والتصنيف) — حتى لا تأكل من حصة الطلاب
 */
export type Pool = 'student' | 'admin';
const STUDENT_VARS = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4'];

function studentKeys(): string[] {
  return STUDENT_VARS.map((v) => Deno.env.get(v) ?? '').filter(Boolean);
}

export function poolKeys(pool: Pool = 'student'): string[] {
  const students = studentKeys();
  const adminKey = Deno.env.get('GEMINI_ADMIN_API_KEY');
  const keys = pool === 'admin' ? (adminKey ? [adminKey] : students) : students;
  if (!keys.length) throw new Error('GEMINI_API_KEY is not set');
  return keys;
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
  /** مفتاح محدد (ملف رُفع إلى Gemini بمفتاح معيّن لا يقرؤه غيره) */
  keyIndex?: number;
  /** كل مفتاح يبدأ بنموذج مختلف (الافتراضي). false = الأسرع أولاً على كل المفاتيح */
  spread?: boolean;
}

// النماذج المشغولة مؤقتاً: نتخطاها مباشرة بدل انتظارها في كل سؤال (تبقى في ذاكرة الدالة ما دامت تعمل)
const busyUntil = new Map<string, number>();

export class GeminiQuotaError extends Error {}

/**
 * سلاسل النماذج: الأقوى أولاً، وإذا كان مشغولاً (503) أو انتهت حصته (429) أو أُوقف (404)
 * ننتقل للتالي تلقائياً — فلا يرى الطالب «المساعد مشغول» إلا إذا تعطلت كلها.
 * (gemini-2.5 أُوقفت للحسابات الجديدة، و Pro غير متاح في الطبقة المجانية)
 */
export const MAIN_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const LITE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

/** النموذج من الإعدادات أولاً (يقبل عدة أسماء مفصولة بفواصل)، ثم الافتراضيات */
export function modelChain(setting: string | undefined | null, defaults: string[] = MAIN_MODELS): string[] {
  const fromSetting = (setting ?? '').split(',').map((m) => m.trim()).filter((m) => m && !m.startsWith('gemini-2.'));
  return [...new Set([...fromSetting, ...defaults])];
}

/**
 * ترتيب المحاولات: كل مفتاح يبدأ بنموذج مختلف (مفتاح ١ ← النموذج ١، مفتاح ٢ ← النموذج ٢…)،
 * ثم تدور الجولة التالية. المشغول (503/429) يُتخطى لدقائق.
 */
function attempts(keys: string[], models: string[], spread: boolean, pinned?: number): { k: number; m: string }[] {
  const ks = pinned !== undefined ? [pinned] : keys.map((_, i) => i);
  const out: { k: number; m: string }[] = [];
  if (!spread) {
    // الأسرع أولاً على كل المفاتيح (للتحية والأسئلة القصيرة)
    for (const m of models) for (const k of ks) out.push({ k, m });
    return out;
  }
  for (let r = 0; r < models.length; r++) {
    for (const k of ks) out.push({ k, m: models[(k + r) % models.length] });
  }
  return out;
}

// مفتاح مرفوض (غير صالح أو موقوف): نتجاهله كله لفترة
const badKeyUntil = new Map<string, number>();

export async function generate(model: string | string[], contents: Content[], opts: GenerateOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (opts.system) body.system_instruction = { parts: [{ text: opts.system }] };
  const config = body.generationConfig as Record<string, unknown>;

  const keys = poolKeys(opts.pool);
  const models = Array.isArray(model) ? model : modelChain(model);
  const all = attempts(keys, models, opts.spread ?? true, opts.keyIndex);
  const now = Date.now();
  const tag = (a: { k: number; m: string }) => `${opts.pool ?? 'student'}:${a.k}:${a.m}`;
  const free = all.filter((a) => (busyUntil.get(tag(a)) ?? 0) <= now);
  const order = free.length ? [...free, ...all.filter((a) => !free.includes(a))] : all;
  const missing = new Set<string>(); // نموذج غير موجود لهذا المفتاح
  let busy = false;
  for (const a of order) {
    if (missing.has(tag(a))) continue;
    if ((badKeyUntil.get(keys[a.k]) ?? 0) > Date.now() && opts.keyIndex === undefined) continue;
    let thinking = opts.thinking;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (thinking) config.thinkingConfig = { thinkingLevel: thinking };
      else delete config.thinkingConfig;
      const res = await fetch(`${API}/v1beta/models/${a.m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[a.k] },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('').trim();
        if (text) return text;
        break; // جواب فارغ (حظر أو قطع): نجرب غيره
      }
      const status = res.status;
      const detail = (await res.text()).slice(0, 300);
      if (status === 404) { missing.add(tag(a)); break; }
      if (status === 400 && thinking && attempt === 0) {
        thinking = undefined; // نموذج لا يدعم مستوى التفكير: نعيد بدونه
        continue;
      }
      if (status === 429 || status === 503) {
        // مشغول أو انتهت حصة هذا المفتاح لهذا النموذج: ننتقل فوراً ونتخطاه لفترة
        busy = true;
        busyUntil.set(tag(a), Date.now() + (status === 429 ? 10 : 2) * 60_000);
        break;
      }
      if (status === 500 && attempt === 0) {
        busy = true;
        continue;
      }
      if (status === 400 || status === 401 || status === 403) {
        // مفتاح غير صالح أو موقوف: لا نوقف كل شيء، نجرب المفتاح التالي
        console.error(`Gemini key ${a.k} ${a.m} ${status}: ${detail}`);
        if (status === 400) busyUntil.set(tag(a), Date.now() + 30 * 60_000);
        else badKeyUntil.set(keys[a.k], Date.now() + 30 * 60_000);
        break;
      }
      throw new Error(`Gemini ${a.m} ${status}: ${detail}`);
    }
  }
  if (busy) throw new GeminiQuotaError('all models busy');
  throw new Error('Gemini: no model returned an answer');
}

const EMBED_MODEL = 'gemini-embedding-001';
const DIMS = 768;

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export async function embed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', pool: Pool = 'student'): Promise<number[][]> {
  const keys = poolKeys(pool);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    let res: Response | null = null;
    for (const k of keys) {
      res = await fetchEmbed(k, batch, taskType);
      if (res.status !== 429 && res.status !== 403) break;
    }
    if (!res) throw new Error('no key');
    if (res.status === 429) throw new GeminiQuotaError('quota');
    if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const e of data.embeddings) out.push(normalize(e.values));
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
 * يعيد «k<رقم>|<الرابط>» حتى نستخدم المفتاح نفسه عند القراءة (انظر fileRef).
 */
export async function uploadFile(bytes: Uint8Array, mimeType: string, displayName: string, pool: Pool = 'admin'): Promise<string> {
  const keys = poolKeys(pool);
  let last: unknown;
  for (let k = 0; k < keys.length; k++) {
    try {
      return `k${k}|${await uploadWith(keys[k], bytes, mimeType, displayName)}`;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** يفك «k<رقم>|<الرابط>» (والروابط القديمة بلا رقم ← المفتاح الأول) */
export function fileRef(stored: string): { uri: string; keyIndex: number } {
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
