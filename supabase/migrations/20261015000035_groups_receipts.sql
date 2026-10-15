-- 35: دردشة أقوى. آمن لإعادة التشغيل (يُطبَّق في كل نشر).
--   ١ مجموعات خاصة ينشئها الطالب: مالك ومشرفون وأعضاء، إضافة وإزالة، وصف، رابط دعوة، «النشر للمشرفين فقط»
--   ٢ «وصلت» و«قُرئت» لكل رسالة (من last_delivered_at و last_read_at لكل عضو)
--   ٣ متصل الآن / آخر ظهور (جدول خاص بلا Realtime، مع خيار الإخفاء)
--   ٤ رسالة مثبّتة، ورسائل النظام («أضاف فلان…»)

-- ---------------------------------------------------------------- الأعمدة
alter table public.conversations add column if not exists description text;
alter table public.conversations add column if not exists invite_code text;
alter table public.conversations add column if not exists admins_only boolean not null default false;
alter table public.conversations add column if not exists members_can_add boolean not null default false;
-- بلا مفتاح أجنبي: الرسالة المحذوفة تُخفى في التطبيق (تجنباً لمرجع دائري مع messages)
alter table public.conversations add column if not exists pinned_message_id uuid;
create unique index if not exists conversations_invite_code_key on public.conversations (invite_code) where invite_code is not null;

alter table public.conversation_members add column if not exists role text not null default 'member';
alter table public.conversation_members add column if not exists last_delivered_at timestamptz;
do $$ begin
  alter table public.conversation_members add constraint conversation_members_role_check check (role in ('owner', 'admin', 'member'));
exception when duplicate_object then null; end $$;

alter table public.messages add column if not exists kind text not null default 'text';
do $$ begin
  alter table public.messages add constraint messages_kind_check check (kind in ('text', 'system'));
exception when duplicate_object then null; end $$;

-- المجموعات القديمة (أنشأها الأدمن): منشئها مالكها
update public.conversation_members m set role = 'owner'
from public.conversations c
where c.id = m.conversation_id and c.type = 'group' and m.user_id = c.created_by and m.role = 'member'
  and not exists (select 1 from public.conversation_members o where o.conversation_id = c.id and o.role = 'owner');

-- ---------------------------------------------------------------- الصلاحيات المساعدة
create or replace function public.group_role(p_conversation uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid()
$$;

-- يدير المجموعة: مالكها ومشرفوها، والأدمن والمشرفون العامون (للإشراف)
create or replace function private.can_manage_group(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations where id = p_conversation and type = 'group')
     and public.is_approved()
     and (public.is_staff() or coalesce(public.group_role(p_conversation) in ('owner', 'admin'), false))
$$;

create or replace function private.first_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(split_part(full_name, ' ', 1), 'عضو') from public.profiles where id = p_user
$$;

-- «أحمد، علي، حسن و٣ آخرون»
create or replace function private.names_list(p_users uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(n, '، ') || case when cardinality(p_users) > 4 then ' و' || (cardinality(p_users) - 4)::text || ' آخرين' else '' end
  from (select private.first_name(u) as n from unnest(p_users[1:4]) u) x
$$;

-- رسالة نظام في المحادثة (تظهر في الوسط، لا تُحسب غير مقروءة، ولا يصدر لها إشعار هاتف)
create or replace function private.group_event(p_conversation uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.messages (conversation_id, sender_id, body, kind) values (p_conversation, auth.uid(), p_body, 'system')
$$;

-- إشعار «أضافك فلان إلى…» لمن أُضيف (يُفتح على المحادثة)
create or replace function private.notify_added(p_conversation uuid, p_users uuid[]) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, payload)
  select u, 'group', private.first_name(auth.uid()) || ' أضافك إلى مجموعة',
         (select title from public.conversations where id = p_conversation),
         jsonb_build_object('conversation_id', p_conversation)
  from unnest(p_users) u where u <> auth.uid()
$$;

-- أقصى عدد لأعضاء مجموعة ينشئها طالب (الأدمن بلا حد)
create or replace function private.group_limit() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((public.setting('chat') ->> 'group_max_members')::int, 256)
$$;

revoke all on function private.can_manage_group(uuid), private.first_name(uuid), private.names_list(uuid[]),
  private.group_event(uuid, text), private.notify_added(uuid, uuid[]), private.group_limit() from public;

-- ---------------------------------------------------------------- حماية العضوية والرسالة
-- دوال المجموعة (بعد فحص صلاحياتها) تغيّر الدور؛ الطالب من التطبيق مباشرة لا يستطيع (علامة داخل المعاملة فقط)
create or replace function private.trust() returns void
language sql security definer set search_path = public as $$
  select set_config('saey.trusted', 'on', true)
$$;
revoke all on function private.trust() from public;

create or replace function public.protect_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() or current_setting('saey.trusted', true) = 'on' then
    return new;
  end if;
  new.conversation_id := old.conversation_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  new.role := old.role;
  return new;
end $$;

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
  new.mentions := old.mentions;
  new.reply_to_id := old.reply_to_id;
  new.forwarded := old.forwarded;
  new.kind := old.kind;
  -- رسالة النظام لا تُعدَّل ولا تُحذف
  if old.kind = 'system' then
    new.body := old.body;
    new.deleted_at := old.deleted_at;
    new.edited_at := old.edited_at;
    return new;
  end if;
  if old.forwarded and new.deleted_at is null then
    new.body := old.body;
  end if;
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;

-- خروج المالك (بأي طريق) ← الملكية لأقدم مشرف ثم لأقدم عضو؛ آخر عضو يخرج ← تُحذف المجموعة
create or replace function public.on_member_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = old.conversation_id and type = 'group') then
    return old;
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = old.conversation_id) then
    delete from public.conversations where id = old.conversation_id;
  elsif old.role = 'owner' and not exists (select 1 from public.conversation_members where conversation_id = old.conversation_id and role = 'owner') then
    perform private.trust();
    update public.conversation_members set role = 'owner'
    where conversation_id = old.conversation_id and user_id = (
      select user_id from public.conversation_members where conversation_id = old.conversation_id
      order by (role = 'admin') desc, joined_at limit 1
    );
  end if;
  return old;
