-- Adds archive tracking to notes so Delete becomes "archive to history"
-- instead of permanently destroying records (needed for acknowledgment
-- record-keeping). Run in the Supabase SQL Editor before deploying.

alter table notes add column archived boolean not null default false;
alter table notes add column archived_at timestamptz;

create index on notes (archived);
