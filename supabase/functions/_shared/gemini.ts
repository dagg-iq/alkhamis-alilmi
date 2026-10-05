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

export async function generate(model: string, contents: Content[], opts: GenerateOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (opts.system) body.system_instruction = { parts: [{ text: opts.system }] };

  // محاولة ثانية واحدة عند الضغط المؤقت
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new GeminiQuotaError('quota');
    }
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: { text?: string }) => p.text ?? '').join('').trim();
  }
  throw new GeminiQuotaError('quota');
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
