-- Adds an "acknowledgment required" flag to notes, with a tracked list of
-- who acknowledged and when. Separate from the general note_replies thread.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

alter table notes add column requires_ack boolean not null default false;

create table note_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  staff_name text not null,
  acknowledged_at timestamptz not null default now(),
  unique (note_id, staff_name)
);

create index on note_acknowledgments (note_id);
