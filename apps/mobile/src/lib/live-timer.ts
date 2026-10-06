import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** وحدة أصلية صغيرة في modules/saey-timer (أندرويد فقط) */
type SaeyTimer = { show(title: string, body: string, endsAt: number, color: string): void; cancel(): void };
const native = Platform.OS === 'android' ? requireOptionalNativeModule<SaeyTimer>('SaeyTimer') : null;

/** إشعار ثابت فيه العد التنازلي أثناء الجلسة */
export function showLiveTimer(title: string, body: string, endsAt: number, color = '#2346F5') {
  try {
    native?.show(title, body, endsAt, color);
  } catch {
    // غير متاح (ويب أو Expo Go)
  }
}

export function hideLiveTimer() {
  try {
    native?.cancel();
  } catch {
    // غير متاح
  }
}
