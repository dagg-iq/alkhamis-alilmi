-- 34: حارس خادم التخزين (storage-watchdog): كل ٥ دقائق يفحص سيرفر S3، وإن توقف يشغّله عبر واجهة Oracle.
-- السجل للمشرفين فقط، ويُحذف ما مضى عليه أكثر من ٧ أيام. آمن لإعادة التشغيل.

create table if not exists public.storage_watchdog_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  up boolean not null,
  state text,
  action text,
  detail text
);
create index if not exists storage_watchdog_log_at_idx on public.storage_watchdog_log (at desc);
alter table public.storage_watchdog_log enable row level security;
drop policy if exists "staff read watchdog" on public.storage_watchdog_log;
create policy "staff read watchdog" on public.storage_watchdog_log for select to authenticated using (public.is_staff());

create or replace function private.storage_watchdog_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare hook_url text; hook_secret text;
begin
  delete from public.storage_watchdog_log where at < now() - interval '7 days';
  select value into hook_url from private.settings where key = 'push_url';
  select value into hook_secret from private.settings where key = 'push_secret';
  if hook_url is null or hook_secret is null then return; end if;
  perform net.http_post(
    url := replace(hook_url, '/functions/v1/push', '/functions/v1/storage-watchdog'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', hook_secret),
    timeout_milliseconds := 30000
  );
exception when others then null;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'saey-storage-watchdog';
  perform cron.schedule('saey-storage-watchdog', '*/5 * * * *', 'select private.storage_watchdog_tick()');
exception when others then
  raise notice 'pg_cron غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;
