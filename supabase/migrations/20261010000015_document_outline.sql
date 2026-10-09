-- 15: فهرس الكتب والملازم (فصول ومواضيع بأرقام الصفحات) + الربط بين الكتاب والملازم + صفحات الملفات
-- آمن لإعادة التشغيل (يُطبَّق في كل نشر).

alter table public.documents add column if not exists outline_status text not null default 'none'
  check (outline_status in ('none', 'running', 'done', 'error'));
alter table public.documents add column if not exists outline_error text;

-- ما قرأه الذكاء الاصطناعي من كل صفحة: رقمها المطبوع وعناوينها (مادة خام لبناء الفهرس)
create table if not exists public.document_pages (
  document_id uuid not null references public.documents (id) on delete cascade,
  page int not null check (page >= 1),
  printed text,
  headings jsonb not null default '[]'::jsonb,
  digest text,
  -- نص الصفحة كاملاً (يقرأه المساعد عند السؤال عن صفحة أو فصل محدد)
  text text,
  primary key (document_id, page)
);
alter table public.document_pages add column if not exists text text;

-- الفهرس: المستوى ١ فصل، والمستوى ٢ موضوع داخل فصل
create table if not exists public.document_outline (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  parent_id uuid references public.document_outline (id) on delete cascade,
  level smallint not null check (level in (1, 2)),
  title text not null,
  start_page int not null check (start_page >= 1),
  end_page int check (end_page is null or end_page >= start_page),
  sort int not null default 0,
  summary text,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);
create index if not exists document_outline_doc_idx on public.document_outline (document_id, sort);
create index if not exists document_outline_embedding_idx on public.document_outline using hnsw (embedding extensions.vector_cosine_ops);

alter table public.document_pages enable row level security;
alter table public.document_outline enable row level security;

drop policy if exists "read document pages" on public.document_pages;
create policy "read document pages" on public.document_pages for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_approved() and (d.is_published or public.is_staff())));
drop policy if exists "staff write document pages" on public.document_pages;
create policy "staff write document pages" on public.document_pages for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "read document outline" on public.document_outline;
create policy "read document outline" on public.document_outline for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_approved() and (d.is_published or public.is_staff())));
drop policy if exists "staff write document outline" on public.document_outline;
create policy "staff write document outline" on public.document_outline for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select on public.document_pages, public.document_outline to authenticated;
grant insert, update, delete on public.document_pages, public.document_outline to authenticated;

-- نفس الموضوع في كتب/ملازم أخرى للمادة نفسها (أقرب موضوع في كل ملف، بالتشابه الدلالي لعناوين الفهرس)
create or replace function public.related_topics(p_outline uuid, p_min float default 0.6)
returns table (document_id uuid, document_title text, document_kind text, outline_id uuid, title text, start_page int, end_page int, similarity float)
language sql stable security definer set search_path = public, extensions as $$
  with t as (
    select o.document_id, o.embedding, d.subject_id
    from public.document_outline o join public.documents d on d.id = o.document_id
    where o.id = p_outline and o.embedding is not null and public.is_approved() and (d.is_published or public.is_staff())
  ), best as (
    select distinct on (o.document_id)
      o.document_id, d.title as document_title, d.kind::text as document_kind, o.id as outline_id, o.title, o.start_page, o.end_page,
      1 - (o.embedding <=> t.embedding) as similarity
    from t
    join public.documents d on d.subject_id = t.subject_id and d.id <> t.document_id and d.is_published
    join public.document_outline o on o.document_id = d.id and o.embedding is not null
    order by o.document_id, o.embedding <=> t.embedding
  )
  select * from best where similarity >= p_min order by similarity desc limit 6
$$;
grant execute on function public.related_topics(uuid, float) to authenticated;

-- بحث المساعد مع إمكانية حصره بملف واحد (لأسئلة «اشرح الفصل ٣ من الملزمة…»)
create or replace function public.match_chunks_v3(
  query_embedding extensions.vector(768), match_count int default 8, p_subject uuid default null, p_document uuid default null
)
returns table (id uuid, source_type text, source_id uuid, subject_id uuid, chapter_id uuid, page int, start_sec int, content text, similarity float)
language sql stable set search_path = public, extensions as $$
  select c.id, c.source_type, c.source_id, c.subject_id, c.chapter_id, c.page, c.start_sec, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.content_chunks c
  where c.embedding is not null and (p_subject is null or c.subject_id = p_subject)
    and (p_document is null or (c.source_type = 'document' and c.source_id = p_document))
  order by c.embedding <=> query_embedding
  limit match_count
$$;
revoke execute on function public.match_chunks_v3(extensions.vector, int, uuid, uuid) from public, anon, authenticated;
