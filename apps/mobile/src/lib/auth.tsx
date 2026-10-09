import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@saey/shared';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearLocalPrefs, flushPrefs, hydratePrefs } from './prefs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearOfflineCache, setCacheUser } from './offline';
import { sessionStorageKey, supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

interface AuthValue {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  isStaff: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export const authRedirectUrl = () => Linking.createURL('auth-callback');

// رمز الدخول يصل من طريقين معاً (نافذة الدخول + رابط العودة auth-callback): نستبدله مرة واحدة فقط،
// وإلا نجح أحدهما وفشل الآخر فتظهر «تعذّر الدخول» رغم أن الدخول تم
const exchanges = new Map<string, Promise<void>>();
export function exchangeCode(code: string): Promise<void> {
  let p = exchanges.get(code);
  if (!p) {
    p = (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error(error.message);
      }
    })();
    exchanges.set(code, p);
  }
  return p;
}

/** يستخرج code من رابط العودة ويحوله إلى جلسة */
export async function completeAuthFromUrl(url: string): Promise<boolean> {
  const parsed = Linking.parse(url);
  const code = parsed.queryParams?.code;
  if (typeof code === 'string') {
    await exchangeCode(code);
    return true;
  }
  const errorDesc = parsed.queryParams?.error_description;
  if (typeof errorDesc === 'string') throw new Error(errorDesc);
  return false;
}

/** الجلسة المخزنة على الهاتف (حتى لو انتهت صلاحيتها) — لفتح التطبيق بلا إنترنت */
async function storedSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionStorageKey);
    const s = raw ? JSON.parse(raw) : null;
    return s?.user?.id && s.refresh_token ? (s as Session) : null;
  } catch {
    return null;
  }
}

const LAST_USER = 'saey.lastUser';

/** بيانات الحساب السابق على هذا الهاتف (المحفوظ بلا إنترنت، الهدف والمظهر، الويدجت) لا تنتقل لحساب آخر */
async function clearDeviceData() {
  await clearLocalPrefs().catch(() => {});
  await clearOfflineCache().catch(() => {});
  import('@/widgets/sync').then((m) => m.clearWidgets()).catch(() => {});
}

/** دخول حساب غير الحساب السابق (مثلاً بعد خروج بانتهاء الجلسة): نمسح بيانات السابق قبل أي شيء */
async function switchDeviceUser(userId: string) {
  const last = await AsyncStorage.getItem(LAST_USER).catch(() => null);
  if (last && last !== userId) await clearDeviceData();
  if (last !== userId) await AsyncStorage.setItem(LAST_USER, userId).catch(() => {});
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // فتحنا بجلسة قديمة لأن الإنترنت غير متاح: نحاول تجديدها كلما عاد الاتصال
  const [stale, setStale] = useState(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setCacheUser(userId);
    await switchDeviceUser(userId);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      // الهدف والمظهر وإعدادات المؤقت من حسابه، قبل أن تظهر الشاشات
      if (data) await hydratePrefs(userId, (data as Profile).prefs).catch(() => {});
      setProfile((data as Profile | null) ?? null);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    // لا نعلق أبداً على شاشة البداية: مهلة ٨ ثوانٍ كحد أقصى
    const timeout = setTimeout(() => setReady(true), 8000);
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        let current = data.session;
        if (!current) {
          // بلا إنترنت تعذّر تجديد الجلسة المنتهية: لا نرمي الطالب لشاشة الدخول، نفتح بما هو محفوظ
          current = await storedSession();
          if (current) { setStale(true); setCacheUser(current.user.id); }
        }
        setSession(current);
        await loadProfile(current?.user.id);
      } catch {
        // بدون إنترنت أو خطأ: نكمل كضيف ونعرض شاشة الدخول
      } finally {
        clearTimeout(timeout);
        setReady(true);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // بلا إنترنت يرسل supabase-js جلسة فارغة في البداية بعد فشل التجديد؛ نتجاهلها (نفتح بالجلسة المخزنة)
      // ولا نعتبر الخروج إلا عند SIGNED_OUT الصريح
      if (!s && event !== 'SIGNED_OUT') return;
      if (event === 'SIGNED_OUT') {
        setCacheUser(null);
        setTimeout(() => { clearDeviceData(); AsyncStorage.removeItem(LAST_USER).catch(() => {}); }, 0);
      }
      setSession(s);
      // لا نستدعي supabase داخل المستمع مباشرة (توصية supabase-js)
      setTimeout(() => loadProfile(s?.user.id), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // الجلسة القديمة: نحاول التجديد كل ١٥ ثانية، فإن عاد الإنترنت نكمل عادياً
  useEffect(() => {
    if (!stale) return;
    let alive = true;
    const t = setInterval(async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (!alive) return;
      if (data.session) {
        setStale(false);
        setSession(data.session);
        loadProfile(data.session.user.id);
      } else if (error && error.name !== 'AuthRetryableFetchError') {
        // رُفض التجديد فعلاً (انتهت الجلسة أو أُلغيت): نعود لشاشة الدخول
        setStale(false);
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        setSession(null);
        setProfile(null);
      }
    }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [stale, loadProfile]);

  // متابعة تغيّر الحالة لحظياً (مثلاً عند موافقة الأدمن)
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`profile:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => setProfile(payload.new as Profile))
      .subscribe();
    supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId).then(() => {});
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const value = useMemo<AuthValue>(() => ({
    ready,
    session,
    profile,
    isStaff: profile?.status === 'approved' && (profile.role === 'admin' || profile.role === 'moderator'),
    isAdmin: profile?.status === 'approved' && profile.role === 'admin',
    signInWithGoogle: async () => {
      const redirectTo = authRedirectUrl();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error || !data.url) throw new Error(error?.message ?? 'تعذّر بدء تسجيل الدخول');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') await completeAuthFromUrl(result.url);
    },
    signOut: async () => {
      await flushPrefs().catch(() => {});
      await supabase.auth.signOut();
      setProfile(null);
      setCacheUser(null);
      // لا تبقى بيانات الطالب ظاهرة (المحفوظ، الهدف، الويدجت)
      await clearDeviceData();
      await AsyncStorage.removeItem(LAST_USER).catch(() => {});
    },
    refreshProfile: () => loadProfile(session?.user.id),
  }), [ready, session, profile, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}

const GUEST: Profile = {
  id: '00000000-0000-0000-0000-000000000000', full_name: '', avatar_url: null, section_id: null, role: 'student',
  status: 'pending', is_verified: false, bio: null, onboarded: false, created_at: new Date(0).toISOString(), last_seen_at: null,
};

/** المستخدم الحالي. قبل تحويل بوابة الدخول قد تُعرض الشاشة لحظة بلا مستخدم، فنعيد ضيفاً بدل الانهيار. */
export function useMe(): Profile {
  const { profile } = useAuth();
  return profile ?? GUEST;
}
