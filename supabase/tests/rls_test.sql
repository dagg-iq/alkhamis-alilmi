\set ON_ERROR_STOP 1
-- المستخدمون
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x', '{"full_name":"الأدمن"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@x', '{"full_name":"طالب ب"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@x', '{"full_name":"طالب ج"}');
update public.profiles set role = 'admin', status = 'approved', is_verified = true, onboarded = true
  where id = '00000000-0000-0000-0000-00000000000a';

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;

-- ١. الطالب ب يكمل بياناته وهو بانتظار الموافقة: لا يرى المواد
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update public.profiles set full_name = 'علي حسين كاظم', onboarded = true, role = 'admin', status = 'approved',
  section_id = (select id from public.sections where name = 'أ') where id = auth.uid();
do $$ begin
  assert (select role from public.profiles where id = auth.uid()) = 'student', 'الطالب رفع نفسه أدمن!';
  assert (select status from public.profiles where id = auth.uid()) = 'pending', 'الطالب وافق على نفسه!';
  assert (select section_id from public.profiles where id = auth.uid()) is not null, 'لم تُحفظ الشعبة';
  assert (select count(*) from public.subjects) = 0, 'المنتظر يرى المواد';
  assert (select count(*) from public.sections) = 5, 'المنتظر لا يرى الشعب';
end $$;
reset role;

-- ٢. الأدمن يوافق
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.profiles set status = 'approved' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.conversation_members where user_id = '00000000-0000-0000-0000-00000000000b') = 2,
    'لم يُضف إلى محادثتي المدرسة والشعبة';
  assert (select count(*) from public.audit_log where target_type = 'profiles') >= 1, 'لم تُسجل العملية';
end $$;
insert into public.posts (title, body) values ('عطلة', 'غداً عطلة رسمية');
reset role;

-- ٣. الطالب المعتمد
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare cid uuid; n int;
begin
  assert (select count(*) from public.subjects) = 9, 'المعتمد لا يرى المواد';
  assert (select count(*) from public.notifications where type = 'approved') = 1, 'لا إشعار موافقة';
  assert (select count(*) from public.notifications where type = 'post') = 1, 'لا إشعار خبر';
  insert into public.grades (subject_id, period, score) select id, 'month1', 95 from public.subjects where slug = 'physics';
  assert (select count(*) from public.grades) = 1;
  -- لا ينشر خبراً
  begin
    insert into public.posts (title) values ('اختراق');
    raise exception 'طالب نشر خبراً!';
  exception when insufficient_privilege then null;
  end;
  -- لا ينشئ مهمة للشعبة
  begin
    insert into public.tasks (scope, section_id, title) values ('school', null, 'x');
    raise exception 'طالب أنشأ مهمة عامة!';
  exception when insufficient_privilege then null;
  end;
  insert into public.tasks (title, type) values ('حل تمارين الفصل', 'homework');
  -- يرسل رسالة في محادثة المدرسة مع تاغ للأدمن
  select id into cid from public.conversations where type = 'school';
  insert into public.messages (conversation_id, body, mentions) values (cid, 'السلام عليكم @الأدمن', array['00000000-0000-0000-0000-00000000000a']::uuid[]);
  assert (select count(*) from public.my_conversations()) = 2, 'my_conversations';
  -- محادثة خاصة مع الأدمن
  cid := public.start_direct('00000000-0000-0000-0000-00000000000a');
  assert public.start_direct('00000000-0000-0000-0000-00000000000a') = cid, 'تكرار المحادثة الخاصة';
  insert into public.messages (conversation_id, body) values (cid, 'مرحبا');
  -- لا يستطيع مراسلة طالب غير معتمد
  begin
    perform public.start_direct('00000000-0000-0000-0000-00000000000c');
    raise exception 'راسل غير معتمد!';
  exception when raise_exception then
    if sqlerrm = 'راسل غير معتمد!' then raise; end if;
  end;
  -- لا يرى الطالب ج المنتظر
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 0, 'يرى المنتظرين';
  -- لا يستطيع حجز رصيد الذكاء الاصطناعي مباشرة
  begin
    perform public.consume_ai_quota(auth.uid(), 100);
    raise exception 'استدعى دالة الخادم!';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ٤. الأدمن يرى الإشارة ويرى درجات الطالب
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- (داخل الاختبار كل شيء في نفس اللحظة، فنُرجع وقت القراءة للخلف)
update public.conversation_members set last_read_at = '2000-01-01' where user_id = auth.uid();
do $$ begin
  assert (select count(*) from public.notifications where type = 'mention') = 1, 'لا إشعار تاغ';
  assert (select count(*) from public.grades) = 1, 'الأدمن لا يرى الدرجات';
  assert (select (public.admin_stats() ->> 'students')::int) = 2, 'إحصائيات';
  assert (select unread from public.my_conversations() where type = 'direct') = 1, 'غير المقروء';
end $$;
reset role;

-- ٥. الطالب ج (منتظر) لا يرى درجات ب ولا الرسائل
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.grades) = 0;
  assert (select count(*) from public.messages) = 0;
  assert (select count(*) from public.posts) = 0;
