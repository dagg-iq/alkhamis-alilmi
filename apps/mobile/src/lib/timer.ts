import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { hideLiveTimer } from './live-timer';
import { savePref } from './prefs';
import { supabase } from './supabase';

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

// ───────────── تسجيل دقائق الدراسة: مرة واحدة لكل جلسة، ولا تضيع بلا إنترنت ─────────────
const RECORDED = 'saey.timer.recorded'; // وقت انتهاء آخر جلسة تركيز سُجّلت (حتى لا تُسجَّل مرتين)
const QUEUE = 'saey.timer.queue'; // جلسات فشل حفظها (انقطاع الإنترنت) تُعاد لاحقاً

interface PendingSession { minutes: number; subject_id: string | null; started_at: string }

// العمليات على التخزين المحلي بالتتابع (شاشة المؤقت والتسوية العامة قد تعملان معاً)
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

/** يحجز جلسة منتهية للتسجيل: true مرة واحدة فقط لكل وقت انتهاء */
export function claimFinished(endsAt: number): Promise<boolean> {
  return serial(async () => {
    const last = Number(await AsyncStorage.getItem(RECORDED).catch(() => null));
    if (last === endsAt) return false;
    await AsyncStorage.setItem(RECORDED, String(endsAt)).catch(() => {});
    return true;
  });
}

async function readQueue(): Promise<PendingSession[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? '[]') as PendingSession[]; } catch { return []; }
}

/** يحفظ جلسة دراسة؛ إن فشل الحفظ تبقى في طابور محلي وتُرسل عند عودة الإنترنت */
export async function recordStudy(userId: string, minutes: number, subjectId: string | null, endedAt = Date.now()): Promise<boolean> {
  const m = Math.min(600, Math.round(minutes));
  if (m < 1 || !userId) return false;
  const row: PendingSession = { minutes: m, subject_id: subjectId, started_at: new Date(endedAt - m * 60000).toISOString() };
  const { error } = await supabase.from('study_sessions').insert({ user_id: userId, ...row });
  if (!error) return true;
  await serial(async () => {
    const q = await readQueue();
    q.push(row);
    await AsyncStorage.setItem(QUEUE, JSON.stringify(q.slice(-50))).catch(() => {});
  });
  return false;
}

/** يعيد إرسال الجلسات التي فشل حفظها */
export function flushStudyQueue(userId: string): Promise<void> {
  return serial(async () => {
    const q = await readQueue();
    if (!q.length) return;
    const left: PendingSession[] = [];
    for (const row of q) {
      const { error } = await supabase.from('study_sessions').insert({ user_id: userId, ...row });
      if (error) left.push(row);
    }
    await AsyncStorage.setItem(QUEUE, JSON.stringify(left)).catch(() => {});
  });
}

// شاشة المؤقت مفتوحة: هي تتولى انتهاء الجلسة (وقد تبدأ التالية تلقائياً)، فلا تتدخل التسوية العامة
let screenActive = false;
export const setTimerScreenActive = (v: boolean) => { screenActive = v; };

/** جلسة انتهت والتطبيق مغلق أو في شاشة أخرى: نسجّل دقائق التركيز وننتقل للجلسة التالية (متوقفة) */
export async function settleFinishedTimer(userId: string): Promise<void> {
  if (screenActive) return;
  const { settings, state } = await loadTimer();
  if (!state.endsAt || state.endsAt > Date.now() || screenActive) return;
  if (state.mode === 'focus' && await claimFinished(state.endsAt)) {
    await recordStudy(userId, state.total / 60, state.subjectId, state.endsAt);
  }
  if (screenActive) return;
  const { mode, done } = nextMode(state, settings);
  saveTimer(freshState(settings, mode, { subjectId: state.subjectId, done }));
  hideLiveTimer(); // العدّاد في الستارة انتهى
}

/** عند فتح التطبيق وعودته من الخلفية: تسوية المؤقت وإرسال ما لم يُحفظ */
export function useTimerSettle(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    const run = () => { settleFinishedTimer(userId).catch(() => {}); flushStudyQueue(userId).catch(() => {}); };
    run();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run(); });
    return () => sub.remove();
  }, [userId]);
}
