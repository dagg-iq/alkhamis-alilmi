-- 16: إصلاح أمني — الطالب كان يستطيع تعديل مهمته الخاصة لتصبح «للمدرسة» أو «للشعبة» فتظهر لكل الطلاب
-- (الإنشاء كان محمياً، لكن التعديل لم يكن). آمن لإعادة التشغيل.
drop policy if exists "update own tasks" on public.tasks;
create policy "update own tasks" on public.tasks for update to authenticated
  using (owner_id = auth.uid() or (scope <> 'personal' and public.is_admin()))
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and (scope = 'personal' or public.is_staff()))
  );
