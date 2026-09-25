-- Separate "who it's for" (assigned_to) from "who added it" (created_by) on tasks.
-- Run in the Supabase SQL Editor BEFORE deploying the code that uses it.
-- Existing rows default to 'Everyone'; the default also keeps the currently
-- deployed app working (its inserts simply don't mention the new column).
alter table task_templates add column assigned_to text not null default 'Everyone';
alter table task_instances add column assigned_to text not null default 'Everyone';
