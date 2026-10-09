-- 19: إصلاح «تعذّر تغيير الصورة — new row violates row-level security policy».
-- سياسات الصور الشخصية (كانت في ملف ١٠ الذي لا يُطبَّق تلقائياً) + سياسة القراءة التي يحتاجها الرفع.
-- كل طالب يكتب في مجلده فقط: avatars/<معرّفه>/… . آمن لإعادة التشغيل. (لا يُشغَّل في الاختبار المحلي: يحتاج Supabase Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar read" on storage.objects;
create policy "avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
