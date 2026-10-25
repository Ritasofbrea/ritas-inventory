-- Adds follow-up replies to notes, so someone other than the original author
-- can add info to a note without editing/overwriting the original text.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

create table note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  content text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index on note_replies (note_id, created_at);
