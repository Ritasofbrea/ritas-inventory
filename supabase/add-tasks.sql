-- To-Do / shared team checklist
-- Run in the Supabase SQL Editor. Creates staff, task_templates, task_instances,
-- the public task-photos storage bucket, and seeds the staff list.

-- Staff list for the name picker (owner-managed; deactivate instead of deleting)
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Recurring task definitions. One-off tasks skip this table entirely.
create table task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  recurrence text not null check (recurrence in ('none', 'daily', 'weekly', 'custom')),
  weekday int check (weekday between 0 and 6),            -- 0=Monday .. 6=Sunday
  custom_days int[],                                       -- same 0=Monday .. 6=Sunday numbering
  active boolean not null default true,
  photo_required boolean not null default false,
  photo_allowed boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  -- weekday / custom_days must match the recurrence type
  constraint template_recurrence_fields check (
    (recurrence in ('none', 'daily') and weekday is null and custom_days is null) or
    (recurrence = 'weekly' and weekday is not null and custom_days is null) or
    (recurrence = 'custom' and weekday is null and cardinality(custom_days) > 0
       and custom_days <@ array[0,1,2,3,4,5,6])
  ),
  constraint template_photo_flags check (not photo_required or photo_allowed)
);

-- Actual tasks people see and check off. template_id is null for one-off tasks.
create table task_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references task_templates(id),
  title text not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by text not null,
  completed_by text,
  completed_at timestamptz,
  photo_url text,
  photo_required boolean not null default false,
  photo_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  -- done means a name and time exist; open means neither does
  constraint instance_done_fields check (
    (status = 'open' and completed_by is null and completed_at is null) or
    (status = 'done' and completed_by is not null and completed_at is not null)
  ),
  constraint instance_photo_flags check (not photo_required or photo_allowed),
  -- a photo-required task can't be marked done without a photo
  constraint instance_photo_before_done check (status = 'open' or not photo_required or photo_url is not null)
);

create index on task_instances (due_date);
create index on task_instances (status, due_date);

-- One instance per template per day, even if the cron route is called concurrently
create unique index task_instances_template_day_uniq
  on task_instances (template_id, due_date) where template_id is not null;

-- Public bucket for task photos (uploads go through server-issued signed upload URLs)
insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', true)
on conflict (id) do nothing;

-- Seed staff
insert into staff (name) values
  ('Chloe Espinosa'),
  ('Dru Jaime'),
  ('Jaidyn Young'),
  ('Jocelyn Maldonado'),
  ('Joshua Castro'),
  ('Melek Hernandez'),
  ('Ronnie Lemos'),
  ('Taylor Adams'),
  ('Valerie Morrow')
on conflict (name) do nothing;
