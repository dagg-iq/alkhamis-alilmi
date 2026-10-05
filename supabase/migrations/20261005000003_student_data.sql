-- =============================================================================
-- سعي — ٣: الدرجات والمنظِّم والأخبار
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

-- ---------------------------------------------------------------- الدرجات
create table if not exists public.grades (
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
create table if not exists public.tasks (
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
create index if not exists tasks_owner_id_idx on public.tasks (owner_id);
create index if not exists tasks_due_at_idx on public.tasks (due_at);

create table if not exists public.task_status (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  done_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table if not exists public.progress (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  item_type text not null check (item_type in ('lecture', 'chapter')),
  item_id uuid not null,
  state public.progress_state not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  subject_id uuid references public.subjects (id) on delete set null,
  started_at timestamptz not null default now(),
  minutes int not null check (minutes > 0 and minutes <= 600)
);
create index if not exists study_sessions_user_id_started_at_idx on public.study_sessions (user_id, started_at);

-- ---------------------------------------------------------------- الأخبار والإشعارات
create table if not exists public.posts (
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
create index if not exists posts_published_at_desc_idx on public.posts (published_at desc);

create table if not exists public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_id_created_at_desc_idx on public.notifications (user_id, created_at desc);
