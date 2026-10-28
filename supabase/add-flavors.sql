-- Weekly flavor planning (patch 20). Run in the Supabase SQL Editor.

create table flavors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per Monday-start week that's had at least one slot touched.
create table flavor_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  created_at timestamptz not null default now()
);

-- Up to 12 rows per week — a slot only exists once it's been filled; clearing
-- it deletes the row rather than leaving a null-flavor row behind. flavor_name
-- is a snapshot taken at pick time, independent of the catalog (flavor_id
-- goes null on delete below), so a past week's display never breaks even
-- after the catalog entry it used is gone.
create table flavor_week_slots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references flavor_weeks(id) on delete cascade,
  slot_number integer not null check (slot_number between 1 and 12),
  flavor_id uuid references flavors(id) on delete set null,
  flavor_name text not null,
  updated_at timestamptz not null default now(),
  unique (week_id, slot_number)
);

create index on flavor_week_slots (week_id);
