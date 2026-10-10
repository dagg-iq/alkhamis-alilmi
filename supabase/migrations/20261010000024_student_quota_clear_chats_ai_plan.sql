-- 24: حصة مساعد خاصة لكل طالب، مسح الدردشات من لوحة التحكم، وخطة «الشرح على أقسام» لمحادثات المساعد. آمن لإعادة التشغيل.

-- ١) حد أسئلة يومي خاص بالطالب (فارغ = الحد العام من الإعدادات). الأدمن فقط يغيّره.
alter table public.profiles add column if not exists ai_daily_limit int check (ai_daily_limit is null or (ai_daily_limit >= 0 and ai_daily_limit <= 500));

create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- استدعاءات الخادم (service_role) وطلبات الأدمن لا تُقيَّد
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  new.role := old.role;
  new.status := old.status;
  new.is_verified := old.is_verified;
  new.created_at := old.created_at;
  new.ai_daily_limit := old.ai_daily_limit;
  if old.status not in ('pending', 'rejected') then
    new.section_id := old.section_id;
  end if;
  -- إرسال طلب الانضمام مسموح فقط والتسجيل مفتوح
  if new.onboarded and not old.onboarded
     and coalesce((public.setting('registration') ->> 'open')::boolean, true) = false then
    raise exception 'التسجيل مغلق حالياً، راجع الأدمن.';
  end if;
  -- الطالب المرفوض يستطيع إعادة الطلب بإكمال بياناته من جديد
  if old.status = 'rejected' and new.onboarded and not old.onboarded then
    new.status := 'pending';
  end if;
  return new;
end $$;

-- ٢) مسح الدردشات (للأدمن): محادثة واحدة أو الكل.
-- المدرسة والشعب والمجموعات تبقى (أعضاؤها كما هم) وتُمسح رسائلها؛ المحادثات الخاصة تُحذف كلها.
create or replace function public.admin_clear_chats(p_conversation uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  k int;
begin
  if not public.is_admin() then
    raise exception 'للأدمن فقط';
  end if;
  if p_conversation is not null then
    delete from public.messages where conversation_id = p_conversation;
    get diagnostics n = row_count;
    update public.conversations set last_message_at = null where id = p_conversation;
    return n;
  end if;
  -- (شرط WHERE صريح: Supabase يرفض الحذف/التحديث بلا شرط عبر الواجهة)
  delete from public.messages where id is not null;
  get diagnostics n = row_count;
  delete from public.conversations where type = 'direct';
  get diagnostics k = row_count;
  update public.conversations set last_message_at = null where id is not null;
  return n + k;
end $$;
revoke execute on function public.admin_clear_chats(uuid) from public, anon;
grant execute on function public.admin_clear_chats(uuid) to authenticated;

-- ٣) خطة شرح فصل طويل على أقسام (يكتبها الخادم فقط)
alter table public.ai_chats add column if not exists plan jsonb;
