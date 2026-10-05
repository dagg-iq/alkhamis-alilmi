-- =============================================================================
-- سعي — ١: الأنواع والمستخدمين ودوال الصلاحيات
-- آمن لإعادة التشغيل أكثر من مرة
-- =============================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- الأنواع
do $$ begin create type public.user_role as enum ('student', 'moderator', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.profile_status as enum ('pending', 'approved', 'rejected', 'banned'); exception when duplicate_object then null; end $$;
do $$ begin create type public.exam_period as enum ('month1', 'month2', 'midyear', 'month3', 'month4', 'final'); exception when duplicate_object then null; end $$;
do $$ begin create type public.document_kind as enum ('malzama', 'summary', 'book', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.question_kind as enum ('expected', 'school_exam'); exception when duplicate_object then null; end $$;
do $$ begin create type public.publish_status as enum ('draft', 'published'); exception when duplicate_object then null; end $$;
do $$ begin create type public.task_scope as enum ('personal', 'section', 'school'); exception when duplicate_object then null; end $$;
do $$ begin create type public.task_type as enum ('homework', 'preparation', 'exam', 'other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.post_kind as enum ('news', 'holiday', 'exam', 'urgent'); exception when duplicate_object then null; end $$;
do $$ begin create type public.conversation_type as enum ('school', 'section', 'group', 'direct'); exception when duplicate_object then null; end $$;
do $$ begin create type public.progress_state as enum ('watched', 'studied', 'reviewed'); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- المدرسة والمستخدمون
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_label text not null default 'الخامس العلمي',
  created_at timestamptz not null default now()
);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.profiles (
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
create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_section_id_idx on public.profiles (section_id);

create table if not exists public.app_settings (
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
