-- Backfill: schema that was applied live in Supabase (patches 28, 29, 32) but never saved as a file in the repo.
-- This is a RECORD of what is already live. Running it is harmless: everything is "if not exists" / re-applies the same rules.
-- Do not edit the live database from this file by hand. New changes get their own new files.

-- Patch 28: task steps
alter table public.task_templates
  add column if not exists step_style text not null default 'none'
  check (step_style in ('none', 'reference', 'checklist'));

create table if not exists public.task_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  sort_order integer not null default 0,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.task_instance_step_checks (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.task_instances(id) on delete cascade,
  step_id uuid not null references public.task_template_steps(id) on delete cascade,
  checked_by text,
  checked_at timestamptz not null default now(),
  unique (instance_id, step_id)
);

alter table public.task_template_steps enable row level security;
alter table public.task_instance_step_checks enable row level security;

-- Patch 29: PIN login rate limiting
create table if not exists public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_ip_attempted_at_idx
  on public.login_attempts (ip, attempted_at desc);

alter table public.login_attempts enable row level security;

-- Patch 32: Soft Serve and Hand Scoop Custard flavor sections
alter table public.flavors drop constraint if exists flavors_type_check;
alter table public.flavors add constraint flavors_type_check
  check (type = any (array['italian_ice', 'cream_ice', 'sugar_free', 'soft_serve', 'hs_custard']));

alter table public.flavor_week_slots drop constraint if exists flavor_week_slots_flavor_type_check;
alter table public.flavor_week_slots add constraint flavor_week_slots_flavor_type_check
  check (flavor_type = any (array['italian_ice', 'cream_ice', 'sugar_free', 'soft_serve', 'hs_custard']));

alter table public.flavor_week_slots drop constraint if exists flavor_week_slots_slot_number_check;
alter table public.flavor_week_slots add constraint flavor_week_slots_slot_number_check
  check ((slot_number between 1 and 12) or (slot_number between 101 and 110) or (slot_number between 201 and 220));
