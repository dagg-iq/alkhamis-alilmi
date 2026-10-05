-- =============================================================================
-- سعي — المخطط الأساسي
-- المرجع: system/06-database.md
-- =============================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- الأنواع
create type public.user_role as enum ('student', 'moderator', 'admin');
create type public.profile_status as enum ('pending', 'approved', 'rejected', 'banned');
create type public.exam_period as enum ('month1', 'month2', 'midyear', 'month3', 'month4', 'final');
create type public.document_kind as enum ('malzama', 'summary', 'book', 'other');
create type public.question_kind as enum ('expected', 'school_exam');
create type public.publish_status as enum ('draft', 'published');
create type public.task_scope as enum ('personal', 'section', 'school');
create type public.task_type as enum ('homework', 'preparation', 'exam', 'other');
create type public.post_kind as enum ('news', 'holiday', 'exam', 'urgent');
create type public.conversation_type as enum ('school', 'section', 'group', 'direct');
create type public.progress_state as enum ('watched', 'studied', 'reviewed');

-- ---------------------------------------------------------------- المدرسة والمستخدمون
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_label text not null default 'الخامس العلمي',
  created_at timestamptz not null default now()
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  section_id uuid references public.sections (id) on delete set null,
  role public.user_role not null default 'student',
  status public.profile_status not null default 'pending',
  is_verified boolean not null default false,
  bio text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index on public.profiles (status);
create index on public.profiles (section_id);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- دوال الصلاحيات
-- security definer حتى لا تدخل في حلقة مع سياسات RLS على profiles
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'approved'
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'moderator'), false)
$$;

create or replace function public.my_section() returns uuid
language sql stable security definer set search_path = public as $$
  select section_id from public.profiles where id = auth.uid()
$$;

create or replace function public.setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = k
$$;

-- ---------------------------------------------------------------- المحتوى
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  name text not null,
  sort int not null default 0
);
create index on public.books (subject_id);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  number int not null,
  title text not null,
  sort int not null default 0
);
create index on public.chapters (book_id);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject_id uuid references public.subjects (id) on delete set null,
  channel_url text,
  created_at timestamptz not null default now()
);

create table public.lectures (
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
create index on public.lectures (chapter_id);

create table public.documents (
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
create index on public.documents (subject_id);

create table public.question_sets (
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
create index on public.question_sets (subject_id, kind, period);

-- ---------------------------------------------------------------- الدرجات
create table public.grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  period public.exam_period not null,
  score numeric(5, 2) not null check (score >= 0 and score <= 100),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject_id, period)
);

-- ---------------------------------------------------------------- المنظِّم والتقدم
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  scope public.task_scope not null default 'personal',
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  section_id uuid references public.sections (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  type public.task_type not null default 'homework',
  title text not null,
  notes text,
  due_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz not null default now(),
  check (scope <> 'section' or section_id is not null)
);
create index on public.tasks (owner_id);
create index on public.tasks (due_at);

create table public.task_status (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  done_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.progress (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  item_type text not null check (item_type in ('lecture', 'chapter')),
  item_id uuid not null,
  state public.progress_state not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  subject_id uuid references public.subjects (id) on delete set null,
  started_at timestamptz not null default now(),
  minutes int not null check (minutes > 0 and minutes <= 600)
);
create index on public.study_sessions (user_id, started_at);

-- ---------------------------------------------------------------- الأخبار والإشعارات
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  kind public.post_kind not null default 'news',
  title text not null,
  body text not null default '',
  cover_key text,
  section_id uuid references public.sections (id) on delete cascade,
  is_pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.posts (published_at desc);

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- الدردشة
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  section_id uuid references public.sections (id) on delete cascade,
  title text,
  only_staff_can_post boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index conversations_one_school on public.conversations (type) where type = 'school';
create unique index conversations_one_per_section on public.conversations (section_id) where type = 'section';

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  body text,
  reply_to_id uuid references public.messages (id) on delete set null,
  attachment jsonb,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (body is not null or attachment is not null)
);
create index on public.messages (conversation_id, created_at desc);

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------- المساعد الذكي
create table public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title text not null default 'محادثة جديدة',
  subject_id uuid references public.subjects (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_chats (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);
create index on public.ai_messages (chat_id, created_at);

create table public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

create table public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('document', 'question_set')),
  source_id uuid not null,
  subject_id uuid references public.subjects (id) on delete cascade,
  chapter_id uuid references public.chapters (id) on delete set null,
  page int,
  content text not null,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);
create index on public.content_chunks (source_type, source_id);
create index on public.content_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  question text not null,
  choices jsonb not null,
  answer int not null,
  explanation text,
  created_at timestamptz not null default now()
);
create index on public.quiz_questions (chapter_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- الإدارة
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);
