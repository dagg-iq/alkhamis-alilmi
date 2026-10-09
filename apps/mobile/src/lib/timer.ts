import AsyncStorage from '@react-native-async-storage/async-storage';
import { savePref } from './prefs';

/**
 * حالة المؤقت محفوظة على الهاتف: لو أُغلق التطبيق أو قتله النظام يبقى الوقت صحيحاً،
 * لأننا نحفظ «وقت الانتهاء» لا «الثواني المتبقية». الرنين نفسه إشعار مجدول بمنبّه دقيق.
 */
export type TimerMode = 'focus' | 'short' | 'long';

export type TimerSettings = {
  focus: number; // بالدقائق
  short: number;
  long: number;
  longEvery: number; // استراحة طويلة بعد كم جلسة تركيز
  autoNext: boolean; // تبدأ الجلسة التالية تلقائياً
  dailyGoal: number; // دقائق دراسة يومياً
};

export type TimerState = {
  mode: TimerMode;
  endsAt: number | null; // يعمل الآن إن وُجد
  left: number; // الثواني المتبقية عند الإيقاف المؤقت
  total: number; // طول الجلسة الحالية بالثواني
  subjectId: string | null;
  done: number; // جلسات التركيز المكتملة في الدورة الحالية
  notifId: string | null;
};

export const DEFAULT_SETTINGS: TimerSettings = { focus: 25, short: 5, long: 15, longEvery: 4, autoNext: false, dailyGoal: 120 };

const SKEY = 'saey.timer.settings';
const KEY = 'saey.timer.state';

export function freshState(s: TimerSettings, mode: TimerMode = 'focus', keep?: Partial<TimerState>): TimerState {
  const total = s[mode] * 60;
  return { mode, endsAt: null, left: total, total, subjectId: null, done: 0, notifId: null, ...keep };
}

export async function loadTimer(): Promise<{ settings: TimerSettings; state: TimerState }> {
  let settings = DEFAULT_SETTINGS;
  let state: TimerState | null = null;
  try {
    const [a, b] = await Promise.all([AsyncStorage.getItem(SKEY), AsyncStorage.getItem(KEY)]);
    if (a) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(a) };
    if (b) state = JSON.parse(b) as TimerState;
  } catch {
    // نبدأ من جديد
  }
  return { settings, state: state ?? freshState(settings) };
}

export function saveTimer(state: TimerState) {
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

export function saveTimerSettings(settings: TimerSettings) {
  AsyncStorage.setItem(SKEY, JSON.stringify(settings)).catch(() => {});
  savePref('timer', settings);
}

/** الجلسة التالية بعد انتهاء الحالية */
export function nextMode(state: TimerState, s: TimerSettings): { mode: TimerMode; done: number } {
  if (state.mode !== 'focus') return { mode: 'focus', done: state.mode === 'long' ? 0 : state.done };
  const done = state.done + 1;
  return { mode: done >= s.longEvery ? 'long' : 'short', done };
}

/** أيام متتالية فيها دراسة، حتى اليوم (أو أمس إن لم يدرس اليوم بعد) */
export function streakOf(days: Set<string>, today = new Date()): number {
  const d = new Date(today);
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
