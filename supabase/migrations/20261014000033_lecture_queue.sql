-- 33: طابور فهرسة المحاضرات على الخادم — مثل طابور الكتب (٢٠): يعمل ولو أُغلق الموقع.
-- المحاضرة المنتظرة: queued_at ليس فارغاً. العامل (lecture-worker) يوقظه pg_cron كل دقيقة،
-- يفهرس جزءاً (١٠ دقائق) من كل محاضرة في كل مرة بنماذج Flash-Lite، ويحفظ رقم الجزء التالي فيكمل من حيث توقف.
-- الترتيب: الفصل الأول من كل المواد أولاً ثم الثاني… (الطالب يحتاج بداية المنهج قبل نهايته). آمن لإعادة التشغيل.

alter table public.lectures add column if not exists queued_at timestamptz;
alter table public.lectures add column if not exists index_segment int not null default 0;
alter table public.lectures add column if not exists index_attempts int not null default 0;
alter table public.lectures add column if not exists index_next_at timestamptz not null default now();
alter table public.lectures add column if not exists index_lease_until timestamptz;
create index if not exists lectures_queue_idx on public.lectures (queued_at) where queued_at is not null;

-- يحجز محاضرة واحدة لجزئها التالي (لا يأخذ عاملان نفس المحاضرة: الأجزاء بالترتيب لأن كل جزء يحتاج مواضيع السابق)
create or replace function public.claim_lecture(p_lease_seconds int default 200)
returns setof public.lectures language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.lectures l set index_lease_until = now() + make_interval(secs => p_lease_seconds)
  where l.id = (
    select x.id from public.lectures x join public.chapters c on c.id = x.chapter_id
    where x.queued_at is not null and x.index_next_at <= now()
      and (x.index_lease_until is null or x.index_lease_until < now())
    order by c.number, x.queued_at, c.id, x.sort
    limit 1
    for update of x skip locked
  )
  returning l.*;
end $$;
revoke execute on function public.claim_lecture(int) from public, anon, authenticated;

create or replace function public.lecture_worker_lock(p_seconds int) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare until_ts timestamptz;
begin
  select value::timestamptz into until_ts from private.settings where key = 'lecture_lock';
  if until_ts is not null and until_ts > now() then return false; end if;
  insert into private.settings (key, value) values ('lecture_lock', (now() + make_interval(secs => p_seconds))::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;
create or replace function public.lecture_worker_unlock() returns void
language sql security definer set search_path = public, private as $$
  delete from private.settings where key = 'lecture_lock';
$$;
revoke execute on function public.lecture_worker_lock(int) from public, anon, authenticated;
revoke execute on function public.lecture_worker_unlock() from public, anon, authenticated;

-- كل دقيقة: إن كانت في الطابور محاضرة جاهزة، نوقظ العامل (نفس رابط وسر الإشعارات)
create or replace function private.lecture_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare hook_url text; hook_secret text;
begin
  if not exists (select 1 from public.lectures where queued_at is not null and index_next_at <= now()) then return; end if;
  select value into hook_url from private.settings where key = 'push_url';
  select value into hook_secret from private.settings where key = 'push_secret';
  if hook_url is null or hook_secret is null then return; end if;
  perform net.http_post(
    url := replace(hook_url, '/functions/v1/push', '/functions/v1/lecture-worker'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', hook_secret),
    timeout_milliseconds := 2000
  );
exception when others then null;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'saey-lectures';
  perform cron.schedule('saey-lectures', '* * * * *', 'select private.lecture_tick()');
exception when others then
  raise notice 'pg_cron غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;
