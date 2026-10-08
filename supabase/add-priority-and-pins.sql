-- Follow-up to add-task-checklist-grouping.sql. Two unrelated additions bundled
-- in one migration since they're both small:
--   1. priority flag for standalone (non-checklist) to-do tasks
--   2. a pins table so PINs can be changed in-app instead of via Vercel env vars
-- Run in the Supabase SQL Editor BEFORE deploying the code that uses either.

-- ---------------------------------------------------------
-- 1. Priority (standalone to-do tasks only; named-checklist items ignore this)
-- ---------------------------------------------------------
alter table task_templates add column priority text not null default 'normal'
  check (priority in ('normal', 'high'));
alter table task_instances add column priority text not null default 'normal'
  check (priority in ('normal', 'high'));

-- ---------------------------------------------------------
-- 2. PINs, moved from env vars to a DB table so they're editable in-app
-- ---------------------------------------------------------
create table pins (
  name text primary key check (name in ('owner', 'shift_lead')),
  value text not null,
  updated_at timestamptz not null default now()
);

-- IMPORTANT: replace these two placeholder values with your actual current
-- NEXT_PUBLIC_OWNER_PIN and NEXT_PUBLIC_SHIFT_LEAD_PIN values before running,
-- so existing logins keep working through the cutover.
insert into pins (name, value) values
  ('owner', '1218'),
  ('shift_lead', '8801');
