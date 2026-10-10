-- 21: يوم عدّاد مفاتيح Gemini = يوم Google نفسه (تاريخ كاليفورنيا)، لأن الحصة اليومية تتجدد منتصف ليل كاليفورنيا
-- (١٠:٠٠ صباحاً بغداد صيفاً، ١١:٠٠ شتاءً) لا منتصف ليل UTC. آمن لإعادة التشغيل.
create or replace function public.ai_log_call(p_slot text, p_model text, p_ok boolean, p_status int default null, p_error text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_key_usage (day, slot, model, requests, errors, last_status, last_error, last_at)
  values ((now() at time zone 'America/Los_Angeles')::date, p_slot, p_model, case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end,
          p_status, case when p_ok then null else left(p_error, 300) end, now())
  on conflict (day, slot, model) do update set
    requests = public.ai_key_usage.requests + case when p_ok then 1 else 0 end,
    errors = public.ai_key_usage.errors + case when p_ok then 0 else 1 end,
    last_status = coalesce(p_status, public.ai_key_usage.last_status),
    last_error = case when p_ok then public.ai_key_usage.last_error else left(p_error, 300) end,
    last_at = now();
$$;
revoke execute on function public.ai_log_call(text, text, boolean, int, text) from public, anon, authenticated;
