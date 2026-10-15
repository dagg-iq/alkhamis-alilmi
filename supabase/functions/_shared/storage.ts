// تخزين الملفات: Supabase Storage (افتراضي، بلا بطاقة دفع) أو أي تخزين متوافق مع S3 (Cloudflare R2 / Backblaze B2)
// عند إضافة أسراره. نفس الدوال للحالتين، فلا يتغير شيء في التطبيق أو لوحة التحكم.
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { admin } from './supabase.ts';

const BUCKET = 'files';

// ---------------------------------------------------------------- S3 (R2 أو B2) إن وُجدت أسراره
const s3Key = Deno.env.get('R2_ACCESS_KEY_ID');
const s3Secret = Deno.env.get('R2_SECRET_ACCESS_KEY');
const s3Bucket = Deno.env.get('R2_BUCKET') ?? 'saey';
// R2: يكفي R2_ACCOUNT_ID — غيره (مثل B2): S3_ENDPOINT كامل، مثلاً https://s3.eu-central-003.backblazeb2.com
const s3Endpoint = Deno.env.get('S3_ENDPOINT')
  ?? (Deno.env.get('R2_ACCOUNT_ID') ? `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com` : null);
const useS3 = Boolean(s3Key && s3Secret && s3Endpoint);
const s3 = useS3
  ? new AwsClient({ accessKeyId: s3Key!, secretAccessKey: s3Secret!, service: 's3', region: Deno.env.get('S3_REGION') ?? 'auto' })
  : null;

/** أقصى حجم ملف واحد (Supabase المجاني: ٥٠ ميغا) */
export const MAX_UPLOAD_BYTES = useS3 ? 500 * 1024 * 1024 : 50 * 1024 * 1024;
export const storageName = useS3 ? 's3' : 'supabase';

function objectUrl(key: string): URL {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`${s3Endpoint}/${s3Bucket}/${path}`);
}

// ---------------------------------------------------------------- Supabase: إنشاء الحاوية مرة واحدة
let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Storage: ${error.message}`);
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

// ---------------------------------------------------------------- احتياط: خادم S3 متوقف ← Supabase Storage
// خادم صاحب المشروع (S3) توقف أكثر من مرة فتعطلت الكتب والرفع للجميع. الآن:
// - القراءة: Supabase أولاً إن كان الملف فيه (الكتب القديمة كلها هناك)، ثم S3.
// - الرفع والكتابة: S3 إن كان يرد، وإلا Supabase (فلا يتوقف التطبيق).
let s3State: { up: boolean; at: number } | null = null;
async function s3Up(): Promise<boolean> {
  if (!s3) return false;
  if (s3State && Date.now() - s3State.at < 60_000) return s3State.up;
  let up = false;
  try {
    await fetch(s3Endpoint!, { method: 'HEAD', signal: AbortSignal.timeout(3_000) });
    up = true; // أي رد (حتى 403) = الخادم يعمل
  } catch { /* لا يرد */ }
  s3State = { up, at: Date.now() };
  if (!up) console.warn('S3 لا يرد — Supabase Storage احتياطاً');
  return up;
}
function s3Failed() { s3State = { up: false, at: Date.now() }; }

/** هل الملف موجود في Supabase Storage؟ */
async function inSupabase(key: string): Promise<boolean> {
  const i = key.lastIndexOf('/');
  const { data } = await admin.storage.from(BUCKET).list(i > 0 ? key.slice(0, i) : '', { search: key.slice(i + 1), limit: 1 });
  return Boolean(data?.some((o) => o.name === key.slice(i + 1)));
}

async function supabaseUrl(method: 'GET' | 'PUT', key: string, expiresSec: number): Promise<string> {
  await ensureBucket();
  if (method === 'PUT') {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`Storage: ${error?.message}`);
    return data.signedUrl;
  }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(key, expiresSec);
  if (error || !data) throw new Error(`Storage: ${error?.message}`);
  return data.signedUrl;
}

/** رابط مؤقت للرفع (PUT بمحتوى الملف مباشرة) أو للتحميل (GET) */
export async function presign(method: 'GET' | 'PUT', key: string, expiresSec = 3600, contentType?: string): Promise<string> {
  if (s3) {
    const useS3 = method === 'GET' ? !(await inSupabase(key).catch(() => false)) : await s3Up();
    if (useS3) {
      const url = objectUrl(key);
      url.searchParams.set('X-Amz-Expires', String(expiresSec));
      const headers: Record<string, string> = {};
      if (method === 'PUT' && contentType) headers['Content-Type'] = contentType;
      const signed = await s3.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
      return signed.url;
    }
  }
  return await supabaseUrl(method, key, expiresSec);
}

async function supabaseGet(key: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Storage GET ${key}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function getObject(key: string): Promise<Uint8Array> {
  if (s3) {
    try { return await supabaseGet(key); } catch { /* ليس في Supabase: من S3 */ }
    // مهلة: خادم التخزين المتوقف كان يعلّق الطلب دقيقتين (مهلة اتصال TCP) فتنتهي الدالة كلها بخطأ
    if (!(await s3Up())) throw new Error(`S3 لا يرد (${key})`);
    let res: Response;
    try {
      res = await s3.fetch(objectUrl(key), { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      s3Failed();
      throw e;
    }
    if (!res.ok) throw new Error(`S3 GET ${key} → ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return await supabaseGet(key);
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (s3 && await s3Up()) {
    try {
      const res = await s3.fetch(objectUrl(key), { method: 'PUT', body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`S3 PUT ${key} → ${res.status}`);
      return;
    } catch (e) {
      s3Failed();
      console.warn('S3 PUT فشل — Supabase احتياطاً', String(e).slice(0, 120));
    }
  }
  await ensureBucket();
  const { error } = await admin.storage.from(BUCKET).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage PUT ${key}: ${error.message}`);
}

export async function deleteObject(key: string): Promise<void> {
  // الملف قد يكون في أي منهما
  await admin.storage.from(BUCKET).remove([key]).catch(() => {});
  if (s3 && await s3Up()) await s3.fetch(objectUrl(key), { method: 'DELETE', signal: AbortSignal.timeout(8_000) }).catch(() => s3Failed());
}

/**
 * حذف عدة ملفات «بأفضل جهد» بلا تعطيل: بالتوازي وبحد أقصى للوقت. ملف لم يُحذف (التخزين متوقف) يبقى يتيماً
 * ولا يضر — أفضل من أن يفشل زر «إيقاف»/«فهرسة» كله بخطأ.
 */
export async function deleteObjectsQuietly(keys: string[], maxMs = 10_000): Promise<void> {
  if (!keys.length) return;
  await Promise.race([
    Promise.allSettled(keys.map((k) => deleteObject(k))),
    new Promise((r) => setTimeout(r, maxMs)),
  ]);
}
