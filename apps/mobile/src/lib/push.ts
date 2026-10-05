import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * مكتبة الإشعارات لا تعمل داخل Expo Go على أندرويد (منذ SDK 53) ومجرد استيرادها يوقف التطبيق.
 * لذلك نحمّلها عند الحاجة فقط، ونتجاهل الإشعارات عند التجربة في Expo Go. في ملف APK تعمل طبيعياً.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let cached: typeof NotificationsModule | null | undefined;
function notifications(): typeof NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (isExpoGo || Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as typeof NotificationsModule;
    cached.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    cached = null;
  }
  return cached;
}

export async function setupChannels() {
  const N = notifications();
  if (!N || Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync('default', { name: 'الأخبار والتنبيهات', importance: N.AndroidImportance.HIGH });
  await N.setNotificationChannelAsync('chat', { name: 'الرسائل', importance: N.AndroidImportance.HIGH });
  await N.setNotificationChannelAsync('reminders', { name: 'التذكيرات', importance: N.AndroidImportance.HIGH });
}

/** يطلب الإذن ويسجل رمز الجهاز في قاعدة البيانات */
export async function registerPush(userId: string): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    if (!Device.isDevice) return false;
    await setupChannels();
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    const token = (await N.getExpoPushTokenAsync({ projectId })).data;
    await supabase.from('push_tokens').upsert({
      user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterPush(userId: string) {
  await supabase.from('push_tokens').delete().eq('user_id', userId);
}

/** تذكير محلي (للمهام والمؤقت) — يعيد معرف التذكير */
export async function scheduleReminder(title: string, body: string, at: Date): Promise<string | null> {
  const N = notifications();
  if (!N || at.getTime() <= Date.now()) return null;
  try {
    await setupChannels();
    const { status } = await N.requestPermissionsAsync();
    if (status !== 'granted') return null;
    return await N.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'reminders' },
    });
  } catch {
    return null;
  }
}

export async function cancelReminder(id: string) {
  const N = notifications();
  if (N) await N.cancelScheduledNotificationAsync(id).catch(() => {});
}

/** عند الضغط على إشعار — يعيد دالة لإلغاء الاستماع */
export function onNotificationTap(cb: (data: Record<string, string>) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener((res) => {
    const d = res.notification.request.content.data as Record<string, string> | undefined;
    if (d) cb(d);
  });
  return () => sub.remove();
}
