-- =============================================================================
-- سعي — ٥: منطق المستخدمين والعضوية
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- ---------------------------------------------------------------- مستخدم جديد
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- حماية أعمدة الملف الشخصي
-- الطالب يعدّل اسمه وصورته ونبذته فقط. الدور والحالة والتوثيق للأدمن وحده.
-- الشعبة: يختارها الطالب أثناء التسجيل فقط، وبعد الموافقة يغيّرها الأدمن.
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

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------------------------------------------------------------- عضوية المحادثات التلقائية
create or replace function public.ensure_section_conversation(p_section uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  select id into cid from public.conversations where type = 'section' and section_id = p_section;
  if cid is null then
    insert into public.conversations (type, section_id, title)
    select 'section', s.id, 'شعبة ' || s.name from public.sections s where s.id = p_section
    returning id into cid;
  end if;
  return cid;
end $$;

create or replace function public.ensure_school_conversation() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  select id into cid from public.conversations where type = 'school';
  if cid is null then
    insert into public.conversations (type, title) values ('school', 'المدرسة') returning id into cid;
  end if;
  return cid;
end $$;

create or replace function public.sync_memberships() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if new.status = 'approved' then
    insert into public.conversation_members (conversation_id, user_id)
    values (public.ensure_school_conversation(), new.id)
    on conflict do nothing;

    if new.section_id is not null then
      cid := public.ensure_section_conversation(new.section_id);
      insert into public.conversation_members (conversation_id, user_id)
      values (cid, new.id) on conflict do nothing;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- ترك محادثة الشعبة القديمة عند تغيير الشعبة
    if old.section_id is distinct from new.section_id and old.section_id is not null then
      delete from public.conversation_members m
      using public.conversations c
      where m.conversation_id = c.id and c.type = 'section' and c.section_id = old.section_id and m.user_id = new.id;
    end if;
    -- المحظور يخرج من كل المحادثات الجماعية
    if new.status in ('banned', 'rejected') and old.status = 'approved' then
      delete from public.conversation_members m
      using public.conversations c
      where m.conversation_id = c.id and c.type in ('school', 'section') and m.user_id = new.id;
    end if;
    -- إشعار الطالب بالموافقة
    if new.status = 'approved' and old.status <> 'approved' then
      insert into public.notifications (user_id, type, title, body)
      values (new.id, 'approved', 'تم قبولك في سعي', 'أهلاً بك! كل شيء جاهز الآن.');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_memberships on public.profiles;
create trigger profiles_memberships
  after insert or update of status, section_id on public.profiles
  for each row execute function public.sync_memberships();
