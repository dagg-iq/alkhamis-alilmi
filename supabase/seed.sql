-- =============================================================================
-- سعي — البيانات الأولية: المدرسة، الشعب، المواد الثمانية، الإعدادات
-- يُشغَّل مرة واحدة بعد الـ migrations (انظر system/08-setup-guide.md)
-- =============================================================================

-- آمن لإعادة التشغيل: لا يكرر البيانات
insert into public.schools (name, grade_label)
select 'إعدادية الشهاب للبنين', 'الخامس العلمي'
where not exists (select 1 from public.schools);

insert into public.sections (school_id, name, sort)
select s.id, x.name, x.sort
from (select id from public.schools order by created_at limit 1) s,
     (values ('أ', 1), ('ب', 2), ('ج', 3), ('د', 4), ('هـ', 5)) as x (name, sort)
on conflict (school_id, name) do nothing;

insert into public.subjects (name, slug, icon, sort) values
  ('التربية الإسلامية', 'islamic', 'moon', 1),
  ('اللغة العربية', 'arabic', 'feather', 2),
  ('اللغة الإنكليزية', 'english', 'globe', 3),
  ('الرياضيات', 'math', 'sigma', 4),
  ('الفيزياء', 'physics', 'atom', 5),
  ('الكيمياء', 'chemistry', 'flask', 6),
  ('الأحياء', 'biology', 'leaf', 7),
  ('الحاسوب', 'computer', 'cpu', 8)
on conflict (slug) do nothing;

-- كل مادة لها كتاب واحد، والعربي جزءان
insert into public.books (subject_id, name, sort)
select s.id, 'الكتاب', 1 from public.subjects s
where s.slug <> 'arabic' and not exists (select 1 from public.books b where b.subject_id = s.id);
insert into public.books (subject_id, name, sort)
select s.id, x.name, x.sort from public.subjects s, (values ('الجزء الأول', 1), ('الجزء الثاني', 2)) as x (name, sort)
where s.slug = 'arabic' and not exists (select 1 from public.books b where b.subject_id = s.id and b.name = x.name);

insert into public.app_settings (key, value) values
  ('grading', '{"individual_exempt": 90, "general_avg": 85, "general_min": 75, "pass": 50, "round": "half_up"}'),
  ('ai', '{"daily_limit": 20, "model": "gemini-2.5-flash", "lite_model": "gemini-2.5-flash-lite", "enabled": true}'),
  ('registration', '{"open": true}'),
  ('chat', '{"direct_messages": true}'),
  ('academic_year', '{"label": "2026-2027"}')
on conflict (key) do nothing;

-- محادثة المدرسة
select public.ensure_school_conversation();