end $$;
reset role;

-- ٦. رصيد الذكاء الاصطناعي (من الخادم)
do $$ begin
  assert public.consume_ai_quota('00000000-0000-0000-0000-00000000000b', 2) = 1;
  assert public.consume_ai_quota('00000000-0000-0000-0000-00000000000b', 2) = 2;
  assert public.consume_ai_quota('00000000-0000-0000-0000-00000000000b', 2) = -1, 'تجاوز الحد';
end $$;

-- ٧. المرحلة ب: الإجابات المحفوظة للخادم فقط، ومواضيع المحاضرات يكتبها المشرفون فقط
insert into public.ai_cache (key, question, answer) values ('t1', 'س', 'ج');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.ai_cache) = 0, 'الطالب يرى الإجابات المحفوظة';
  begin
    insert into public.ai_cache (key, question, answer) values ('t2', 'س', 'ج');
    raise exception 'طالب كتب في الإجابات المحفوظة!';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.lecture_topics (lecture_id, start_sec, title) values (gen_random_uuid(), 0, 'x');
    raise exception 'طالب أضاف موضوع محاضرة!';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ٨. الجداول: المشرف يكتب، الطالب يرى المنشور لشعبته أو للكل فقط، وتفضيلاته تُحفظ على حسابه
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.schedules (id, title, kind, section_id, is_published) values
  ('00000000-0000-0000-0000-0000000000a1', 'جدول الحصص — أ', 'weekly', (select id from public.sections where name = 'أ'), true),
  ('00000000-0000-0000-0000-0000000000a2', 'جدول الحصص — ب', 'weekly', (select id from public.sections where name = 'ب'), true),
  ('00000000-0000-0000-0000-0000000000a3', 'امتحانات الشهر الأول', 'exam', null, true),
  ('00000000-0000-0000-0000-0000000000a4', 'مسودة', 'custom', null, false);
insert into public.schedule_items (schedule_id, day, sort, start_time, end_time, title) values
  ('00000000-0000-0000-0000-0000000000a1', 0, 1, '08:00', '08:45', 'فيزياء'),
  ('00000000-0000-0000-0000-0000000000a2', 0, 1, '08:00', '08:45', 'كيمياء');
insert into public.schedule_items (schedule_id, on_date, sort, title) values
  ('00000000-0000-0000-0000-0000000000a3', current_date + 3, 1, 'الرياضيات');
reset role;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  -- الطالب ب في شعبة أ: يرى جدول أ وجدول الامتحانات فقط (لا ب ولا المسودة)
  assert (select count(*) from public.schedules) = 2, 'الطالب يرى جداول غير شعبته أو مسودات';
  assert (select count(*) from public.schedule_items) = 2, 'الطالب يرى حصص شعبة أخرى';
  begin
    insert into public.schedules (title) values ('اختراق');
    raise exception 'طالب أنشأ جدولاً!';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.schedule_items (schedule_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'x');
    raise exception 'طالب أضاف حصة!';
  exception when insufficient_privilege then null;
  end;
  -- التفضيلات على الحساب
  update public.profiles set prefs = '{"goal":"general","theme":"dark"}' where id = auth.uid();
  assert (select prefs ->> 'goal' from public.profiles where id = auth.uid()) = 'general', 'لم يُحفظ الهدف على الحساب';
end $$;
reset role;

select 'ALL RLS TESTS PASSED' as result;
