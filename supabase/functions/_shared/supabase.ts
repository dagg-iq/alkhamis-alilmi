import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './cors.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** عميل بصلاحية الخادم — يتجاوز RLS، فاستخدمه بحذر وبعد التحقق من المستخدم */
export const admin: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });

export interface Caller {
  id: string;
  role: 'student' | 'moderator' | 'admin';
  status: string;
  section_id: string | null;
  full_name: string;
  /** عميل بصلاحيات المستخدم نفسه (يخضع لـ RLS) */
  client: SupabaseClient;
}

export async function getCaller(req: Request, opts: { staff?: boolean } = {}): Promise<Caller> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new HttpError(401, 'سجّل الدخول أولاً.');
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await client.auth.getUser(auth.replace('Bearer ', ''));
  if (error || !user) throw new HttpError(401, 'انتهت الجلسة، سجّل الدخول من جديد.');
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, status, section_id, full_name')
    .eq('id', user.id)
    .single();
  if (!profile || profile.status !== 'approved') throw new HttpError(403, 'حسابك بانتظار موافقة الأدمن.');
  if (opts.staff && profile.role === 'student') throw new HttpError(403, 'هذه العملية للأدمن والمشرفين فقط.');
  return { ...profile, client } as Caller;
}

export async function getSetting<T = Record<string, unknown>>(key: string): Promise<T> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? {}) as T;
}
