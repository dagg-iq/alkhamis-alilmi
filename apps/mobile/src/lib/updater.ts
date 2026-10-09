import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { DownloadTask, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { notifyDownload } from './push';

/**
 * التحديث من داخل التطبيق: الموقع ينشر رقم آخر نسخة ورابطها (download.json)،
 * والتطبيق يقارنه برقم نسخته. التحديث يُثبَّت فوق النسخة الحالية (نفس التوقيع) فلا تُحذف بيانات الطالب.
 */
const SITE = 'https://saeyiq.web.app/download.json';
const SKIP_KEY = 'saey.update.skip';

export interface UpdateInfo { version: number; url: string; sizeMb: number | null }

export const currentBuild: number = Number(Constants.expoConfig?.extra?.buildNumber) || 0;

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (Platform.OS !== 'android' || !currentBuild) return null;
  const res = await fetch(SITE, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) return null;
  const d = await res.json() as { url?: string; version?: string; size_mb?: string };
  const version = Number(d.version);
  if (!d.url || !version || version <= currentBuild) return null;
  if (!force) {
    // «لاحقاً»: لا نزعجه بنفس النسخة قبل يوم
    const skip = await AsyncStorage.getItem(SKIP_KEY).catch(() => null);
    if (skip) {
      const [v, at] = skip.split(':').map(Number);
      if (v === version && Date.now() - at < 86400000) return null;
    }
  }
  return { version, url: d.url, sizeMb: Number(d.size_mb) || null };
}

export function skipUpdate(version: number) {
  AsyncStorage.setItem(SKIP_KEY, `${version}:${Date.now()}`).catch(() => {});
}

// ───────────────── التحميل: حالة عامة تبقى حتى لو أُغلقت النافذة أو انتقل الطالب لشاشة أخرى ─────────────────
export interface DownloadState {
  status: 'idle' | 'downloading' | 'ready' | 'error';
  version: number;
  received: number;
  total: number;
  error?: string;
}

let state: DownloadState = { status: 'idle', version: 0, received: 0, total: 0 };
const listeners = new Set<() => void>();
let task: DownloadTask | null = null;

function setState(next: Partial<DownloadState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useDownload(): DownloadState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

const apkFile = (version: number) => new File(Paths.cache, `saey-${version}.apk`);
// يُحمَّل إلى ملف مؤقت ثم يُنقل عند الاكتمال، فلا يُعدّ تحميل انقطع (أُغلق التطبيق) ملفاً جاهزاً
const partFile = (version: number) => new File(Paths.cache, `saey-${version}.apk.part`);
let cancelled = false;

/** يبدأ التحميل (أو يكمل إن كان جارياً). التقدم يظهر في النافذة وفي إشعار، ويستمر والتطبيق مصغّر ما دام النظام يبقيه حياً */
export async function startDownload(info: UpdateInfo): Promise<void> {
  if (state.status === 'downloading') return;
  const dest = apkFile(info.version);
  if (dest.exists && (dest.size ?? 0) > 1_000_000 && state.status !== 'error') {
    setState({ status: 'ready', version: info.version, received: dest.size ?? 0, total: dest.size ?? 0, error: undefined });
    return;
  }
  if (dest.exists) dest.delete();
  const part = partFile(info.version);
  if (part.exists) part.delete();
  cancelled = false;
  setState({ status: 'downloading', version: info.version, received: 0, total: info.sizeMb ? info.sizeMb * 1048576 : 0, error: undefined });
  let lastNotify = 0;
  try {
    task = new DownloadTask(info.url, part, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        setState({ received: bytesWritten, total: totalBytes > 0 ? totalBytes : state.total });
        const now = Date.now();
        if (now - lastNotify > 1200) {
          lastNotify = now;
          notifyDownload('جارٍ تحميل تحديث سعي', progressText(bytesWritten, totalBytes > 0 ? totalBytes : state.total), false);
        }
      },
    });
    await task.downloadAsync();
    task = null;
    if (cancelled) return;
    const expected = state.total;
    if (!part.exists || (part.size ?? 0) < 1_000_000 || (expected > 0 && (part.size ?? 0) < expected * 0.9)) throw new Error('الملف المحمّل ناقص');
    part.move(dest);
    setState({ status: 'ready', received: dest.size ?? 0, total: dest.size ?? 0 });
    notifyDownload('اكتمل تحميل تحديث سعي', 'اضغط هنا للتثبيت', true);
  } catch (e) {
    task = null;
    try { if (part.exists) part.delete(); } catch { /* تجاهل */ }
    if (cancelled) return; // ألغاه الطالب: ليس خطأ
    setState({ status: 'error', error: e instanceof Error ? e.message : 'تعذّر التحميل' });
    notifyDownload('تعذّر تحميل التحديث', 'افتح سعي وأعد المحاولة', true);
  }
}

export function cancelDownload() {
  cancelled = true;
  try { task?.cancel(); } catch { /* تجاهل */ }
  task = null;
  setState({ status: 'idle', received: 0, total: 0, error: undefined });
}

export function progressText(received: number, total: number): string {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  if (!total) return `${mb(received)} ميغا`;
  return `${Math.min(100, Math.round((received / total) * 100))}٪ — ${mb(received)} من ${mb(total)} ميغا`;
}

/** يفتح شاشة تثبيت أندرويد للملف المحمّل */
export async function installDownloaded(version = state.version): Promise<void> {
  const file = apkFile(version);
  if (!file.exists) throw new Error('ملف التحديث غير موجود، حمّله من جديد.');
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
