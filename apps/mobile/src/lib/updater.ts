import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

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

/** يحمّل ملف التحديث ثم يفتح شاشة التثبيت في أندرويد */
export async function downloadAndInstall(info: UpdateInfo): Promise<void> {
  const dest = new File(Paths.cache, `saey-${info.version}.apk`);
  const file = dest.exists && (dest.size ?? 0) > 1_000_000 ? dest : await File.downloadFileAsync(info.url, dest, { idempotent: true });
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
