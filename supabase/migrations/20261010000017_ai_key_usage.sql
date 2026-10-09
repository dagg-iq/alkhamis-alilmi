-- 17: متابعة حصص Gemini لكل مفتاح ولكل نموذج (Google: ٢٠ طلباً يومياً و٥ في الدقيقة لكل نموذج في كل مشروع)
-- اليوم يبدأ ٣ فجراً بتوقيت بغداد = منتصف الليل UTC (التاريخ بتوقيت UTC). آمن لإعادة التشغيل.

-- عدّاد يومي: كم طلباً نجح وكم فشل لكل (مفتاح، نموذج)
create table if not exists public.ai_key_usage (
  day date not null,
  slot text not null,          -- اسم السر (GEMINI_API_KEY_2 …) — لا نحفظ المفتاح نفسه أبداً
  model text not null,
  requests int not null default 0,
  errors int not null default 0,
  last_status int,
  last_error text,
  last_at timestamptz,
  primary key (day, slot, model)
);

-- النماذج المقفلة مؤقتاً (انتهت حصتها اليومية أو الدقيقة، أو مشغولة، أو المفتاح مرفوض: model = '*')
create table if not exists public.ai_key_blocks (
  slot text not null,
  model text not null,
  blocked_until timestamptz not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (slot, model)
);

alter table public.ai_key_usage enable row level security;
alter table public.ai_key_blocks enable row level security;
drop policy if exists "admin read key usage" on public.ai_key_usage;
create policy "admin read key usage" on public.ai_key_usage for select to authenticated using (public.is_admin());
drop policy if exists "admin read key blocks" on public.ai_key_blocks;
create policy "admin read key blocks" on public.ai_key_blocks for select to authenticated using (public.is_admin());
grant select on public.ai_key_usage, public.ai_key_blocks to authenticated;

-- تسجيل استدعاء (من دوال الخادم فقط)
create or replace function public.ai_log_call(p_slot text, p_model text, p_ok boolean, p_status int default null, p_error text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_key_usage (day, slot, model, requests, errors, last_status, last_error, last_at)
  values ((now() at time zone 'utc')::date, p_slot, p_model, case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end,
          p_status, case when p_ok then null else left(p_error, 300) end, now())
  on conflict (day, slot, model) do update set
    requests = public.ai_key_usage.requests + case when p_ok then 1 else 0 end,
    errors = public.ai_key_usage.errors + case when p_ok then 0 else 1 end,
    last_status = coalesce(p_status, public.ai_key_usage.last_status),
    last_error = case when p_ok then public.ai_key_usage.last_error else left(p_error, 300) end,
    last_at = now();
$$;
revoke execute on function public.ai_log_call(text, text, boolean, int, text) from public, anon, authenticated;

-- تنظيف: العدادات أقدم من ٦٠ يوماً والأقفال المنتهية
delete from public.ai_key_usage where day < (now() at time zone 'utc')::date - 60;
delete from public.ai_key_blocks where blocked_until < now() - interval '1 day';
