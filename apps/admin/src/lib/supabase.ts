import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isConfigured = Boolean(url && key && !url.includes('example'));

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
