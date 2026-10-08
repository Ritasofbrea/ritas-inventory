-- Data correction: the "Clean Batch Machines" template (predates the checklist
-- work) has created_by = 'Valerie Morrow', a staff name rather than one of the
-- three "Added by" values (Josh/Gina/Valerie). That leaked into the Edit form's
-- "Added by" dropdown via a since-removed fallback that showed a template's
-- current value even when it wasn't one of the three. Fixes both the template
-- and any task_instances already generated from it.
update task_templates
set created_by = 'Valerie'
where created_by = 'Valerie Morrow';

update task_instances
set created_by = 'Valerie'
where created_by = 'Valerie Morrow';
