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
  -- ولا يحوّل مهمته الخاصة إلى مهمة عامة بالتعديل
  begin
    update public.tasks set scope = 'school' where title = 'حل تمارين الفصل';
    raise exception 'طالب حوّل مهمته إلى عامة!';
  exception when insufficient_privilege then null;
  end;
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
-- (migration ١٨ أنشأ جدول الحصص الحقيقي لكل شعبة: ٥ شعب × ٥ أيام × ٦ حصص — نتحقق منه ثم نمسحه ليبقى الاختبار معزولاً)
do $$ begin
  assert (select count(*) from public.schedules where kind = 'weekly' and section_id is not null) = 5, 'جداول الشعب الخمس';
  assert (select count(*) from public.schedule_items) = 150, 'عدد الحصص';
  assert (select count(*) from public.schedule_items i join public.schedules s on s.id = i.schedule_id
          join public.sections c on c.id = s.section_id where c.name = 'أ' and i.day = 0 and i.sort = 1
          and i.subject_id = (select id from public.subjects where slug = 'computer')) = 1, 'أول حصة أحد لشعبة أ = حاسوب';
  assert (select count(*) from public.schedule_items where subject_id is null and title is null) = 0, 'حصة بلا مادة';
end $$;
delete from public.schedules;
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

-- ٩. فهرس الكتب والملازم: الطالب يقرؤه ولا يكتبه، والربط بين الملفات يعمل
insert into public.documents (id, subject_id, title, file_key, kind, pages, is_published)
select '00000000-0000-0000-0000-0000000000d1', id, 'كتاب الفيزياء', 'materials/b.pdf', 'book', 100, true from public.subjects where slug = 'physics';
insert into public.documents (id, subject_id, title, file_key, kind, pages, is_published)
select '00000000-0000-0000-0000-0000000000d2', id, 'ملزمة الفيزياء', 'materials/m.pdf', 'malzama', 50, true from public.subjects where slug = 'physics';
insert into public.documents (id, subject_id, title, file_key, kind, pages, is_published)
select '00000000-0000-0000-0000-0000000000d3', id, 'ملزمة مخفية', 'materials/h.pdf', 'malzama', 50, false from public.subjects where slug = 'physics';
insert into public.document_outline (id, document_id, level, title, start_page, end_page, sort, embedding) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 2, 'المتسعات', 10, 20, 1, array_fill(0.1::float, array[768])::extensions.vector),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 2, 'السعة الكهربائية', 3, 8, 1, array_fill(0.1::float, array[768])::extensions.vector),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d3', 2, 'مخفي', 1, 2, 1, array_fill(0.1::float, array[768])::extensions.vector);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.document_outline) = 2, 'الطالب يرى فهرس ملف غير منشور أو لا يرى المنشور';
  assert (select count(*) from public.related_topics('00000000-0000-0000-0000-0000000000e1')) = 1, 'الربط بين الكتاب والملزمة لا يعمل أو يكشف المخفي';
  assert (select title from public.related_topics('00000000-0000-0000-0000-0000000000e1') limit 1) = 'السعة الكهربائية';
  begin
    insert into public.document_outline (document_id, level, title, start_page) values ('00000000-0000-0000-0000-0000000000d1', 1, 'اختراق', 1);
    raise exception 'طالب كتب في الفهرس!';
  exception when insufficient_privilege then null;
  end;
  -- ١٠. استخدام مفاتيح Gemini: للأدمن فقط، والتسجيل من الخادم فقط
  assert (select count(*) from public.ai_key_usage) = 0, 'طالب يرى استخدام المفاتيح';
  begin
    perform public.ai_log_call('GEMINI_API_KEY', 'x', true);
    raise exception 'طالب يسجّل استخداماً!';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select public.ai_log_call('GEMINI_API_KEY', 'gemini-3.8-flash', true, 200, null);
select public.ai_log_call('GEMINI_API_KEY', 'gemini-3.8-flash', false, 429, 'quota');
insert into public.ai_key_blocks (slot, model, blocked_until, reason) values ('GEMINI_API_KEY', 'gemini-3.8-flash', now() + interval '3 hours', 'test');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select requests from public.ai_key_usage where slot = 'GEMINI_API_KEY' and model = 'gemini-3.8-flash') = 1, 'العداد';
  assert (select errors from public.ai_key_usage where slot = 'GEMINI_API_KEY' and model = 'gemini-3.8-flash') = 1, 'عداد الأخطاء';
  assert (select count(*) from public.ai_key_blocks) = 1, 'الأدمن لا يرى الأقفال';
end $$;
reset role;

-- ١١. طابور الفهرسة: للمشرفين فقط، والحجز بترتيب دخول الكتب ثم الصفحات، وعامل واحد في الوقت نفسه
insert into public.ingest_chunks (document_id, from_page, to_page, total_pages, file_key) values
  ('00000000-0000-0000-0000-0000000000d2', 1, 8, 50, 'material/q1.pdf'),
  ('00000000-0000-0000-0000-0000000000d1', 9, 16, 100, 'material/q3.pdf'),
  ('00000000-0000-0000-0000-0000000000d1', 1, 8, 100, 'material/q2.pdf');
