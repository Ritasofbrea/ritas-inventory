-- Adds due times: one default due time per named checklist, with the option
-- for an individual item (in a checklist, or standalone) to override it.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

-- One row per named checklist, holding its default due time.
-- due_time is nullable - null means "no due time set", so nothing shows as
-- overdue on this basis until the owner actually sets one.
create table checklists (
  name text primary key,
  due_time time
);

insert into checklists (name) values
  ('Opening Checklist'),
  ('Closing Checklist'),
  ('Time to Lean, Time to Clean')
on conflict (name) do nothing;

-- Item-level override. Null = inherit the checklist's due_time (for items
-- inside a named checklist), or "no due time" (for standalone tasks, which
-- have no checklist to inherit from).
alter table task_templates add column due_time time;
alter table task_instances add column due_time time;
