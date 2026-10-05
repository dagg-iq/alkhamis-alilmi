import { createClient } from '@supabase/supabase-js';

// القيم العامة لمشروع سعي (آمنة: المفتاح anon محمي بـ RLS). يمكن تغييرها عبر متغيرات البيئة
const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const url = envUrl && !envUrl.includes('example') ? envUrl : 'https://yjxhprmtyuqnbgraocar.supabase.co';
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeGhwcm10eXVxbmJncmFvY2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjUwMzUsImV4cCI6MjEwNjgwMTAzNX0.uKov_hUtVxVSv7-8DNN9ycwRNHN4egtfMmrNTeU7vMk';
export const isConfigured = Boolean(url && key);

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true },
});

export async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const p = await ctx.json();
        if (p?.error) message = p.error;
      } catch { /* الرسالة العامة */ }
    }
    throw new Error(message);
  }
  return data as T;
}

/** يرفع ملفاً إلى R2 عبر رابط موقّع، مع تقدّم الرفع */
export async function uploadToR2(file: File, kind: 'material' | 'cover' | 'scan', onProgress?: (p: number) => void): Promise<string> {
  const { key, url: putUrl } = await callFunction<{ key: string; url: string }>('files', { action: 'upload', kind, contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', putUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`فشل الرفع (${xhr.status}) — تأكد من إعداد CORS في R2`)));
    xhr.onerror = () => reject(new Error('فشل الرفع — تأكد من إعداد CORS في R2'));
    xhr.send(file);
  });
  return key;
}

export async function signedUrl(key: string): Promise<string> {
  const res = await callFunction<{ url: string }>('files', { action: 'download', key });
  return res.url;
}