update public.documents set queued_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000d1';
update public.documents set queued_at = now() where id = '00000000-0000-0000-0000-0000000000d2';
do $$
declare a public.ingest_chunks; b public.ingest_chunks;
begin
  select * into a from public.claim_ingest_chunks(1, 60);
  assert a.document_id = '00000000-0000-0000-0000-0000000000d1' and a.from_page = 1 and a.status = 'running' and a.attempts = 1, 'الحجز لا يبدأ بأول كتاب وأول صفحة';
  select * into b from public.claim_ingest_chunks(1, 60);
  assert b.document_id = '00000000-0000-0000-0000-0000000000d1' and b.from_page = 9, 'الحجز لا يكمل الكتاب نفسه بالترتيب';
  assert (select count(*) from public.claim_ingest_chunks(5, 60)) = 1, 'حُجز جزء محجوز مرتين';
  assert (select count(*) from public.claim_ingest_chunks(5, 60)) = 0, 'لا شيء يبقى للحجز';
  update public.ingest_chunks set lease_until = now() - interval '1 second' where id = a.id;
  assert (select count(*) from public.claim_ingest_chunks(5, 60)) = 1, 'جزء انتهى حجزه (عامل توقف) لا يُستعاد';
  update public.documents set queued_at = null where id = '00000000-0000-0000-0000-0000000000d1';
  update public.ingest_chunks set status = 'pending', lease_until = null where document_id = '00000000-0000-0000-0000-0000000000d1';
  assert (select count(*) from public.claim_ingest_chunks(5, 60)) = 0, 'كتاب خارج الطابور يُقرأ';
  assert public.ingest_worker_lock(60) = true, 'القفل الأول';
  assert public.ingest_worker_lock(60) = false, 'عاملان معاً';
  perform public.ingest_worker_unlock();
  assert public.ingest_worker_lock(60) = true, 'القفل بعد الفتح';
  perform public.ingest_worker_unlock();
  perform private.ingest_tick(); -- بلا رابط إشعارات: لا يفعل شيئاً ولا يفشل
end $$;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.ingest_chunks) = 0, 'طالب يرى طابور الفهرسة';
  begin
    perform public.claim_ingest_chunks(1, 60);
    raise exception 'طالب يحجز من الطابور!';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.ingest_chunks) = 3, 'الأدمن لا يرى الطابور';
end $$;
reset role;

-- ٢٤) حصة المساعد الخاصة بالطالب ومسح الدردشات
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  update public.profiles set ai_daily_limit = 500 where id = '00000000-0000-0000-0000-00000000000b';
  assert (select ai_daily_limit from public.profiles where id = '00000000-0000-0000-0000-00000000000b') is null, 'طالب رفع حصته بنفسه!';
  begin
    perform public.admin_clear_chats(null);
    raise exception 'طالب مسح الدردشات!';
  exception when raise_exception then
    if sqlerrm = 'طالب مسح الدردشات!' then raise; end if;
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.profiles set ai_daily_limit = 40 where id = '00000000-0000-0000-0000-00000000000b';
  assert (select ai_daily_limit from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 40, 'الأدمن لا يغيّر حصة الطالب';
  perform public.admin_clear_chats(null);
  assert (select count(*) from public.messages) = 0, 'بقيت رسائل بعد المسح';
  assert (select count(*) from public.conversations where type = 'direct') = 0, 'بقيت محادثات خاصة';
  assert (select count(*) from public.conversations where type = 'section') > 0, 'حُذفت محادثات الشعب';
end $$;
reset role;

-- ٢٥) إصلاحات الفحص الشامل
-- A1: الطالب لا ينقل عضويته إلى محادثة لم يُضف إليها
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_group('مجموعة المشرفين', array[]::uuid[], false) as gid \gset
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update public.conversation_members set conversation_id = :'gid'
  where user_id = auth.uid() and conversation_id = (select id from public.conversations where type = 'school');
update public.conversation_members set muted = true
  where user_id = auth.uid() and conversation_id = (select id from public.conversations where type = 'school');
do $$ begin
  assert (select count(*) from public.conversation_members where user_id = auth.uid() and conversation_id = (select id from public.conversations where type = 'group' and title = 'مجموعة المشرفين')) = 0,
    'طالب نقل عضويته إلى مجموعة لم يُضف إليها!';
  assert (select muted from public.conversation_members where user_id = auth.uid() and conversation_id = (select id from public.conversations where type = 'school')), 'الطالب لا يستطيع كتم المحادثة';
  -- A6: الإشارات لا تتغير بعد الإرسال
  insert into public.messages (conversation_id, body) values ((select id from public.conversations where type = 'school'), 'رسالة');
  update public.messages set mentions = array['00000000-0000-0000-0000-00000000000a']::uuid[], body = 'رسالة معدلة' where body = 'رسالة';
  assert (select cardinality(mentions) from public.messages where body = 'رسالة معدلة') = 0, 'الطالب غيّر إشارات رسالة قديمة';
  assert (select edited_at is not null from public.messages where body = 'رسالة معدلة'), 'لم يُسجَّل التعديل';
