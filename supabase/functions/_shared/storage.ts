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

/** رابط مؤقت للرفع (PUT بمحتوى الملف مباشرة) أو للتحميل (GET) */
export async function presign(method: 'GET' | 'PUT', key: string, expiresSec = 3600, contentType?: string): Promise<string> {
  if (s3) {
    const url = objectUrl(key);
    url.searchParams.set('X-Amz-Expires', String(expiresSec));
    const headers: Record<string, string> = {};
    if (method === 'PUT' && contentType) headers['Content-Type'] = contentType;
    const signed = await s3.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
  }
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

export async function getObject(key: string): Promise<Uint8Array> {
  if (s3) {
    // مهلة: خادم التخزين المتوقف كان يعلّق الطلب دقيقتين (مهلة اتصال TCP) فتنتهي الدالة كلها بخطأ
    const res = await s3.fetch(objectUrl(key), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`S3 GET ${key} → ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const { data, error } = await admin.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Storage GET ${key}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (s3) {
    const res = await s3.fetch(objectUrl(key), { method: 'PUT', body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`S3 PUT ${key} → ${res.status}`);
    return;
  }
  await ensureBucket();
  const { error } = await admin.storage.from(BUCKET).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage PUT ${key}: ${error.message}`);
}

export async function deleteObject(key: string): Promise<void> {
  if (s3) {
    await s3.fetch(objectUrl(key), { method: 'DELETE', signal: AbortSignal.timeout(8_000) });
    return;
  }
  await admin.storage.from(BUCKET).remove([key]);
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
