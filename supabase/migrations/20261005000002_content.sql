-- =============================================================================
-- سعي — ٢: المحتوى الدراسي
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- ---------------------------------------------------------------- المحتوى
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  name text not null,
  sort int not null default 0
);
create index if not exists books_subject_id_idx on public.books (subject_id);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  number int not null,
  title text not null,
  sort int not null default 0
);
create index if not exists chapters_book_id_idx on public.chapters (book_id);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject_id uuid references public.subjects (id) on delete set null,
  channel_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  teacher_id uuid references public.teachers (id) on delete set null,
  title text not null,
  youtube_id text not null,
  duration_sec int,
  sort int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists lectures_chapter_id_idx on public.lectures (chapter_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  chapter_id uuid references public.chapters (id) on delete set null,
  teacher_id uuid references public.teachers (id) on delete set null,
  kind public.document_kind not null default 'malzama',
  title text not null,
  file_key text not null,
  size_bytes bigint,
  pages int,
  sort int not null default 0,
  is_published boolean not null default true,
  -- فهرسة المساعد الذكي
  ingested_pages int not null default 0,
  ingest_status text not null default 'none' check (ingest_status in ('none', 'running', 'done', 'error')),
  ingest_error text,
  gemini_file_uri text,
  gemini_file_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists documents_subject_id_idx on public.documents (subject_id);

create table if not exists public.question_sets (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  kind public.question_kind not null,
  period public.exam_period not null,
  section_id uuid references public.sections (id) on delete set null,
  title text not null,
  source text,
  content_md text,
  pdf_key text,
  scan_keys text[] not null default '{}',
  status public.publish_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists question_sets_subject_id_kind_period_idx on public.question_sets (subject_id, kind, period);
