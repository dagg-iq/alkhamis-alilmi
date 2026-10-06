-- إشعارات الهاتف: عند إضافة رسالة أو إشعار، قاعدة البيانات تستدعي دالة push مباشرة (pg_net).
-- بديل عن إعداد Database Webhooks يدوياً من لوحة Supabase (لا تُنشئ الاثنين معاً وإلا يتكرر الإشعار).
-- الرابط والسر يُحفظان في جدول خاص (غير مكشوف للتطبيق) — يملؤه سير عمل GitHub تلقائياً.
-- آمن لإعادة التشغيل.

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;

create schema if not exists private;
revoke all on schema private from public;
do $$
begin
  revoke all on schema private from anon, authenticated;
exception when undefined_object then null;
end $$;

create table if not exists private.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.settings from public;

create or replace function private.push_hook() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hook_url text;
  hook_secret text;
begin
  select value into hook_url from private.settings where key = 'push_url';
  select value into hook_secret from private.settings where key = 'push_secret';
  if hook_url is null or hook_secret is null then
    return new;
  end if;
  perform net.http_post(
    url := hook_url,
    body := jsonb_build_object('type', 'INSERT', 'table', tg_table_name, 'schema', tg_table_schema, 'record', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', hook_secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- الإشعار لا يمنع حفظ الرسالة أبداً
  return new;
end $$;

drop trigger if exists push_messages on public.messages;
create trigger push_messages after insert on public.messages
  for each row execute function private.push_hook();

drop trigger if exists push_notifications on public.notifications;
create trigger push_notifications after insert on public.notifications
  for each row execute function private.push_hook();