end $$;

drop trigger if exists conversation_members_after_delete on public.conversation_members;
create trigger conversation_members_after_delete after delete on public.conversation_members
  for each row execute function public.on_member_delete();

-- ---------------------------------------------------------------- الإرسال
-- رسائل النظام من الخادم فقط، و«النشر للمشرفين فقط» في المجموعة
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and kind = 'text'
  and public.is_member(conversation_id)
  and (
    public.is_staff()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and not c.only_staff_can_post
        and (not c.admins_only or coalesce(public.group_role(c.id) in ('owner', 'admin'), false))
    )
  )
);

-- ---------------------------------------------------------------- إنشاء المجموعة
-- إنشاء مجموعة (أدمن اللوحة) — نفس التوقيع القديم، والمنشئ صار مالكها
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
  insert into public.conversation_members (conversation_id, user_id, role)
  select cid, u, case when u = auth.uid() then 'owner' else 'member' end
  from unnest(array_append(p_members, auth.uid())) u
  where exists (select 1 from public.profiles where id = u and status = 'approved')
  on conflict do nothing;
  return cid;
end $$;

-- مجموعة خاصة من التطبيق (أي طالب معتمد)
create or replace function public.create_group_v2(p_title text, p_members uuid[], p_description text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  t text := btrim(coalesce(p_title, ''));
  added uuid[];
begin
  if not public.is_approved() then
    raise exception 'غير مصرح';
  end if;
  if not public.is_staff() and coalesce((public.setting('chat') ->> 'student_groups')::boolean, true) = false then
    raise exception 'إنشاء المجموعات متوقف حالياً';
  end if;
  if char_length(t) < 1 or char_length(t) > 60 then
    raise exception 'اسم المجموعة من حرف إلى ٦٠ حرفاً';
  end if;
  if not public.is_staff() and cardinality(coalesce(p_members, '{}')) + 1 > private.group_limit() then
    raise exception 'أقصى عدد للأعضاء %', private.group_limit();
  end if;
  -- حد معقول: لا أكثر من ٣٠ مجموعة يملكها طالب واحد
  if not public.is_staff() and (select count(*) from public.conversation_members m join public.conversations c on c.id = m.conversation_id
                                 where m.user_id = auth.uid() and m.role = 'owner' and c.type = 'group') >= 30 then
    raise exception 'وصلت لأقصى عدد من المجموعات (٣٠)';
  end if;

  insert into public.conversations (type, title, description, created_by)
  values ('group', t, nullif(btrim(coalesce(p_description, '')), ''), auth.uid()) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (cid, auth.uid(), 'owner');
  with ins as (
    insert into public.conversation_members (conversation_id, user_id)
    select distinct cid, u from unnest(coalesce(p_members, '{}')) u
    where u <> auth.uid() and exists (select 1 from public.profiles where id = u and status = 'approved')
    on conflict do nothing
    returning user_id
  ) select coalesce(array_agg(user_id), '{}') into added from ins;

  perform private.group_event(cid, private.first_name(auth.uid()) || ' أنشأ المجموعة «' || t || '»');
  perform private.notify_added(cid, added);
  return cid;
end $$;

-- ---------------------------------------------------------------- إدارة المجموعة
create or replace function public.group_add_members(p_conversation uuid, p_members uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  added uuid[];
  c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation and type = 'group';
  if c.id is null then
    raise exception 'المجموعة غير موجودة';
  end if;
  if not (private.can_manage_group(p_conversation) or (c.members_can_add and public.is_member(p_conversation))) then
    raise exception 'الإضافة لمشرفي المجموعة فقط';
  end if;
  if not public.is_staff() and (select count(*) from public.conversation_members where conversation_id = p_conversation)
       + cardinality(coalesce(p_members, '{}')) > private.group_limit() then
    raise exception 'أقصى عدد للأعضاء %', private.group_limit();
  end if;
  with ins as (
    insert into public.conversation_members (conversation_id, user_id)
    select distinct p_conversation, u from unnest(coalesce(p_members, '{}')) u
    where exists (select 1 from public.profiles where id = u and status = 'approved')
    on conflict do nothing
    returning user_id
  ) select coalesce(array_agg(user_id), '{}') into added from ins;
  if cardinality(added) > 0 then
    perform private.group_event(p_conversation, private.first_name(auth.uid()) || ' أضاف ' || private.names_list(added));
    perform private.notify_added(p_conversation, added);
  end if;
  return cardinality(added);
end $$;

create or replace function public.group_remove_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target text;
begin
  if not private.can_manage_group(p_conversation) then
    raise exception 'غير مصرح';
  end if;
  if p_user = auth.uid() then
    raise exception 'استعمل «مغادرة المجموعة»';
  end if;
  select role into target from public.conversation_members where conversation_id = p_conversation and user_id = p_user;
  if target is null then
    return;
  end if;
  if target = 'owner' and not public.is_staff() then
    raise exception 'لا يمكن إزالة مالك المجموعة';
  end if;
  if target = 'admin' and not (public.is_staff() or public.group_role(p_conversation) = 'owner') then
    raise exception 'المالك فقط يزيل مشرفاً';
  end if;
  perform private.group_event(p_conversation, private.first_name(auth.uid()) || ' أزال ' || private.first_name(p_user));
  delete from public.conversation_members where conversation_id = p_conversation and user_id = p_user;
end $$;

-- المالك والمشرفون يرفعون عضواً مشرفاً، والمالك وحده يعيد المشرف عضواً
create or replace function public.group_set_admin(p_conversation uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  target text;
begin
  if not private.can_manage_group(p_conversation) then
    raise exception 'غير مصرح';
  end if;
  select role into target from public.conversation_members where conversation_id = p_conversation and user_id = p_user;
  if target is null or target = 'owner' then
    raise exception 'لا يمكن تغيير دور هذا العضو';
  end if;
  if not p_admin and target = 'admin' and not (public.is_staff() or public.group_role(p_conversation) = 'owner') then
    raise exception 'المالك فقط يعيد المشرف عضواً';
  end if;
  perform private.trust();
  update public.conversation_members set role = case when p_admin then 'admin' else 'member' end
  where conversation_id = p_conversation and user_id = p_user;
  if p_admin and target = 'member' then
    perform private.group_event(p_conversation, private.first_name(auth.uid()) || ' جعل ' || private.first_name(p_user) || ' مشرفاً');
  end if;
end $$;

-- تغيير الاسم والوصف والإعدادات (القيمة الفارغة null = بلا تغيير، والوصف '' = حذفه)
create or replace function public.group_update(p_conversation uuid, p_title text default null, p_description text default null,
  p_admins_only boolean default null, p_members_can_add boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.conversations;
  t text := btrim(coalesce(p_title, ''));
begin
  if not private.can_manage_group(p_conversation) then
    raise exception 'غير مصرح';
  end if;
  select * into c from public.conversations where id = p_conversation;
  if p_title is not null and (char_length(t) < 1 or char_length(t) > 60) then
    raise exception 'اسم المجموعة من حرف إلى ٦٠ حرفاً';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'الوصف حتى ٥٠٠ حرف';
  end if;
  update public.conversations set
    title = case when p_title is null then title else t end,
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    admins_only = coalesce(p_admins_only, admins_only),
    members_can_add = coalesce(p_members_can_add, members_can_add)
  where id = p_conversation;
  if p_title is not null and t is distinct from c.title then
    perform private.group_event(p_conversation, private.first_name(auth.uid()) || ' غيّر اسم المجموعة إلى «' || t || '»');
  end if;
  if p_admins_only is not null and p_admins_only is distinct from c.admins_only then
    perform private.group_event(p_conversation, private.first_name(auth.uid()) ||
      case when p_admins_only then ' جعل النشر للمشرفين فقط' else ' سمح لكل الأعضاء بالنشر' end);
  end if;
end $$;

create or replace function public.group_leave(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'لا يمكن مغادرة هذه المحادثة';
  end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid()) then
    return;
  end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation) > 1 then
    perform private.group_event(p_conversation, private.first_name(auth.uid()) || ' غادر المجموعة');
  end if;
  -- نقل الملكية أو حذف المجموعة الفارغة: المشغّل on_member_delete
  delete from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid();
end $$;

create or replace function public.group_delete(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = p_conversation and type = 'group') then
    raise exception 'المجموعة غير موجودة';
  end if;
  if not (public.is_admin() or (public.is_approved() and public.group_role(p_conversation) = 'owner')) then
    raise exception 'المالك فقط يحذف المجموعة';
  end if;
  delete from public.conversations where id = p_conversation;
end $$;

-- ---------------------------------------------------------------- رابط الدعوة
create or replace function public.group_invite_code(p_conversation uuid, p_reset boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.conversations;
  code text;
begin
  select * into c from public.conversations where id = p_conversation and type = 'group';
  if c.id is null then
    raise exception 'المجموعة غير موجودة';
  end if;
  if not (private.can_manage_group(p_conversation) or (c.members_can_add and public.is_member(p_conversation))) then
    raise exception 'الرابط لمشرفي المجموعة فقط';
  end if;
  if p_reset and not private.can_manage_group(p_conversation) then
    raise exception 'المشرفون فقط يغيّرون الرابط';
  end if;
  if c.invite_code is not null and not p_reset then
    return c.invite_code;
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.conversations set invite_code = code where id = p_conversation;
  return code;
end $$;

create or replace function public.group_preview(p_code text)
returns table (id uuid, title text, description text, member_count int, is_member boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.description,
         (select count(*)::int from public.conversation_members m where m.conversation_id = c.id),
         exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
  from public.conversations c
  where c.type = 'group' and c.invite_code = lower(btrim(p_code)) and public.is_approved()
$$;

create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if not public.is_approved() then
    raise exception 'غير مصرح';
  end if;
  select id into cid from public.conversations where type = 'group' and invite_code = lower(btrim(p_code));
  if cid is null then
    raise exception 'الرابط غير صالح أو تغيّر';
  end if;
  if exists (select 1 from public.conversation_members where conversation_id = cid and user_id = auth.uid()) then
    return cid;
  end if;
  if (select count(*) from public.conversation_members where conversation_id = cid) >= private.group_limit() then
    raise exception 'المجموعة ممتلئة';
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  perform private.group_event(cid, private.first_name(auth.uid()) || ' انضم عبر رابط الدعوة');
  return cid;
end $$;

-- ---------------------------------------------------------------- الرسالة المثبّتة
-- المجموعة: مشرفوها · الخاصة: الطرفان · المدرسة والشعبة: الإدارة
create or replace function public.pin_message(p_conversation uuid, p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.conversation_type;
begin
  select type into t from public.conversations where id = p_conversation;
  if t is null or not (public.is_member(p_conversation) or public.is_staff()) then
    raise exception 'غير مصرح';
  end if;
  if not (public.is_staff() or (t = 'direct') or (t = 'group' and private.can_manage_group(p_conversation))) then
    raise exception 'التثبيت لمشرفي المحادثة فقط';
  end if;
  if p_message is not null and not exists (
    select 1 from public.messages where id = p_message and conversation_id = p_conversation and deleted_at is null and kind = 'text'
  ) then
    raise exception 'الرسالة غير موجودة';
  end if;
  update public.conversations set pinned_message_id = p_message where id = p_conversation;
end $$;

-- ---------------------------------------------------------------- وصلت / قُرئت
-- لا نكتب إن لم يتغير شيء (كل كتابة تصل لحظياً لمن يتابع المحادثة)
create or replace function public.mark_read(p_conversation uuid) returns void
language sql security definer set search_path = public as $$
  update public.conversation_members m set last_read_at = now(), last_delivered_at = now()
  where m.conversation_id = p_conversation and m.user_id = auth.uid()
    and m.last_read_at < coalesce((select c.last_message_at from public.conversations c where c.id = p_conversation), now())
$$;

-- التطبيق مفتوح وجلب المحادثات ← كل ما وصل منذ آخر مرة «وصل» (للخاصة والمجموعات؛ المدرسة والشعب كبيرة)
create or replace function public.mark_delivered() returns void
language sql security definer set search_path = public as $$
  update public.conversation_members m set last_delivered_at = now()
  from public.conversations c
  where c.id = m.conversation_id and m.user_id = auth.uid() and c.type in ('direct', 'group')
    and c.last_message_at is not null
    and greatest(m.last_read_at, coalesce(m.last_delivered_at, '-infinity')) < c.last_message_at
$$;

-- ---------------------------------------------------------------- قائمة المحادثات (نسخة ٢)
create or replace function public.my_conversations_v2()
returns table (
  id uuid, type public.conversation_type, title text, section_id uuid, only_staff_can_post boolean,
  last_message_at timestamptz, last_body text, last_sender text, unread int, muted boolean,
  peer_id uuid, peer_name text, peer_avatar text, peer_verified boolean,
  description text, my_role text, admins_only boolean, members_can_add boolean, pinned_message_id uuid,
  member_count int, last_sender_id uuid, last_kind text, last_status text, created_by uuid
)
language sql stable security definer set search_path = public as $$
  select c.id, c.type, c.title, c.section_id, c.only_staff_can_post, c.last_message_at,
         lm.body_preview, lm.sender_name,
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.created_at > me.last_read_at
             and x.sender_id <> auth.uid() and x.deleted_at is null and x.kind = 'text'),
         me.muted,
         peer.id, peer.full_name, peer.avatar_url, peer.is_verified,
         c.description, me.role, c.admins_only, c.members_can_add, c.pinned_message_id,
         (select count(*)::int from public.conversation_members x where x.conversation_id = c.id),
         lm.sender_id, lm.kind,
         case when lm.sender_id = auth.uid() and lm.kind = 'text' and lm.deleted_at is null and c.type in ('direct', 'group')
                   and exists (select 1 from public.conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() and o.joined_at <= lm.created_at) then
           case when not exists (select 1 from public.conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid()
                                   and o.joined_at <= lm.created_at and o.last_read_at < lm.created_at) then 'read'
                when not exists (select 1 from public.conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid()
                                   and o.joined_at <= lm.created_at
                                   and greatest(o.last_read_at, coalesce(o.last_delivered_at, '-infinity')) < lm.created_at) then 'delivered'
                else 'sent' end
         end,
         c.created_by
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join lateral (
    select case when m.deleted_at is not null then 'رسالة محذوفة'
                when m.body is not null and m.body <> '' then m.body
                when m.attachment ->> 'type' = 'image' then 'صورة'
                else coalesce(m.attachment ->> 'title', 'مرفق') end as body_preview,
           p.full_name as sender_name, m.sender_id, m.kind, m.created_at, m.deleted_at
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

-- ---------------------------------------------------------------- متصل الآن / آخر ظهور
-- جدول منفصل خارج Realtime: نبضة كل دقيقة من التطبيق المفتوح لا تُرسل لكل المتصلين
create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  hidden boolean not null default false
);
alter table public.user_presence enable row level security; -- بلا سياسات: الوصول عبر الدوال فقط

create or replace function public.touch_presence(p_online boolean default true) returns void
language sql security definer set search_path = public as $$
  insert into public.user_presence (user_id, online, last_seen_at)
  select auth.uid(), p_online, now() where public.is_approved()
  on conflict (user_id) do update set online = excluded.online, last_seen_at = now()
$$;

-- من أخفى آخر ظهوره لا يظهر لغيره ولا يرى غيره (مثل واتساب)
create or replace function public.set_presence_hidden(p_hidden boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.user_presence (user_id, hidden) select auth.uid(), p_hidden where public.is_approved()
  on conflict (user_id) do update set hidden = excluded.hidden
$$;

create or replace function public.presence_of(p_users uuid[])
returns table (user_id uuid, online boolean, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.online and p.last_seen_at > now() - interval '75 seconds', p.last_seen_at
  from public.user_presence p
  where p.user_id = any (p_users[1:300]) and public.is_approved() and not p.hidden
    and not coalesce((select h.hidden from public.user_presence h where h.user_id = auth.uid()), false)
$$;

create or replace function public.my_presence_hidden() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select hidden from public.user_presence where user_id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
  end if;
end $$;
