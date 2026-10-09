-- 14: الجداول (أسبوعي، امتحانات، أي جدول مخصص) + حفظ تفضيلات الطالب على حسابه
-- آمن لإعادة التشغيل (يُطبَّق في كل نشر).

-- ---------------------------------------------------------------- تفضيلات الطالب على الحساب
-- الهدف (نجاح/إعفاء)، المظهر، إعدادات المؤقت، مظهر الويدجتات: كانت على الهاتف فتضيع عند الحذف وإعادة التثبيت
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- الجداول
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  kind text not null default 'weekly' check (kind in ('weekly', 'exam', 'custom')),
  -- null = لكل الشعب
  section_id uuid references public.sections (id) on delete set null,
  is_published boolean not null default false,
  sort int not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists schedules_kind_sort_idx on public.schedules (kind, sort);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  -- الأسبوعي: رقم اليوم (٠ الأحد … ٦ السبت)، والامتحانات/المخصص: التاريخ
  day smallint check (day between 0 and 6),
  on_date date,
  -- رقم الحصة أو ترتيب الصف
  sort int not null default 0,
  start_time text check (start_time is null or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text check (end_time is null or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  subject_id uuid references public.subjects (id) on delete set null,
  title text,
  teacher text,
  place text,
  note text
);
create index if not exists schedule_items_schedule_idx on public.schedule_items (schedule_id, day, on_date, sort);

alter table public.schedules enable row level security;
alter table public.schedule_items enable row level security;

drop policy if exists "read published schedules" on public.schedules;
create policy "read published schedules" on public.schedules for select to authenticated
  using (
    public.is_staff()
    or (public.is_approved() and is_published
        and (section_id is null or section_id = (select p.section_id from public.profiles p where p.id = auth.uid())))
  );
drop policy if exists "staff write schedules" on public.schedules;
create policy "staff write schedules" on public.schedules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "read schedule items" on public.schedule_items;
create policy "read schedule items" on public.schedule_items for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id));
drop policy if exists "staff write schedule items" on public.schedule_items;
create policy "staff write schedule items" on public.schedule_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select on public.schedules, public.schedule_items to authenticated;
grant insert, update, delete on public.schedules, public.schedule_items to authenticated;

-- ---------------------------------------------------------------- إعدادات الجدول الذكي
-- switch_after: بعد هذه الساعة يعرض الجدول اليوم التالي للدوام (الدوام ٨ ← ١٢ تقريباً)
insert into public.app_settings (key, value) values
  ('schedule', '{"school_days": [0, 1, 2, 3, 4], "start": "08:00", "end": "12:00", "switch_after": "09:00"}')
on conflict (key) do nothing;
