import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
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

/** يضغط الصورة قبل الرفع (أقصى عرض ١٦٠٠ وجودة ٧٠٪) */
export async function compressImage(uri: string, maxWidth = 1600, quality = 0.7) {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  ctx.resize({ width: maxWidth });
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

export async function downloadMaterial(key: string): Promise<File> {
  const local = localFileFor(key);
  if (local.exists) return local;
  const url = await signedUrl(key);
  return File.downloadFileAsync(url, local);
}

export function removeDownload(key: string) {
  const local = localFileFor(key);
  if (local.exists) local.delete();
}

/** يفتح PDF بقارئ الهاتف (ويحمّله أولاً إن لم يكن محفوظاً) */
export async function openPdf(key: string) {
  const file = await downloadMaterial(key);
  if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/pdf',
    });
  } else {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

export async function sharePdf(key: string, title?: string) {
  const file = await downloadMaterial(key);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title });
}
