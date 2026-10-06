-- Data correction, not a schema change: corporate-checklists-seed.sql used
-- created_by = 'Joshua Castro' for all 111 checklist templates, but the app's
-- "Added by" list is just Josh / Gina / Valerie, so these were showing up as
-- outside that list wherever created_by displays (History, Repeating edit form).
--
-- Fixes both task_templates (so future daily-generated copies are correct)
-- and task_instances (so tasks already generated for today are fixed too,
-- rather than waiting for tomorrow's cron). Scoped to the exact bad value, so
-- it can't touch the one checklist template already hand-corrected to 'Josh',
-- or the unrelated older 'Clean Batch Machines' template (created_by =
-- 'Valerie Morrow', predates the checklist work).
update task_templates
set created_by = 'Josh'
where created_by = 'Joshua Castro';

update task_instances
set created_by = 'Josh'
where created_by = 'Joshua Castro';
