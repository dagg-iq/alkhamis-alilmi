-- =============================================================================
-- سعي — ٤: الدردشة والمساعد الذكي والسجل
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- ---------------------------------------------------------------- الدردشة
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null,
  section_id uuid references public.sections (id) on delete cascade,
  title text,
  only_staff_can_post boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index if not exists conversations_one_school on public.conversations (type) where type = 'school';
create unique index if not exists conversations_one_per_section on public.conversations (section_id) where type = 'section';

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_id_idx on public.conversation_members (user_id);

create table if not exists public.messages (
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
create index if not exists messages_conversation_id_created_at_desc_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------- المساعد الذكي
create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title text not null default 'محادثة جديدة',
  subject_id uuid references public.subjects (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_chats_user_id_updated_at_desc_idx on public.ai_chats (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_chat_id_created_at_idx on public.ai_messages (chat_id, created_at);

create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

create table if not exists public.content_chunks (
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
create index if not exists content_chunks_source_type_source_id_idx on public.content_chunks (source_type, source_id);
create index if not exists content_chunks_using_hnsw_embedding_idx on public.content_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  question text not null,
  choices jsonb not null,
  answer int not null,
  explanation text,
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_chapter_id_idx on public.quiz_questions (chapter_id);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  score int not null,
  total int not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- الإدارة
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_at_desc_idx on public.audit_log (created_at desc);
