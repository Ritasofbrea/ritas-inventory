-- Patch 36 Phase 1: adds list ordering and turn-off/on to the existing
-- `checklists` table. No new table, no foreign key, no change to
-- task_templates/task_instances -- their existing checklist_name/section/
-- sort_order columns already fully support adding a task to a list and
-- section (see Phase 1 report). Run in the Supabase SQL Editor.
--
-- Idempotent: safe to re-run.

alter table checklists add column if not exists active boolean not null default true;
alter table checklists add column if not exists sort_order int not null default 0;

-- Give the three existing real lists their current display order explicitly
-- -- this is what src/lib/tasks.ts's hardcoded CHECKLIST_ORDER constant
-- encodes today, which the app code will stop using once this column exists.
-- Any other checklist row (there shouldn't be one yet) keeps the column
-- default (0) and sorts after these three, alphabetically, until an owner
-- reorders it from the UI.
update checklists set sort_order = 1 where name = 'Opening Checklist';
update checklists set sort_order = 2 where name = 'Closing Checklist';
update checklists set sort_order = 3 where name = 'Time to Lean, Time to Clean';

-- RLS: already enabled on checklists with no policies (see
-- supabase/enable-rls-all.sql) -- every read/write goes through the
-- server's service-role key, same as every other table. No policy changes
-- needed for these two new columns.
