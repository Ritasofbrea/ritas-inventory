-- Split orders by vendor: every new "ordered" row in order_history records
-- which vendor it belongs to (the same key vendorKeyForItem() in
-- src/lib/vendor-schedule.ts produces: 'bunzl', 'balford', 'other', ...),
-- so each placed order can later be matched against one vendor invoice.
--
-- Nullable, no default, no backfill: every existing row keeps vendor = null
-- and shows as "Unknown vendor" in the app. Receipt rows (received /
-- will_call / short) are not given a vendor by the app either.
--
-- Safe to re-run. Adding a nullable column changes nothing for the code
-- already running in production (it reads order_history with select '*',
-- so an extra column is simply ignored), which is why this runs BEFORE the
-- app code that writes it is pushed.
--
-- NOT RUN. Run in the Supabase SQL Editor.

alter table order_history
  add column if not exists vendor text;

-- Check: should return exactly one row, data_type = 'text', is_nullable = 'YES'.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'order_history'
  and column_name = 'vendor';
