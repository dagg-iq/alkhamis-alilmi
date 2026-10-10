import { DownloadTask, Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { callFunction } from './supabase';

const urlCache = new Map<string, { url: string; at: number }>();
const TTL = 5 * 3600_000;

/** روابط تحميل مؤقتة (مع ذاكرة مؤقتة) لمفاتيح R2 */
export async function signedUrls(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const hit = urlCache.get(k);
    if (hit && Date.now() - hit.at < TTL) out[k] = hit.url;
    else missing.push(k);
  }
  if (missing.length) {
    const res = await callFunction<{ urls: Record<string, string> }>('files', { action: 'download', keys: missing });
    for (const [k, url] of Object.entries(res.urls)) {
      urlCache.set(k, { url, at: Date.now() });
      out[k] = url;
    }
  }
  return out;
}

export async function signedUrl(key: string): Promise<string> {
  return (await signedUrls([key]))[key];
}

/** يرفع ملفاً محلياً إلى R2 ويعيد مفتاحه */
export async function uploadFile(
  localUri: string,
  kind: 'chat' | 'scan' | 'material' | 'cover',
  contentType: string,
  conversationId?: string,
): Promise<string> {
  const { key, url } = await callFunction<{ key: string; url: string }>('files', {
    action: 'upload', kind, contentType, conversationId,
  });
  const file = new File(localUri);
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: await file.bytes() });
  if (!res.ok) throw new Error('فشل رفع الملف، حاول مرة أخرى.');
  return key;
}

/**
 * يضغط الصورة قبل الرفع مثل فيسبوك: أطول ضلع ١٦٠٠ بكسل (تبقى النصوص مقروءة) وجودة JPEG ٧٢٪.
 * صورة كاميرا ٨ ميغا (4000×3000) تصير ~٣٠٠–٥٠٠ ك.ب. لا تُكبَّر الصورة الصغيرة أبداً.
 */
export async function compressImage(uri: string, maxSide = 1600, quality = 0.72) {
  const M = ImageManipulator.ImageManipulator;
  const src = await M.manipulate(uri).renderAsync();
  const { width, height } = src;
  const ctx = M.manipulate(uri);
  if (Math.max(width, height) > maxSide) ctx.resize(width >= height ? { width: maxSide } : { height: maxSide });
  const image = await ctx.renderAsync();
  const result = await image.saveAsync({ compress: quality, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}

// ---------------------------------------------------------------- الملازم دون إنترنت
const materialsDir = () => {
  const dir = new Directory(Paths.document, 'materials');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
};

function localFileFor(key: string): File {
  return new File(materialsDir(), key.replace(/\//g, '_'));
}

export function isDownloaded(key: string): boolean {
  try {
    return localFileFor(key).exists;
  } catch {
    return false; // نظام الملفات غير متاح (مثلاً في المتصفح)
  }
}

/** يحمّل ملزمة إلى الهاتف (تُفتح بعدها بلا إنترنت). يُكتب في ملف مؤقت ثم يُنقل، فلا يبقى ملف ناقص يُحسب محفوظاً */
// تحميل واحد لكل ملف في نفس الوقت (زرّا «تحميل» و«فتح» معاً كانا يكتبان نفس الملف المؤقت فيُحفظ ملف ناقص)
const inFlight = new Map<string, { promise: Promise<File>; listeners: Set<(r: number, t: number) => void> }>();

export async function downloadMaterial(key: string, onProgress?: (received: number, total: number) => void): Promise<File> {
  const local = localFileFor(key);
  if (local.exists) return local;
  const running = inFlight.get(key);
  if (running) {
    if (onProgress) running.listeners.add(onProgress);
    return running.promise;
  }
  const listeners = new Set<(r: number, t: number) => void>(onProgress ? [onProgress] : []);
  const promise = fetchMaterial(key, local, (r, t) => listeners.forEach((l) => l(r, t)));
  inFlight.set(key, { promise, listeners });
  try { return await promise; } finally { inFlight.delete(key); }
}

async function fetchMaterial(key: string, local: File, onProgress: (received: number, total: number) => void): Promise<File> {
  const url = await signedUrl(key);
  const part = new File(materialsDir(), `${key.replace(/\//g, '_')}.part`);
  if (part.exists) part.delete();
  try {
    await new DownloadTask(url, part, { onProgress: (p) => onProgress(p.bytesWritten, p.totalBytes) }).downloadAsync();
    if (!part.exists || (part.size ?? 0) < 100) throw new Error('الملف المحمّل ناقص');
    part.move(local);
  } catch (e) {
    try { if (part.exists) part.delete(); } catch { /* تجاهل */ }
    throw e;
  }
  return local;
}

export function removeDownload(key: string) {
  const local = localFileFor(key);
  if (local.exists) local.delete();
}

export interface OpenOptions {
  /** معرّف الملزمة (لعرض فهرسها داخل العارض) */
  docId?: string;
  /** نطاق صفحات (فصل) والصفحة التي يبدأ منها */
  from?: number;
  to?: number;
  page?: number;
}

/** يفتح PDF داخل التطبيق نفسه (ويحمّله أولاً إن لم يكن محفوظاً)، اختيارياً على فصل أو صفحة */
export async function openPdf(key: string, title?: string, opts: OpenOptions = {}) {
  const file = await downloadMaterial(key);
  const params: Record<string, string> = { uri: file.uri, title: title ?? 'ملف PDF' };
  if (opts.docId) params.doc = opts.docId;
  if (opts.from) params.from = String(opts.from);
  if (opts.to) params.to = String(opts.to);
  if (opts.page) params.page = String(opts.page);
  router.push({ pathname: '/pdf', params });
}

export async function sharePdf(key: string, title?: string) {
  const file = await downloadMaterial(key);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title });
}