end $$;
reset role;

-- B3: حذف محاضرة يحذف مقاطعها من بحث المساعد
insert into public.chapters (id, book_id, number, title)
select '00000000-0000-0000-0000-0000000000c1', b.id, 1, 'الفصل الأول' from public.books b join public.subjects s on s.id = b.subject_id where s.slug = 'physics' limit 1;
insert into public.lectures (id, chapter_id, title, youtube_id) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'محاضرة', 'abcdefghijk');
insert into public.content_chunks (source_type, source_id, content) values
  ('lecture', '00000000-0000-0000-0000-0000000000f1', 'شرح'),
  ('document', '00000000-0000-0000-0000-0000000000d3', 'صفحة');
delete from public.lectures where id = '00000000-0000-0000-0000-0000000000f1';
delete from public.documents where id = '00000000-0000-0000-0000-0000000000d3';
do $$ begin
  assert (select count(*) from public.content_chunks where source_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d3')) = 0,
    'بقيت مقاطع لمصدر محذوف';
end $$;

-- B9: نشر أسئلة ← إشعار واحد للطالب (لا للأدمن)، والنشر المتتابع لا يكرره
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.question_sets (subject_id, kind, period, title, status)
select id, 'expected', 'month1', 'أسئلة الفصل الأول', 'published' from public.subjects where slug = 'physics';
insert into public.question_sets (subject_id, kind, period, title, status)
select id, 'expected', 'month1', 'أسئلة الفصل الثاني', 'draft' from public.subjects where slug = 'physics';
update public.question_sets set status = 'published' where title = 'أسئلة الفصل الثاني';
do $$ begin
  assert (select count(*) from public.notifications where type = 'questions') = 0, 'الأدمن وصله إشعار أسئلة';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where type = 'questions' and user_id = '00000000-0000-0000-0000-00000000000b') = 1,
    'إشعار الأسئلة الجديدة لم يصل أو تكرر';
  assert (select payload ->> 'question_set_id' from public.notifications where type = 'questions' limit 1) is not null, 'الإشعار بلا رابط للأسئلة';
end $$;

-- A7 + B5: المحادثة الخاصة لا تتكرر، والإحصاءات تعمل
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare a uuid; begin
  a := public.start_direct('00000000-0000-0000-0000-00000000000a');
  assert public.start_direct('00000000-0000-0000-0000-00000000000a') = a, 'تكرار المحادثة الخاصة';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (public.admin_stats() ->> 'messages_today')::int >= 1, 'رسائل اليوم';
end $$;
reset role;
select private.daily_cleanup();

-- ٢٦) تذكير الخادم بمهام الإدارة: إشعار واحد للطالب بما عليه غداً، لا يتكرر، ولا يشمل ما أنجزه ولا الأدمن
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.tasks (scope, type, title, due_at) values
  ('school', 'exam', 'الفيزياء', ((now() at time zone 'Asia/Baghdad')::date + 1 + time '09:00') at time zone 'Asia/Baghdad'),
  ('school', 'homework', 'حل تمارين الكيمياء', ((now() at time zone 'Asia/Baghdad')::date + 1 + time '12:00') at time zone 'Asia/Baghdad'),
  ('school', 'homework', 'بعد غد', ((now() at time zone 'Asia/Baghdad')::date + 2 + time '09:00') at time zone 'Asia/Baghdad');
insert into public.tasks (scope, section_id, type, title, due_at)
select 'section', id, 'preparation', 'تحضير شعبة ب', ((now() at time zone 'Asia/Baghdad')::date + 1 + time '09:00') at time zone 'Asia/Baghdad'
from public.sections where name = 'ب';
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.task_status (task_id) select id from public.tasks where title = 'حل تمارين الكيمياء';
reset role;
do $$ begin
  assert private.task_reminders() = 1, 'عدد التذكيرات (الطالب ب فقط)';
  assert private.task_reminders() = 0, 'التذكير تكرر في نفس اليوم';
  assert (select title from public.notifications where type = 'reminder' and user_id = '00000000-0000-0000-0000-00000000000b') = 'غداً: امتحان الفيزياء',
    'التذكير يشمل مهمة منجزة أو مهمة شعبة أخرى أو مهمة بعد غد';
  assert (select count(*) from public.notifications where type = 'reminder' and user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'الأدمن وصله تذكير';
end $$;

select 'ALL RLS TESTS PASSED' as result;
