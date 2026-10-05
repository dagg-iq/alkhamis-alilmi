-- =============================================================================
-- سعي — ٦: منطق الرسائل والأخبار والسجل
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- ---------------------------------------------------------------- الرسائل
create or replace function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_members set last_read_at = new.created_at
    where conversation_id = new.conversation_id and user_id = new.sender_id;

  if array_length(new.mentions, 1) > 0 then
    select full_name into sender_name from public.profiles where id = new.sender_id;
    insert into public.notifications (user_id, type, title, body, payload)
    select m.user_id, 'mention', sender_name || ' أشار إليك', left(coalesce(new.body, ''), 140),
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id)
    from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id = any (new.mentions)
      and m.user_id <> new.sender_id;
  end if;
  return new;
end $$;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.on_message_insert();

-- المرسل يعدّل نص رسالته أو يحذفها فقط (لا يغيّر المحادثة أو المرسل)
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
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists messages_protect on public.messages;
create trigger messages_protect
  before update on public.messages
  for each row execute function public.protect_message();

-- ---------------------------------------------------------------- الأخبار ← إشعارات
create or replace function public.on_post_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, payload)
  select p.id, 'post', new.title, left(new.body, 140), jsonb_build_object('post_id', new.id)
  from public.profiles p
  where p.status = 'approved'
    and p.id <> new.author_id
    and (new.section_id is null or p.section_id = new.section_id);
  return new;
end $$;

drop trigger if exists posts_after_insert on public.posts;
create trigger posts_after_insert
  after insert on public.posts
  for each row execute function public.on_post_insert();

-- ---------------------------------------------------------------- مهام الشعبة ← إشعارات
create or replace function public.on_task_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'personal' then
    return new;
  end if;
  insert into public.notifications (user_id, type, title, body, payload)
  select p.id, 'task',
         case new.type when 'exam' then 'امتحان جديد: ' when 'homework' then 'واجب جديد: '
                       when 'preparation' then 'تحضير جديد: ' else 'مهمة جديدة: ' end || new.title,
         new.notes, jsonb_build_object('task_id', new.id)
  from public.profiles p
  where p.status = 'approved'
    and p.id <> new.owner_id
    and (new.scope = 'school' or p.section_id = new.section_id);
  return new;
end $$;

drop trigger if exists tasks_after_insert on public.tasks;
create trigger tasks_after_insert
  after insert on public.tasks
  for each row execute function public.on_task_insert();

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists grades_touch on public.grades;
create trigger grades_touch before update on public.grades for each row execute function public.touch_updated_at();
drop trigger if exists question_sets_touch on public.question_sets;
create trigger question_sets_touch before update on public.question_sets for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- سجل العمليات
create or replace function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
begin
  -- نسجّل فقط عمليات الأدمن والمشرفين
  if auth.uid() is null or not public.is_staff() then
    return coalesce(new, old);
  end if;
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (actor_id, action, target_type, target_id, meta)
  values (
    auth.uid(), lower(tg_op), tg_table_name, rec ->> 'id',
    jsonb_strip_nulls(jsonb_build_object(
      'title', coalesce(rec ->> 'title', rec ->> 'name', rec ->> 'full_name', rec ->> 'key'),
      'status', rec ->> 'status', 'role', rec ->> 'role'
    ))
  );
  return coalesce(new, old);
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['sections', 'subjects', 'books', 'chapters', 'teachers', 'lectures', 'documents',
                           'question_sets', 'posts', 'app_settings'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit()', t, t);
  end loop;
end $$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update of role, status, is_verified, section_id on public.profiles
  for each row execute function public.audit();
drop trigger if exists messages_audit on public.messages;
create trigger messages_audit after delete on public.messages
  for each row execute function public.audit();
