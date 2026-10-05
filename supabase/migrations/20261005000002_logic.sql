-- =============================================================================
-- سعي — المنطق: المشغّلات (triggers) والدوال (RPC)
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
  if old.status <> 'pending' then
    new.section_id := old.section_id;
  end if;
  -- الطالب المرفوض يستطيع إعادة الطلب بإكمال بياناته من جديد
  if old.status = 'rejected' and new.onboarded and not old.onboarded then
    new.status := 'pending';
  end if;
  return new;
end $$;

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

create trigger profiles_memberships
  after insert or update of status, section_id on public.profiles
  for each row execute function public.sync_memberships();

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

create trigger grades_touch before update on public.grades for each row execute function public.touch_updated_at();
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
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit()', t, t);
  end loop;
end $$;

create trigger profiles_audit after update of role, status, is_verified, section_id on public.profiles
  for each row execute function public.audit();
create trigger messages_audit after delete on public.messages
  for each row execute function public.audit();

-- =============================================================================
-- RPC
-- =============================================================================

-- قائمة محادثاتي مع آخر رسالة وعدد غير المقروء
create or replace function public.my_conversations()
returns table (
  id uuid, type public.conversation_type, title text, section_id uuid, only_staff_can_post boolean,
  last_message_at timestamptz, last_body text, last_sender text, unread int, muted boolean,
  peer_id uuid, peer_name text, peer_avatar text, peer_verified boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.type, c.title, c.section_id, c.only_staff_can_post, c.last_message_at,
         lm.body_preview, lm.sender_name,
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.created_at > me.last_read_at
             and x.sender_id <> auth.uid() and x.deleted_at is null),
         me.muted,
         peer.id, peer.full_name, peer.avatar_url, peer.is_verified
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join lateral (
    select case when m.deleted_at is not null then 'رسالة محذوفة'
                when m.body is not null and m.body <> '' then m.body
                when m.attachment ->> 'type' = 'image' then 'صورة'
                else coalesce(m.attachment ->> 'title', 'مرفق') end as body_preview,
           p.full_name as sender_name
    from public.messages m join public.profiles p on p.id = m.sender_id
    where m.conversation_id = c.id
    order by m.created_at desc limit 1
  ) lm on true
  left join lateral (
    select p.id, p.full_name, p.avatar_url, p.is_verified
    from public.conversation_members o join public.profiles p on p.id = o.user_id
    where c.type = 'direct' and o.conversation_id = c.id and o.user_id <> auth.uid()
    limit 1
  ) peer on true
  where me.user_id = auth.uid() and public.is_approved()
  order by coalesce(c.last_message_at, c.created_at) desc
$$;

create or replace function public.mark_read(p_conversation uuid) returns void
language sql security definer set search_path = public as $$
  update public.conversation_members set last_read_at = now()
  where conversation_id = p_conversation and user_id = auth.uid()
$$;

-- بدء محادثة خاصة (أو إرجاع الموجودة)
create or replace function public.start_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if not public.is_approved() then
    raise exception 'غير مصرح';
  end if;
  if p_other = auth.uid() then
    raise exception 'لا يمكن مراسلة نفسك';
  end if;
  if not public.is_staff() and coalesce((public.setting('chat') ->> 'direct_messages')::boolean, true) = false then
    raise exception 'الرسائل الخاصة متوقفة حالياً';
  end if;
  if not exists (select 1 from public.profiles where id = p_other and status = 'approved') then
    raise exception 'المستخدم غير موجود';
  end if;

  select c.id into cid
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.user_id = auth.uid()
  join public.conversation_members b on b.conversation_id = c.id and b.user_id = p_other
  where c.type = 'direct'
  limit 1;

  if cid is null then
    insert into public.conversations (type, created_by) values ('direct', auth.uid()) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, auth.uid()), (cid, p_other);
  end if;
  return cid;
end $$;

-- إنشاء مجموعة (للأدمن والمشرفين)
create or replace function public.create_group(p_title text, p_members uuid[], p_staff_only boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if not public.is_staff() then
    raise exception 'غير مصرح';
  end if;
  insert into public.conversations (type, title, only_staff_can_post, created_by)
  values ('group', p_title, p_staff_only, auth.uid()) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id)
  select cid, u from unnest(array_append(p_members, auth.uid())) u
  where exists (select 1 from public.profiles where id = u and status = 'approved')
  on conflict do nothing;
  return cid;
end $$;

-- إحصائيات لوحة التحكم
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'غير مصرح';
  end if;
  return jsonb_build_object(
    'students', (select count(*) from public.profiles where status = 'approved'),
    'pending', (select count(*) from public.profiles where status = 'pending' and onboarded),
    'lectures', (select count(*) from public.lectures),
    'documents', (select count(*) from public.documents),
    'question_sets', (select count(*) from public.question_sets where status = 'published'),
    'drafts', (select count(*) from public.question_sets where status = 'draft'),
    'messages_today', (select count(*) from public.messages where created_at > current_date),
    'ai_today', (select coalesce(sum(count), 0) from public.ai_usage where day = current_date),
    'study_minutes_week', (select coalesce(sum(minutes), 0) from public.study_sessions where started_at > now() - interval '7 days')
  );
end $$;

-- إحصائيات الدراسة للطالب (آخر ٧ أيام)
create or replace function public.my_study_week()
returns table (day date, minutes int)
language sql stable security definer set search_path = public as $$
  select d::date, coalesce(sum(s.minutes), 0)::int
  from generate_series(current_date - 6, current_date, interval '1 day') d
  left join public.study_sessions s on s.user_id = auth.uid() and s.started_at::date = d::date
  group by d order by d
$$;

-- البحث الدلالي في المنهج (يُستدعى من دالة المساعد الذكي بصلاحية الخادم)
create or replace function public.match_chunks(
  query_embedding extensions.vector(768), match_count int default 8, p_subject uuid default null
)
returns table (id uuid, source_type text, source_id uuid, subject_id uuid, chapter_id uuid, page int, content text, similarity float)
language sql stable set search_path = public, extensions as $$
  select c.id, c.source_type, c.source_id, c.subject_id, c.chapter_id, c.page, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.content_chunks c
  where c.embedding is not null and (p_subject is null or c.subject_id = p_subject)
  order by c.embedding <=> query_embedding
  limit match_count
$$;

-- حجز رصيد المساعد الذكي (ذرّي): يرجع العدد بعد الزيادة أو -1 إذا انتهى الرصيد
create or replace function public.consume_ai_quota(p_user uuid, p_limit int) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into n;
  return coalesce(n, -1);
end $$;

revoke execute on function public.match_chunks(extensions.vector, int, uuid) from public, anon, authenticated;
revoke execute on function public.consume_ai_quota(uuid, int) from public, anon, authenticated;
