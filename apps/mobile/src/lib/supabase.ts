import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { isOffline, makeOfflineFetch, onOffline } from './offline';

// القيم العامة لمشروع سعي (آمنة: المفتاح anon محمي بـ RLS). يمكن تغييرها عبر ملف .env
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yjxhprmtyuqnbgraocar.supabase.co';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeGhwcm10eXVxbmJncmFvY2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjUwMzUsImV4cCI6MjEwNjgwMTAzNX0.uKov_hUtVxVSv7-8DNN9ycwRNHN4egtfMmrNTeU7vMk';

export const isConfigured = Boolean(url && anonKey);

/** مفتاح تخزين جلسة الدخول (supabase-js): نقرأه مباشرة لفتح التطبيق بلا إنترنت */
export const sessionStorageKey = `sb-${new URL(url || 'https://placeholder.supabase.co').hostname.split('.')[0]}-auth-token`;

/** رمز الدخول المخزن على الهاتف كما هو (حتى لو انتهى) */
async function storedToken(): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionStorageKey);
    const s = raw ? JSON.parse(raw) : null;
    return s?.access_token ? { token: s.access_token as string, expiresAt: Number(s.expires_at ?? 0) * 1000 } : null;
  } catch {
    return null;
  }
}

/**
 * رمز الدخول لكل طلب بلا انتظار:
 * supabase-js يجدد الرمز المنتهي (كل ساعة) قبل أي طلب، وبلا إنترنت يعيد المحاولة ~٢٥ ثانية قبل أن يستسلم —
 * فكانت كل شاشة تتجمد ٢٥ ثانية قبل أن تعرض المحفوظ. الآن: بلا إنترنت نستعمل الرمز المخزن فوراً
 * (الطلب يفشل سريعاً فيظهر المحفوظ) والتجديد يجري بالخلفية، ومع إنترنت ضعيف ننتظر التجديد ٤ ثوانٍ كحد أقصى.
 */
let lastKick = 0;
async function fastToken(slow: () => Promise<string | null>): Promise<string | null> {
  const stored = await storedToken();
  if (!stored) return slow();
  // رمز صالح لدقيقة على الأقل ولا انقطاع: المسار العادي (سريع)
  if (!isOffline() && stored.expiresAt > Date.now() + 60_000) {
    return Promise.race([slow(), new Promise<string>((r) => setTimeout(() => r(stored.token), 4000))]);
  }
  if (isOffline()) {
    if (Date.now() - lastKick > 20_000) { lastKick = Date.now(); slow().catch(() => {}); }
    return stored.token;
  }
  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; clearTimeout(t); off(); resolve(v); };
    const t = setTimeout(() => finish(stored.token), 4000);
    const off = onOffline(() => finish(stored.token));
    slow().then(finish, () => finish(stored.token));
  });
}

// كل طلبات قاعدة البيانات والتخزين والدوال تأخذ رمزها من هنا (يجب أن يُضبط قبل إنشاء العميل)
const proto = SupabaseClient.prototype as unknown as { _getSessionToken: () => Promise<string | null> };
const originalToken = proto._getSessionToken;
if (typeof originalToken === 'function') {
  proto._getSessionToken = function patched(this: unknown) {
    return fastToken(() => originalToken.call(this));
  };
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  // قراءات تعمل بلا إنترنت: تُحفظ وتُعاد عند انقطاع الاتصال
  global: { fetch: makeOfflineFetch(anonKey || 'placeholder', url || 'https://placeholder.supabase.co') },
});

// تجديد الجلسة فقط والتطبيق ظاهر
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** يرمي الخطأ بدلاً من إرجاعه — لتبسيط الشاشات */
export async function must<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

/** يستدعي دالة خادم ويعيد رسالة الخطأ العربية القادمة منها */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = 'تعذّر الاتصال بالخادم. تأكد من الإنترنت.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      let serverMessage: string | null = null;
      try {
        const payload = await ctx.json();
        if (typeof payload?.error === 'string') serverMessage = payload.error;
      } catch {
        // نُبقي الرسالة العامة
      }
      // رسالة الدالة نفسها أولاً (مثل «المحادثة غير موجودة» وهي ٤٠٤ أيضاً)؛
      // ٤٠٤ بلا رسالة منها = الدالة غير مرفوعة على الخادم بعد
      if (serverMessage) message = serverMessage;
      else if (ctx.status === 404) message = 'هذه الميزة لم تُفعّل على الخادم بعد. أخبر الأدمن.';
    }
    throw new Error(message);
  }
  return data as T;
}
