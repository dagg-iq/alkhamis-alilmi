-- 25: إصلاحات الفحص الشامل (system/AUDIT-2026-10-12.md). آمن لإعادة التشغيل (يُطبَّق في كل نشر).
--   A1 حماية العضوية: الطالب لا ينقل عضويته إلى محادثة أخرى
--   A6 حماية الرسالة: لا تعديل للإشارات أو الرد بعد الإرسال
--   A7 محادثة خاصة واحدة فقط بين شخصين حتى مع الضغط المتزامن
--   B3 حذف محاضرة/ملزمة/أسئلة يحذف مقاطعها من بحث المساعد
--   B1 إرجاع سؤال للرصيد بشكل ذرّي عند فشل المساعد
--   B5 «رسائل اليوم» بتوقيت بغداد
--   B6 تنظيف يومي للجداول التي تكبر بلا حد
--   B9 إشعار للطلاب عند نشر أسئلة جديدة

-- ---------------------------------------------------------------- A1 العضوية
-- كانت سياسة «update own membership» تسمح بتغيير conversation_id نفسه (الدخول لأي محادثة يُعرف معرّفها).
-- غير المشرف يغيّر فقط last_read_at و muted.
create or replace function public.protect_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;
  new.conversation_id := old.conversation_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  return new;
end $$;

drop trigger if exists conversation_members_protect on public.conversation_members;
create trigger conversation_members_protect
  before update on public.conversation_members
  for each row execute function public.protect_membership();

-- ---------------------------------------------------------------- A6 الرسائل
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
  if new.body is distinct from old.body and new.deleted_at is null then
    new.edited_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- A7 محادثة خاصة واحدة
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

  -- قفل على الزوج (بأي ترتيب): طلبان متزامنان لا ينشئان محادثتين
  perform pg_advisory_xact_lock(hashtextextended(least(auth.uid()::text, p_other::text) || '|' || greatest(auth.uid()::text, p_other::text), 0));

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

-- ---------------------------------------------------------------- B3 مقاطع البحث للمصادر المحذوفة
-- content_chunks بلا مفتاح أجنبي (المصدر متعدد الأنواع)، فالحذف كان يترك مقاطع يستشهد بها المساعد
create or replace function public.delete_source_chunks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_chunks where source_type = tg_argv[0] and source_id = old.id;
  return old;
end $$;

drop trigger if exists lectures_chunks_cleanup on public.lectures;
create trigger lectures_chunks_cleanup after delete on public.lectures
  for each row execute function public.delete_source_chunks('lecture');
drop trigger if exists documents_chunks_cleanup on public.documents;
create trigger documents_chunks_cleanup after delete on public.documents
  for each row execute function public.delete_source_chunks('document');
drop trigger if exists question_sets_chunks_cleanup on public.question_sets;
create trigger question_sets_chunks_cleanup after delete on public.question_sets
  for each row execute function public.delete_source_chunks('question_set');

-- ما بقي يتيماً من قبل
delete from public.content_chunks c where c.source_type = 'lecture' and not exists (select 1 from public.lectures x where x.id = c.source_id);
delete from public.content_chunks c where c.source_type = 'document' and not exists (select 1 from public.documents x where x.id = c.source_id);
delete from public.content_chunks c where c.source_type = 'question_set' and not exists (select 1 from public.question_sets x where x.id = c.source_id);

-- ---------------------------------------------------------------- B1/B2 إرجاع سؤال للرصيد (ذرّي، بتاريخ قاعدة البيانات نفسه)
-- كان الإرجاع يتطلب أن يبقى العدد كما هو (count = used)، فيضيع إن سأل الطالب سؤالاً آخر في نفس اللحظة
create or replace function public.refund_ai_quota(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage set count = greatest(0, count - 1) where user_id = p_user and day = current_date and count > 0;
$$;
revoke execute on function public.refund_ai_quota(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- B5 إحصاءات بتوقيت بغداد
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Baghdad')) at time zone 'Asia/Baghdad';
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
    'messages_today', (select count(*) from public.messages where created_at >= today_start),
    -- رصيد المساعد يُحسب بتاريخ قاعدة البيانات (consume_ai_quota)، فنقرؤه بنفس التاريخ
    'ai_today', (select coalesce(sum(count), 0) from public.ai_usage where day = current_date),
    'study_minutes_week', (select coalesce(sum(minutes), 0) from public.study_sessions where started_at > now() - interval '7 days')
  );
end $$;

-- ---------------------------------------------------------------- B6 تنظيف يومي
create or replace function private.daily_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where created_at < now() - interval '120 days';
  -- المساعد لا يقرأ الإجابات المحفوظة الأقدم من ٣٠ يوماً
  delete from public.ai_cache where created_at < now() - interval '30 days';
  delete from public.ai_usage where day < current_date - 90;
  delete from public.ai_key_usage where day < (now() at time zone 'utc')::date - 60;
  delete from public.ai_key_blocks where blocked_until < now() - interval '1 day';
exception when others then
  raise notice 'daily_cleanup: %', sqlerrm;
end $$;
revoke all on function private.daily_cleanup() from public;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'saey-cleanup';
  -- ٣:١٧ فجراً بتوقيت بغداد
  perform cron.schedule('saey-cleanup', '17 0 * * *', 'select private.daily_cleanup()');
exception when others then
  raise notice 'pg_cron غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- B9 إشعار الأسئلة الجديدة
-- عند نشر مجموعة أسئلة (أول مرة): إشعار للطلاب. أسئلة امتحان شعبة معيّنة ← طلاب تلك الشعبة فقط.
-- نشر عدة مجموعات معاً لا يُغرق الطالب: إشعار واحد كل ١٥ دقيقة.
create or replace function public.on_question_set_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  subject_name text;
begin
  if new.status <> 'published' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;
  end if;
  select name into subject_name from public.subjects where id = new.subject_id;
  insert into public.notifications (user_id, type, title, body, payload)
  select p.id, 'questions',
         case new.kind when 'expected' then 'أسئلة متوقعة جديدة' else 'أسئلة امتحان جديدة' end
           || coalesce(' — ' || subject_name, ''),
         new.title, jsonb_build_object('question_set_id', new.id)
  from public.profiles p
  where p.status = 'approved'
    and p.role = 'student'
    and (new.kind = 'expected' or new.section_id is null or p.section_id = new.section_id)
    and not exists (
      select 1 from public.notifications n
      where n.user_id = p.id and n.type = 'questions' and n.created_at > now() - interval '15 minutes'
    );
  return new;
end $$;

drop trigger if exists question_sets_publish_notify on public.question_sets;
create trigger question_sets_publish_notify
  after insert or update of status on public.question_sets
  for each row execute function public.on_question_set_publish();
