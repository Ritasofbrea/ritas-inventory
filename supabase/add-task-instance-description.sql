-- Follow-up to add-tasks.sql: task_instances had no place to store a description,
-- so one-off task descriptions (and recurring templates' descriptions on their
-- daily copies) would be lost. Run in the Supabase SQL Editor.
alter table task_instances add column description text;
