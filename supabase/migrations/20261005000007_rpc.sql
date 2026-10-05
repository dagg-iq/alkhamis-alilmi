-- =============================================================================
-- سعي — ٧: الدوال (RPC)
-- آمن لإعادة التشغيل أكثر من مرة
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
