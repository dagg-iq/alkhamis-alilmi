import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelReminder } from './push';

/**
 * تذكيرات المهام المحلية: نحفظ معرّف التذكير لكل مهمة حتى يُلغى عند حذفها أو إنجازها
 * (كان يرنّ تذكير مهمة محذوفة).
 */
const KEY = 'saey.task.reminders';

async function readMap(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Record<string, string>; } catch { return {}; }
}

export async function saveTaskReminder(taskId: string, notifId: string) {
  const map = await readMap();
  map[taskId] = notifId;
  await AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => {});
}

export async function cancelTaskReminder(taskId: string) {
  const map = await readMap();
  const id = map[taskId];
  if (!id) return;
  await cancelReminder(id);
  delete map[taskId];
  await AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => {});
}
