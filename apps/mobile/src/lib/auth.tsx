import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@saey/shared';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearLocalPrefs, flushPrefs, hydratePrefs } from './prefs';
import { supabase } from './supabase';

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

/** يستخرج code من رابط العودة ويحوله إلى جلسة */
export async function completeAuthFromUrl(url: string): Promise<boolean> {
  const parsed = Linking.parse(url);
  const code = parsed.queryParams?.code;
  if (typeof code === 'string') {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return true;
  }
  const errorDesc = parsed.queryParams?.error_description;
  if (typeof errorDesc === 'string') throw new Error(errorDesc);
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
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
        setSession(data.session);
        await loadProfile(data.session?.user.id);
      } catch {
        // بدون إنترنت أو خطأ: نكمل كضيف ونعرض شاشة الدخول
      } finally {
        clearTimeout(timeout);
        setReady(true);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // لا نستدعي supabase داخل المستمع مباشرة (توصية supabase-js)
      setTimeout(() => loadProfile(s?.user.id), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

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
      await clearLocalPrefs();
      // لا تبقى بيانات الطالب ظاهرة على الشاشة الرئيسية
      import('@/widgets/sync').then((m) => m.clearWidgets()).catch(() => {});
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
