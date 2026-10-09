-- 13: مادة اللغة الكردية + كتابا الإنكليزي (الطالب والنشاط) + إعدادات الفهرسة
-- آمن لإعادة التشغيل (يُطبَّق في كل نشر).

insert into public.subjects (name, slug, icon, sort) values
  ('اللغة الكردية', 'kurdish', 'book', 9)
on conflict (slug) do nothing;

-- لكل مادة كتاب واحد على الأقل
insert into public.books (subject_id, name, sort)
select s.id, 'الكتاب', 1 from public.subjects s
where s.slug = 'kurdish' and not exists (select 1 from public.books b where b.subject_id = s.id);

-- الإنكليزي: كتاب الطالب وكتاب النشاط (الكتاب الأول كان اسمه «الكتاب»)
update public.books b set name = 'كتاب الطالب'
from public.subjects s
where b.subject_id = s.id and s.slug = 'english' and b.name = 'الكتاب'
  and not exists (select 1 from public.books x where x.subject_id = s.id and x.name = 'كتاب الطالب');
insert into public.books (subject_id, name, sort)
select s.id, 'كتاب النشاط', 2 from public.subjects s
where s.slug = 'english' and not exists (select 1 from public.books b where b.subject_id = s.id and b.name = 'كتاب النشاط');

-- العربي جزءان: الأول قبل نصف السنة والثاني بعده
update public.books b set name = 'الجزء الأول (قبل نصف السنة)'
from public.subjects s
where b.subject_id = s.id and s.slug = 'arabic' and b.name = 'الجزء الأول';
update public.books b set name = 'الجزء الثاني (بعد نصف السنة)'
from public.subjects s
where b.subject_id = s.id and s.slug = 'arabic' and b.name = 'الجزء الثاني';
