-- Follow-up to add-tasks.sql / add-task-assigned-to.sql: adds the named-checklist
-- grouping (Opening Checklist, Closing Checklist, Time to Lean, etc.) that Today's
-- Tasks doesn't have yet. Run in the Supabase SQL Editor BEFORE deploying the code
-- that uses it.
--
-- checklist_name/section are null for ordinary standalone to-do items (one-offs
-- and anything not part of a named checklist) - those keep showing as a flat list.
-- Items that belong to a named checklist carry both, and sort_order controls their
-- position within that section.

alter table task_templates add column checklist_name text;
alter table task_templates add column section text;
alter table task_templates add column sort_order int not null default 0;

alter table task_instances add column checklist_name text;
alter table task_instances add column section text;
alter table task_instances add column sort_order int not null default 0;

-- checklist_name and section travel together: either both set or both null
alter table task_templates add constraint template_checklist_fields check (
  (checklist_name is null and section is null) or
  (checklist_name is not null and section is not null)
);

alter table task_instances add constraint instance_checklist_fields check (
  (checklist_name is null and section is null) or
  (checklist_name is not null and section is not null)
);

create index on task_instances (checklist_name);
