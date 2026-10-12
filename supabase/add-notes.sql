-- Sticky notes for the To-Do screen. Visible to everyone, anyone can add one,
-- only owners/shift leads can delete. Run in the Supabase SQL Editor before
-- deploying the code that uses it.

create table notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index on notes (created_at);
