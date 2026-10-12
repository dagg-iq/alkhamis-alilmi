import AsyncStorage from '@react-native-async-storage/async-storage';
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
const DOWNLOAD_CHANNEL = 'downloads';
const DOWNLOAD_ID = 'saey-update-download';

/** إشعار تقدم تحميل التحديث (يُحدَّث في مكانه، وصامت). done = اكتمل أو فشل ← يصدر تنبيه مرة واحدة */
export async function notifyDownload(title: string, body: string, done: boolean) {
  const N = notifications();
  if (!N || Platform.OS !== 'android') return;
  try {
    const { status } = await N.getPermissionsAsync();
    if (status !== 'granted') return;
    // إعدادات القناة لا تتغير بعد إنشائها: قناة هادئة للتقدم وأخرى للنتيجة
    const channel = done ? `${DOWNLOAD_CHANNEL}-done` : DOWNLOAD_CHANNEL;
    await N.setNotificationChannelAsync(channel, { name: done ? 'نتيجة تحميل التحديث' : 'تحميل التحديثات', importance: done ? N.AndroidImportance.HIGH : N.AndroidImportance.LOW, showBadge: false });
    await N.scheduleNotificationAsync({
      identifier: DOWNLOAD_ID,
      content: { title, body, sticky: !done, autoDismiss: done, data: { url: '/about' }, priority: done ? N.AndroidNotificationPriority.HIGH : N.AndroidNotificationPriority.LOW },
      trigger: { channelId: channel },
    });
  } catch { /* الإشعار تحسين فقط */ }
}
const TIMER_SOUND = 'saey_alarm.wav';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'not-configured' | 'error' | 'disabled';

// رمز هذا الجهاز (لحذفه وحده عند الخروج) وإيقاف الطالب للإشعارات على هذا الجهاز
const TOKEN_KEY = 'saey.push.token';
const OFF_KEY = 'saey.push.off';

/** هل أوقف الطالب الإشعارات من الإعدادات على هذا الجهاز؟ (التسجيل التلقائي عند فتح التطبيق يحترمه) */
export async function pushDisabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(OFF_KEY).catch(() => null)) === '1';
}

/**
 * يطلب الإذن ويسجل رمز الجهاز في قاعدة البيانات.
 * بلا حساب Expo: نستخدم رمز Firebase المباشر (يحتاج google-services.json داخل ملف APK).
 * auto = التسجيل التلقائي عند فتح التطبيق: لا يعمل إن أوقف الطالب الإشعارات بنفسه.
 */
export async function registerPush(userId: string, opts: { auto?: boolean } = {}): Promise<PushResult> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'unsupported';
  if (opts.auto && await pushDisabled()) return 'disabled';
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
    if (error) return 'error';
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
    if (!opts.auto) await AsyncStorage.removeItem(OFF_KEY).catch(() => {});
    return 'ok';
  } catch {
    return 'error';
  }
}

/** هل هذا الجهاز مسجل لاستقبال الإشعارات؟ (هذا الجهاز تحديداً لا أي جهاز للطالب) */
export async function pushRegistered(userId: string): Promise<boolean> {
  if (await pushDisabled()) return false;
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  let q = supabase.from('push_tokens').select('token', { count: 'exact', head: true }).eq('user_id', userId);
  if (token) q = q.eq('token', token);
  const { count } = await q;
  return (count ?? 0) > 0;
}

/**
 * يحذف رمز هذا الجهاز فقط (أجهزة الطالب الأخرى تبقى تستقبل).
 * disable = الطالب أوقف الإشعارات بنفسه فلا يعيدها التسجيل التلقائي. يُستدعى قبل الخروج والجلسة ما زالت صالحة.
 */
export async function unregisterPush(userId: string, opts: { disable?: boolean } = {}) {
  if (opts.disable) await AsyncStorage.setItem(OFF_KEY, '1').catch(() => {});
  let token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  const N = notifications();
  if (!token && N) {
    // نسخة قديمة لم تحفظ الرمز: نقرؤه من النظام (لا يطلب إذناً)
    try {
      if ((await N.getPermissionsAsync()).status === 'granted') token = String((await N.getDevicePushTokenAsync()).data);
    } catch { /* لا رمز */ }
  }
  if (token) await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
}

/** عند تسجيل الخروج: الحساب التالي على الهاتف يبدأ بالإشعارات مفعّلة */
export async function resetPushPrefs() {
  await AsyncStorage.multiRemove([TOKEN_KEY, OFF_KEY]).catch(() => {});
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

type Response = import('expo-notifications').NotificationResponse;
// الإشعار الواحد لا يُفتح مرتين (المستمع ورد الإقلاع قد يصلان معاً)
let lastHandled = '';
function dataOf(res: Response): Record<string, string> | null {
  const id = `${res.notification.request.identifier}|${res.notification.date}|${res.actionIdentifier}`;
  if (id === lastHandled) return null;
  lastHandled = id;
  // إشعارات Firebase المباشرة تحمل البيانات في الرسالة البعيدة
  const req = res.notification.request;
  const remote = (req.trigger as { remoteMessage?: { data?: Record<string, string> } } | null)?.remoteMessage?.data;
  const d = (req.content.data && Object.keys(req.content.data).length ? req.content.data : remote) as Record<string, string> | undefined;
  return d ?? null;
}

/** عند الضغط على إشعار والتطبيق مفتوح أو في الخلفية — يعيد دالة لإلغاء الاستماع */
export function onNotificationTap(cb: (data: Record<string, string>) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener((res) => {
    const d = dataOf(res);
    if (d) cb(d);
  });
  return () => sub.remove();
}

/** الإشعار الذي فتح التطبيق وهو مغلق تماماً (المستمع لا يصله): يُعالج مرة واحدة بعد جاهزية الدخول */
export async function initialNotificationTap(cb: (data: Record<string, string>) => void): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    const res = typeof N.getLastNotificationResponse === 'function' ? N.getLastNotificationResponse() : await N.getLastNotificationResponseAsync();
    if (!res) return;
    const d = dataOf(res);
    if (typeof N.clearLastNotificationResponse === 'function') N.clearLastNotificationResponse();
    else await N.clearLastNotificationResponseAsync().catch(() => {});
    if (d) cb(d);
  } catch { /* لا شيء */ }
}

/** الشاشة المناسبة لبيانات إشعار (الدردشة، الخبر، الأسئلة، المنظِّم…) */
export function notificationRoute(d: Record<string, string>): string {
  if (d.conversation_id) return `/chat/${d.conversation_id}`;
  if (d.post_id) return `/news/${d.post_id}`;
  if (d.question_set_id) return `/questions/${d.question_set_id}`;
  if (d.task_id) return '/planner';
  if (d.url === '/timer' || d.url === '/about') return d.url;
  return '/notifications';
}
