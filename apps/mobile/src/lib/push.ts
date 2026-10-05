import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'الأخبار والتنبيهات',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('chat', {
    name: 'الرسائل',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'التذكيرات',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** يطلب الإذن ويسجل رمز الجهاز في قاعدة البيانات */
export async function registerPush(userId: string): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    await setupChannels();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
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
  if (at.getTime() <= Date.now()) return null;
  await setupChannels();
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'reminders' },
  });
}

export async function cancelReminder(id: string) {
  await Notifications.cancelScheduledNotificationAsync(id);
}
