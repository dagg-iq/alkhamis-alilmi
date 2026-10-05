-- =============================================================================
-- سعي — ٨: الصلاحيات — المستخدمون والمحتوى والدرجات
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- حذف السياسات السابقة (لإعادة التشغيل بأمان)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename = any (array['schools','sections','profiles','app_settings','subjects','books','chapters','teachers','lectures','documents','question_sets','grades']) loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'schools', 'sections', 'profiles', 'app_settings', 'subjects', 'books', 'chapters', 'teachers', 'lectures',
    'documents', 'question_sets', 'grades', 'tasks', 'task_status', 'progress', 'study_sessions', 'posts',
    'push_tokens', 'notifications', 'conversations', 'conversation_members', 'messages', 'message_reactions',
    'ai_chats', 'ai_messages', 'ai_usage', 'content_chunks', 'quiz_questions', 'quiz_attempts', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- المدرسة والشعب
-- الشعب تُقرأ أثناء التسجيل (قبل الموافقة) لاختيار الشعبة
create policy "read schools" on public.schools for select to authenticated using (true);
create policy "admin schools" on public.schools for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read sections" on public.sections for select to authenticated using (true);
create policy "admin sections" on public.sections for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- الملفات الشخصية
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "approved read approved profiles" on public.profiles for select to authenticated
  using (public.is_approved() and status = 'approved');
create policy "staff read all profiles" on public.profiles for select to authenticated
  using (public.is_staff());
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "admin update profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (true);
create policy "admin delete profiles" on public.profiles for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- الإعدادات
create policy "read settings" on public.app_settings for select to authenticated using (true);
create policy "admin settings" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- المحتوى: قراءة للمعتمَدين، كتابة للأدمن والمشرفين
do $$
declare
  t text;
begin
  foreach t in array array['subjects', 'books', 'chapters', 'teachers'] loop
    execute format('create policy "approved read %1$s" on public.%1$I for select to authenticated using (public.is_approved())', t);
    execute format('create policy "staff write %1$s" on public.%1$I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;

create policy "approved read lectures" on public.lectures for select to authenticated
  using (public.is_approved() and (is_published or public.is_staff()));
create policy "staff write lectures" on public.lectures for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "approved read documents" on public.documents for select to authenticated
  using (public.is_approved() and (is_published or public.is_staff()));
create policy "staff write documents" on public.documents for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "approved read question sets" on public.question_sets for select to authenticated
  using (public.is_approved() and (status = 'published' or public.is_staff()));
create policy "staff write question sets" on public.question_sets for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------- الدرجات: كل طالب درجاته فقط، والأدمن يرى الجميع
create policy "own grades" on public.grades for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());
create policy "admin read grades" on public.grades for select to authenticated using (public.is_admin());
