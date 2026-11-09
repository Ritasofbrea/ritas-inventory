-- Patch 50 Part C: add-order-history.sql's inline column definition
--   related_order_id UUID REFERENCES order_history(id) ON DELETE SET NULL,
-- documents this as ON DELETE SET NULL, but the LIVE database enforces it
-- as a blocking foreign key instead (confirmed in patch 48's testing:
-- deleting an "ordered" row that a "received"/"will_call" row's
-- related_order_id still points to fails with a 500 -- "update or delete
-- on table order_history violates foreign key constraint
-- order_history_related_order_id_fkey"). This brings the live constraint
-- back in line with the documented, intended design.
--
-- Safe to re-run: drops the constraint if present (whatever its current
-- behavior actually is) and re-adds it as ON DELETE SET NULL. No data is
-- touched -- this only changes what happens on a future delete, not any
-- existing row.
--
-- After this: deleting an "ordered" row just sets related_order_id to
-- null on the "received"/"will_call" row that pointed to it -- nothing
-- else on that row changes (its own type/quantities/notes/resolved status
-- are untouched). This can't make an item wrongly show as "needs
-- ordering": src/lib/order-list-server.ts only reads related_order_id off
-- "received"/"will_call" rows to decide which still-existing "ordered"
-- rows are fulfilled; once the "ordered" row itself is gone, there's no
-- longer any "ordered" row for that id to begin with, so whether the
-- receipt's link is null or not doesn't change what counts as pending.
--
-- Run in the Supabase SQL Editor.

alter table order_history
  drop constraint if exists order_history_related_order_id_fkey;

alter table order_history
  add constraint order_history_related_order_id_fkey
  foreign key (related_order_id) references order_history (id)
  on delete set null;

-- Check: should return exactly one row with delete_rule = 'SET NULL'.
select
  tc.constraint_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
  and tc.constraint_schema = rc.constraint_schema
where tc.table_name = 'order_history'
  and tc.constraint_name = 'order_history_related_order_id_fkey';
