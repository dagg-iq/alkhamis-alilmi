-- =============================================================================
-- سعي — البيانات الأولية: المدرسة، الشعب، المواد الثمانية، الإعدادات
-- يُشغَّل مرة واحدة بعد الـ migrations (انظر system/08-setup-guide.md)
-- =============================================================================

insert into public.schools (name, grade_label) values ('إعدادية الشهاب للبنين', 'الخامس العلمي');

insert into public.sections (school_id, name, sort)
select s.id, x.name, x.sort
from public.schools s,
     (values ('أ', 1), ('ب', 2), ('ج', 3), ('د', 4), ('هـ', 5)) as x (name, sort);

insert into public.subjects (name, slug, icon, sort) values
  ('التربية الإسلامية', 'islamic', 'moon', 1),
  ('اللغة العربية', 'arabic', 'feather', 2),
  ('اللغة الإنكليزية', 'english', 'globe', 3),
  ('الرياضيات', 'math', 'sigma', 4),
  ('الفيزياء', 'physics', 'atom', 5),
  ('الكيمياء', 'chemistry', 'flask', 6),
  ('الأحياء', 'biology', 'leaf', 7),
  ('الحاسوب', 'computer', 'cpu', 8);

-- كل مادة لها كتاب واحد، والعربي جزءان
insert into public.books (subject_id, name, sort)
select id, 'الكتاب', 1 from public.subjects where slug <> 'arabic';
insert into public.books (subject_id, name, sort)
select id, x.name, x.sort from public.subjects, (values ('الجزء الأول', 1), ('الجزء الثاني', 2)) as x (name, sort)
where slug = 'arabic';

insert into public.app_settings (key, value) values
  ('grading', '{"individual_exempt": 90, "general_avg": 85, "general_min": 75, "pass": 50, "round": "half_up"}'),
  ('ai', '{"daily_limit": 20, "model": "gemini-2.5-flash", "lite_model": "gemini-2.5-flash-lite", "enabled": true}'),
  ('registration', '{"open": true}'),
  ('chat', '{"direct_messages": true}'),
  ('academic_year', '{"label": "2026-2027"}')
on conflict (key) do nothing;

-- محادثة المدرسة
select public.ensure_school_conversation();
