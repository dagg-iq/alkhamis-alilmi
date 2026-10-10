-- 20: طابور الفهرسة على الخادم — يعمل ولو أُغلق الموقع.
-- اللوحة تقطّع الكتاب إلى أجزاء صغيرة (٤–٨ صفحات) وترفعها مرة واحدة، ثم يقرؤها عامل الخادم (ingest-worker)
-- الذي يوقظه pg_cron كل دقيقة: الكتب بالترتيب، عدة مفاتيح معاً، أي خطأ يُعاد لاحقاً، وانتهاء الحصة ينتظر التجدد.
-- آمن لإعادة التشغيل.

alter table public.documents add column if not exists queued_at timestamptz;

create table if not exists public.ingest_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  from_page int not null check (from_page >= 1),
  to_page int not null,
  total_pages int not null,
  file_key text not null,
  scanned boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (to_page >= from_page)
);
create index if not exists ingest_chunks_pick_idx on public.ingest_chunks (status, next_at);
create index if not exists ingest_chunks_doc_idx on public.ingest_chunks (document_id, from_page);

alter table public.ingest_chunks enable row level security;
drop policy if exists "staff ingest chunks" on public.ingest_chunks;
create policy "staff ingest chunks" on public.ingest_chunks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.ingest_chunks to authenticated;

-- العامل يحجز أجزاءً للقراءة (لا يأخذ عاملان نفس الجزء): الكتب بترتيب دخولها الطابور ثم الصفحات بالترتيب
create or replace function public.claim_ingest_chunks(p_limit int, p_lease_seconds int default 240)
returns setof public.ingest_chunks language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.ingest_chunks c set status = 'running', lease_until = now() + make_interval(secs => p_lease_seconds), attempts = c.attempts + 1
  where c.id in (
    select x.id from public.ingest_chunks x join public.documents d on d.id = x.document_id
    where d.queued_at is not null and x.next_at <= now()
      and (x.status = 'pending' or (x.status = 'running' and x.lease_until < now()))
    order by d.queued_at, x.from_page
    limit p_limit
    for update of x skip locked
  )
  returning c.*;
end $$;
revoke execute on function public.claim_ingest_chunks(int, int) from public, anon, authenticated;

-- قفل العامل: عامل واحد فقط يعمل في الوقت نفسه (الاستدعاءات كل دقيقة لا تتراكب)
create or replace function public.ingest_worker_lock(p_seconds int) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare until_ts timestamptz;
begin
  select value::timestamptz into until_ts from private.settings where key = 'ingest_lock';
  if until_ts is not null and until_ts > now() then return false; end if;
  insert into private.settings (key, value) values ('ingest_lock', (now() + make_interval(secs => p_seconds))::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;
create or replace function public.ingest_worker_unlock() returns void
language sql security definer set search_path = public, private as $$
  delete from private.settings where key = 'ingest_lock';
$$;
revoke execute on function public.ingest_worker_lock(int) from public, anon, authenticated;
revoke execute on function public.ingest_worker_unlock() from public, anon, authenticated;

-- كل دقيقة: إن كان في الطابور عمل، نوقظ العامل (نفس رابط وسر الإشعارات)
create or replace function private.ingest_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare hook_url text; hook_secret text;
begin
  if not exists (select 1 from public.documents where queued_at is not null) then return; end if;
  select value into hook_url from private.settings where key = 'push_url';
  select value into hook_secret from private.settings where key = 'push_secret';
  if hook_url is null or hook_secret is null then return; end if;
  perform net.http_post(
    url := replace(hook_url, '/functions/v1/push', '/functions/v1/ingest-worker'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', hook_secret),
    timeout_milliseconds := 2000
  );
exception when others then null;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'saey-ingest';
  perform cron.schedule('saey-ingest', '* * * * *', 'select private.ingest_tick()');
exception when others then
  raise notice 'pg_cron غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;
