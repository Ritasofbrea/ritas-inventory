-- Patch 44 follow-up: an append-only audit trail for vendor_week_status
-- decisions. "Order Placed" and "Nothing to order" can now be switched
-- from one to the other in the same week, and "Undo" can clear the mark
-- entirely (deleting the vendor_week_status row, which is exactly what
-- makes the Order List's due-tag/action-buttons logic treat that vendor
-- as pending again -- no change needed there). Both of those overwrite or
-- remove the one current-state row in vendor_week_status itself, so
-- without this, the fact that a decision was ever made/switched/undone
-- would be lost the moment it happened again. This table is purely a
-- durable log of every one of those events -- never updated, never
-- deleted by the app.
--
-- NOT RUN. Review and run in the Supabase SQL Editor.

create table if not exists vendor_week_status_log (
  id uuid default gen_random_uuid() primary key,
  vendor text not null,
  week_start date not null,
  action text not null check (action in ('ordered', 'skipped', 'undone')),
  by text,
  at timestamptz not null default now()
);

create index if not exists idx_vendor_week_status_log_vendor_week
  on vendor_week_status_log(vendor, week_start, at desc);

-- RLS, no policies -- same convention as every other table (the app only
-- ever talks to Supabase with the service-role key).
alter table vendor_week_status_log enable row level security;
