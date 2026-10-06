import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

// القيم العامة لمشروع سعي (آمنة: المفتاح anon محمي بـ RLS). يمكن تغييرها عبر ملف .env
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yjxhprmtyuqnbgraocar.supabase.co';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeGhwcm10eXVxbmJncmFvY2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjUwMzUsImV4cCI6MjEwNjgwMTAzNX0.uKov_hUtVxVSv7-8DNN9ycwRNHN4egtfMmrNTeU7vMk';

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
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
      // الدالة غير مرفوعة على الخادم بعد
      if (ctx.status === 404) message = 'هذه الميزة لم تُفعّل على الخادم بعد. أخبر الأدمن.';
      try {
        const payload = await ctx.json();
        if (typeof payload?.error === 'string' && ctx.status !== 404) message = payload.error;
      } catch {
        // نُبقي الرسالة العامة
      }
    }
    throw new Error(message);
  }
  return data as T;
}
