import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/**
 * تفضيلات الطالب محفوظة على حسابه (profiles.prefs) وليس على الهاتف فقط:
 * الهدف (نجاح/إعفاء)، المظهر، إعدادات المؤقت، مظهر الويدجتات.
 * عند تسجيل الدخول تُقرأ من الحساب وتُطبَّق محلياً، وكل تغيير يُرسَل للحساب بعد لحظة.
 * (النسخة المحلية تبقى للسرعة وللعمل بلا إنترنت.)
 */
export type PrefKey = 'goal' | 'theme' | 'timer' | 'widgetTheme';

const LOCAL: Record<PrefKey, string> = {
  goal: 'saey.goal',
  theme: 'saey.theme',
  timer: 'saey.timer.settings',
  widgetTheme: 'saey.widgets.theme',
};
const TIMER_STATE = 'saey.timer.state';

const valid: Record<PrefKey, (v: unknown) => boolean> = {
  goal: (v) => v === 'pass' || v === 'individual' || v === 'general',
  theme: (v) => v === 'light' || v === 'dark' || v === 'system',
  timer: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  widgetTheme: (v) => v === 'light' || v === 'dark' || v === 'system',
};

const encode = (k: PrefKey, v: unknown) => (k === 'timer' ? JSON.stringify(v) : String(v));
function decode(k: PrefKey, raw: string | null): unknown {
  if (raw === null) return undefined;
  if (k === 'timer') { try { return JSON.parse(raw); } catch { return undefined; } }
  return raw;
}

type Listener = (key: PrefKey, value: unknown) => void;
const listeners = new Set<Listener>();
/** الاستماع لتفضيل طُبّق من الحساب (أو مُسح عند الخروج) */
export function onPrefApplied(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const emit: Listener = (k, v) => listeners.forEach((l) => l(k, v));

let uid: string | null = null;
let remote: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

/** عند أول تحميل للملف الشخصي بعد الدخول: الحساب يغلب، وما كان محلياً فقط يُرفع للحساب */
export async function hydratePrefs(userId: string, fromServer: unknown): Promise<void> {
  if (uid === userId) return; // مرة لكل جلسة: لا نكتب فوق تغيير جديد بنسخة قديمة
  uid = userId;
  remote = fromServer && typeof fromServer === 'object' && !Array.isArray(fromServer) ? { ...(fromServer as Record<string, unknown>) } : {};
  let upload = false;
  for (const k of Object.keys(LOCAL) as PrefKey[]) {
    const fromAccount = remote[k];
    let local: unknown;
    try { local = decode(k, await AsyncStorage.getItem(LOCAL[k])); } catch { local = undefined; }
    if (fromAccount !== undefined && valid[k](fromAccount)) {
      if (encode(k, fromAccount) !== (local === undefined ? null : encode(k, local))) {
        await AsyncStorage.setItem(LOCAL[k], encode(k, fromAccount)).catch(() => {});
        emit(k, fromAccount);
      }
    } else if (local !== undefined && valid[k](local)) {
      remote[k] = local;
      upload = true;
    }
  }
  if (upload) flush();
}

function flush() {
  if (!uid) return;
  const id = uid;
  const prefs = remote;
  supabase.from('profiles').update({ prefs }).eq('id', id).then(({ error }) => {
    if (!error) { failures = 0; return; }
    // إعادة محاولة قليلة (انقطاع الإنترنت مثلاً)
    if (++failures <= 4 && uid === id) timer = setTimeout(flush, 8000 * failures);
  });
}

/** يحفظ تفضيلاً على الحساب (يُجمَّع إن تتابعت التغييرات) */
export function savePref(key: PrefKey, value: unknown) {
  if (!uid) return;
  remote = { ...remote, [key]: value };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(); }, 600);
}

/** قبل تسجيل الخروج: نرسل أي تغيير معلّق (ما زالت الجلسة صالحة) */
export async function flushPrefs(): Promise<void> {
  if (!uid || !timer) return;
  clearTimeout(timer);
  timer = null;
  await supabase.from('profiles').update({ prefs: remote }).eq('id', uid);
}

/** عند الخروج: لا يرث الحساب التالي على نفس الهاتف تفضيلات الحساب السابق */
export async function clearLocalPrefs(): Promise<void> {
  if (timer) clearTimeout(timer);
  uid = null;
  remote = {};
  await Promise.all([...Object.values(LOCAL), TIMER_STATE].map((k) => AsyncStorage.removeItem(k).catch(() => {})));
  for (const k of Object.keys(LOCAL) as PrefKey[]) emit(k, null);
}
