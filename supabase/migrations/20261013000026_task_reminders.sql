-- 26: تذكير تلقائي من الخادم بامتحانات وواجبات الإدارة (المهام غير الشخصية).
-- كل يوم الساعة ٨ مساءً بتوقيت بغداد: إشعار واحد لكل طالب بما عليه غداً («غداً: امتحان الفيزياء»)،
-- إلا ما أنجزه. يصل ولو لم يفتح الطالب التطبيق، وإن حذف المشرف المهمة أو غيّر موعدها يتبعه التذكير تلقائياً.
-- (المهام الشخصية لها تذكير على هاتف الطالب نفسه.) آمن لإعادة التشغيل.

create or replace function private.task_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  tomorrow date := (now() at time zone 'Asia/Baghdad')::date + 1;
  n int;
begin
  with due as (
    select p.id as user_id, t.id as task_id, t.due_at,
           case t.type when 'exam' then 'امتحان ' when 'homework' then 'واجب ' when 'preparation' then 'تحضير ' else '' end || t.title as label,
           t.type = 'exam' as is_exam
    from public.tasks t
    join public.profiles p on p.status = 'approved' and p.role = 'student'
      and (t.scope = 'school' or p.section_id = t.section_id)
    where t.scope <> 'personal'
      and (t.due_at at time zone 'Asia/Baghdad')::date = tomorrow
      and not exists (select 1 from public.task_status s where s.task_id = t.id and s.user_id = p.id)
      -- مرة واحدة لكل طالب في اليوم
      and not exists (
        select 1 from public.notifications x
        where x.user_id = p.id and x.type = 'reminder' and x.payload ->> 'day' = tomorrow::text
      )
  )
  insert into public.notifications (user_id, type, title, body, payload)
  select user_id,
         'reminder',
         case when count(*) = 1 then 'غداً: ' || min(label)
              when bool_or(is_exam) then 'غداً عندك امتحان و' || translate((count(*) - 1)::text, '0123456789', '٠١٢٣٤٥٦٧٨٩') || ' مهام أخرى'
              else 'غداً عندك ' || translate(count(*)::text, '0123456789', '٠١٢٣٤٥٦٧٨٩') || ' مهام' end,
         left(case when count(*) = 1 then 'راجع جيداً — اسعَ تُعفَ.' else string_agg(label, ' · ' order by is_exam desc, due_at) end, 300),
         jsonb_build_object('task_id', (array_agg(task_id order by is_exam desc, due_at))[1], 'day', tomorrow)
  from due
  group by user_id;
  get diagnostics n = row_count;
  return n;
exception when others then
  raise notice 'task_reminders: %', sqlerrm;
  return 0;
end $$;
revoke all on function private.task_reminders() from public;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'saey-task-reminders';
  -- ١٧:٠٠ UTC = ٨:٠٠ مساءً بغداد (بغداد بلا توقيت صيفي)
  perform cron.schedule('saey-task-reminders', '0 17 * * *', 'select private.task_reminders()');
exception when others then
  raise notice 'pg_cron غير متاح هنا (طبيعي في الاختبار المحلي): %', sqlerrm;
end $$;
