-- Replaces the single shared Shift Lead PIN with individual, named shift
-- lead PINs, same pattern as the owners table. Run in the Supabase SQL
-- Editor before deploying the code that uses it.

create table shift_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- IMPORTANT: replace with your actual current shift leads and a real PIN
-- for each before running, so existing people can still log in after cutover.
insert into shift_leads (name, pin) values
  ('Valerie Morrow', '8801');
  -- add one line per current shift lead

-- The old shared shift_lead row in the pins table is superseded by the above.
delete from pins where name = 'shift_lead';
