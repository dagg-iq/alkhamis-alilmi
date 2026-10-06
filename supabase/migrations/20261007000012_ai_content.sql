-- المرحلة ب: فهرسة المحاضرات بالدقيقة + حفظ إجابات الأسئلة المتكررة
-- آمن لإعادة التشغيل (يُطبَّق تلقائياً من سير عمل Deploy Supabase)

-- ١) مواضيع كل محاضرة مع وقت بدايتها (يستخرجها Gemini من الفيديو، والأدمن يراجعها)
create table if not exists public.lecture_topics (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  start_sec int not null check (start_sec >= 0),
  title text not null,
  summary text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lecture_topics_lecture_id_start_idx on public.lecture_topics (lecture_id, start_sec);

alter table public.lectures add column if not exists index_status text not null default 'none'
  check (index_status in ('none', 'running', 'done', 'error'));
alter table public.lectures add column if not exists index_error text;
alter table public.lectures add column if not exists indexed_at timestamptz;

alter table public.lecture_topics enable row level security;
drop policy if exists "approved read lecture topics" on public.lecture_topics;
create policy "approved read lecture topics" on public.lecture_topics for select to authenticated
  using (public.is_approved() and exists (
    select 1 from public.lectures l where l.id = lecture_id and (l.is_published or public.is_staff())
  ));
drop policy if exists "staff write lecture topics" on public.lecture_topics;
create policy "staff write lecture topics" on public.lecture_topics for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ٢) مقاطع المحاضرات في بحث المساعد (مع وقت البداية)
alter table public.content_chunks add column if not exists start_sec int;
alter table public.content_chunks drop constraint if exists content_chunks_source_type_check;
alter table public.content_chunks add constraint content_chunks_source_type_check
  check (source_type in ('document', 'question_set', 'lecture'));

-- دالة جديدة (لا نغيّر match_chunks القديمة حتى تبقى migration ٧ صالحة لإعادة التشغيل)
create or replace function public.match_chunks_v2(
  query_embedding extensions.vector(768), match_count int default 8, p_subject uuid default null
)
returns table (id uuid, source_type text, source_id uuid, subject_id uuid, chapter_id uuid, page int, start_sec int, content text, similarity float)
language sql stable set search_path = public, extensions as $$
  select c.id, c.source_type, c.source_id, c.subject_id, c.chapter_id, c.page, c.start_sec, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.content_chunks c
  where c.embedding is not null and (p_subject is null or c.subject_id = p_subject)
  order by c.embedding <=> query_embedding
  limit match_count
$$;
revoke execute on function public.match_chunks_v2(extensions.vector, int, uuid) from public, anon, authenticated;

-- ٣) إجابات محفوظة للأسئلة المتكررة (يوم الامتحان يسأل الجميع نفس السؤال) — للخادم فقط
create table if not exists public.ai_cache (
  key text primary key,
  subject_id uuid references public.subjects (id) on delete cascade,
  question text not null,
  answer text not null,
  sources jsonb,
  hits int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_cache enable row level security;
-- بلا سياسات: لا يقرؤها ولا يكتبها إلا الخادم (service role)
