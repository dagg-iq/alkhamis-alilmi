-- 25: إعادة توجيه الرسائل (مثل تطبيقات المراسلة): علامة «مُعاد توجيهها» على الرسالة. آمن لإعادة التشغيل.
alter table public.messages add column if not exists forwarded boolean not null default false;

-- العلامة لا تُغيَّر بعد الإرسال، ولا تُعدَّل الرسالة المعاد توجيهها (كي لا تُنسب للمرسل الأصلي نص لم يكتبه)
create or replace function public.protect_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;
  new.conversation_id := old.conversation_id;
  new.sender_id := old.sender_id;
  new.created_at := old.created_at;
  new.attachment := old.attachment;
  new.forwarded := old.forwarded;
  if old.forwarded and new.deleted_at is null then
    new.body := old.body;
  end if;
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;
