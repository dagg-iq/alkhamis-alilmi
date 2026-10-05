-- =============================================================================
-- سعي — الصلاحيات (Row Level Security)
-- القاعدة: من لم يوافق عليه الأدمن لا يرى شيئاً سوى ملفه الشخصي والإعدادات العامة.
-- =============================================================================

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

-- ---------------------------------------------------------------- المهام
create policy "read tasks" on public.tasks for select to authenticated using (
  public.is_approved() and (
    owner_id = auth.uid()
    or scope = 'school'
    or (scope = 'section' and section_id = public.my_section())
    or (scope <> 'personal' and public.is_staff())
  )
);
create policy "create tasks" on public.tasks for insert to authenticated with check (
  public.is_approved() and owner_id = auth.uid() and (scope = 'personal' or public.is_staff())
);
create policy "update own tasks" on public.tasks for update to authenticated
  using (owner_id = auth.uid() or (scope <> 'personal' and public.is_admin()))
  with check (owner_id = auth.uid() or public.is_admin());
create policy "delete own tasks" on public.tasks for delete to authenticated
  using (owner_id = auth.uid() or (scope <> 'personal' and public.is_admin()));

create policy "own task status" on public.task_status for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------- التقدم والدراسة
create policy "own progress" on public.progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_approved());
create policy "own study sessions" on public.study_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_approved());
create policy "admin read study sessions" on public.study_sessions for select to authenticated using (public.is_admin());
create policy "admin read progress" on public.progress for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- الأخبار
create policy "read posts" on public.posts for select to authenticated using (
  public.is_staff()
  or (public.is_approved() and published_at <= now() and (section_id is null or section_id = public.my_section()))
);
create policy "staff write posts" on public.posts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------- الإشعارات
create policy "own push tokens" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own notifications update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications delete" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- الدردشة
create or replace function public.is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and user_id = auth.uid()
  ) and public.is_approved()
$$;

create policy "members read conversations" on public.conversations for select to authenticated
  using (public.is_member(id) or public.is_admin());
create policy "staff manage conversations" on public.conversations for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "members read members" on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id) or public.is_admin());
create policy "update own membership" on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave group" on public.conversation_members for delete to authenticated using (
  user_id = auth.uid()
  and exists (select 1 from public.conversations c where c.id = conversation_id and c.type in ('group', 'direct'))
);
create policy "staff manage members" on public.conversation_members for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "members read messages" on public.messages for select to authenticated
  using (public.is_member(conversation_id) or public.is_admin());
create policy "members send messages" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and public.is_member(conversation_id)
  and (
    public.is_staff()
    or not exists (select 1 from public.conversations c where c.id = conversation_id and c.only_staff_can_post)
  )
);
create policy "edit own messages" on public.messages for update to authenticated
  using (sender_id = auth.uid() or public.is_staff()) with check (true);
create policy "staff delete messages" on public.messages for delete to authenticated using (public.is_staff());

create policy "members read reactions" on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id))
);
create policy "own reactions" on public.message_reactions for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id))
);
create policy "remove own reactions" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- المساعد الذكي (الكتابة تتم من الخادم فقط)
create policy "own ai chats" on public.ai_chats for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "delete own ai chats" on public.ai_chats for delete to authenticated using (user_id = auth.uid());
create policy "own ai messages" on public.ai_messages for select to authenticated using (
  exists (select 1 from public.ai_chats c where c.id = chat_id and (c.user_id = auth.uid() or public.is_admin()))
);
create policy "own ai usage" on public.ai_usage for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "staff read chunks" on public.content_chunks for select to authenticated using (public.is_staff());
create policy "staff delete chunks" on public.content_chunks for delete to authenticated using (public.is_staff());

create policy "approved read quiz" on public.quiz_questions for select to authenticated using (public.is_approved());
create policy "staff manage quiz" on public.quiz_questions for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "own quiz attempts" on public.quiz_attempts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_approved());

-- ---------------------------------------------------------------- سجل العمليات
create policy "admin read audit" on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.message_reactions, public.notifications,
      public.conversation_members, public.profiles;
  end if;
end $$;
