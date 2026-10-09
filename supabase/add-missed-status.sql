-- Adds a 'missed' status so open tasks from past days stop stacking up in
-- Today's Tasks and instead roll into a separate, read-only, owner-only record.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

-- Allow 'missed' alongside the existing 'open' / 'done'
alter table task_instances drop constraint task_instances_status_check;
alter table task_instances add constraint task_instances_status_check
  check (status in ('open', 'done', 'missed'));

-- Missed means never completed: same null-fields requirement as 'open'
alter table task_instances drop constraint instance_done_fields;
alter table task_instances add constraint instance_done_fields check (
  (status in ('open', 'missed') and completed_by is null and completed_at is null) or
  (status = 'done' and completed_by is not null and completed_at is not null)
);

-- The "can't be done without a photo" rule only applies when actually marking done
alter table task_instances drop constraint instance_photo_before_done;
alter table task_instances add constraint instance_photo_before_done check (
  status != 'done' or not photo_required or photo_url is not null
);
