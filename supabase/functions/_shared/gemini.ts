const API = 'https://generativelanguage.googleapis.com';
const key = () => {
  const k = Deno.env.get('GEMINI_API_KEY');
  if (!k) throw new Error('GEMINI_API_KEY is not set');
  return k;
};

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
}

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

  const models = Array.isArray(model) ? model : modelChain(model);
  let busy = false;
  for (const m of models) {
    // محاولتان لكل نموذج عند الضغط المؤقت، ثم الانتقال للتالي
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${API}/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('').trim();
        if (text) return text;
        break; // جواب فارغ (حظر أو قطع): نجرب نموذجاً آخر
      }
      const status = res.status;
      const detail = (await res.text()).slice(0, 300);
      if (status === 404) break; // النموذج غير متاح لهذا الحساب
      if (status === 429 || status === 503 || status === 500) {
        busy = true;
        if (attempt === 0 && status !== 429) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        break;
      }
      throw new Error(`Gemini ${m} ${status}: ${detail}`);
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

export async function embed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const res = await fetch(`${API}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: DIMS,
        })),
      }),
    });
    if (res.status === 429) throw new GeminiQuotaError('quota');
    if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const e of data.embeddings) out.push(normalize(e.values));
  }
  return out;
}

/** رفع ملف كبير (PDF) إلى Gemini File API — يبقى ٤٨ ساعة */
export async function uploadFile(bytes: Uint8Array, mimeType: string, displayName: string): Promise<string> {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key(),
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
    const res = await fetch(`${API}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key() } });
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
