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
  // قناة المؤقت: نغمة منبّه سعي (٢٠ ثانية) بصوت المنبّه، واهتزاز طويل، وتظهر على شاشة القفل.
  // إعدادات القناة لا تتغير بعد إنشائها، لذلك قناة جديدة بدل القديمة التي كانت بصوت الإشعار العادي
  await N.deleteNotificationChannelAsync('timer-alarm').catch(() => {});
  await N.setNotificationChannelAsync(TIMER_CHANNEL, {
    name: 'منبّه المؤقت',
    description: 'يرنّ عند انتهاء جلسة الدراسة أو الاستراحة',
    importance: N.AndroidImportance.MAX,
    sound: TIMER_SOUND,
    enableVibrate: true,
    vibrationPattern: [0, 800, 400, 800, 400, 800, 400, 800, 400, 1200],
    lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    audioAttributes: { usage: N.AndroidAudioUsage.ALARM, contentType: N.AndroidAudioContentType.SONIFICATION },
  });
}

const TIMER_CHANNEL = 'timer-alarm-2';
const TIMER_SOUND = 'saey_alarm.wav';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'not-configured' | 'error';

/**
 * يطلب الإذن ويسجل رمز الجهاز في قاعدة البيانات.
 * بلا حساب Expo: نستخدم رمز Firebase المباشر (يحتاج google-services.json داخل ملف APK).
 */
export async function registerPush(userId: string): Promise<PushResult> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'unsupported';
  try {
    await setupChannels();
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    let token: string;
    let platform: string;
    if (projectId) {
      token = (await N.getExpoPushTokenAsync({ projectId })).data;
      platform = Platform.OS;
    } else {
      try {
        token = String((await N.getDevicePushTokenAsync()).data);
        platform = 'fcm';
      } catch {
        // لم يُضف ملف Firebase للتطبيق بعد
        return 'not-configured';
      }
    }
    const { error } = await supabase.from('push_tokens').upsert({
      user_id: userId, token, platform, updated_at: new Date().toISOString(),
    });
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

/** هل هذا الجهاز مسجل لاستقبال الإشعارات؟ */
export async function pushRegistered(userId: string): Promise<boolean> {
  const { count } = await supabase.from('push_tokens').select('token', { count: 'exact', head: true }).eq('user_id', userId);
  return (count ?? 0) > 0;
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

/** منبّه المؤقت: يرنّ في وقته بالضبط حتى لو كان التطبيق مغلقاً (منبّه دقيق من النظام) */
export async function scheduleAlarm(title: string, body: string, at: Date): Promise<string | null> {
  const N = notifications();
  if (!N || at.getTime() <= Date.now()) return null;
  try {
    await setupChannels();
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    return await N.scheduleNotificationAsync({
      content: {
        title, body, sound: TIMER_SOUND, data: { url: '/timer' },
        priority: N.AndroidNotificationPriority.MAX,
        vibrate: [0, 800, 400, 800, 400, 800, 400, 800, 400, 1200],
      },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: at, channelId: TIMER_CHANNEL },
    });
  } catch {
    return null;
  }
}

/** هل يسمح الهاتف بالإشعارات أصلاً؟ (لتنبيه الطالب أن المؤقت لن يرنّ) */
export async function notificationsAllowed(): Promise<boolean | null> {
  const N = notifications();
  if (!N) return null;
  try {
    return (await N.getPermissionsAsync()).status === 'granted';
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
    // إشعارات Firebase المباشرة تحمل البيانات في الرسالة البعيدة
    const req = res.notification.request;
    const remote = (req.trigger as { remoteMessage?: { data?: Record<string, string> } } | null)?.remoteMessage?.data;
    const d = (req.content.data && Object.keys(req.content.data).length ? req.content.data : remote) as Record<string, string> | undefined;
    if (d) cb(d);
  });
  return () => sub.remove();
}
