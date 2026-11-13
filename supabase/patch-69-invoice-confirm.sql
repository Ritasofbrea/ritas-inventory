-- PATCH 69: confirm an invoice delivery. ONE new column, nothing else.
-- Run in the Supabase SQL editor BEFORE pushing the app code (the confirm
-- routes and the check-off screen read invoices.record_only by name).
--
--   invoices.record_only   true = "filed as record only": the invoice is
--                          marked received (so the duplicate guard protects
--                          its number) but it added NO stock and has no
--                          receipt row. false = a normal confirm (or not
--                          confirmed yet).
--
-- Why a column: a record-only invoice and a normal confirmed one are both
-- status 'received'. Without this flag, "received with no receipt_id"
-- would mean two different things (record only, or a confirm that was cut
-- off mid-save), and the app could not tell them apart.
--
-- Existing rows: every invoice gets record_only = false. No other column
-- on any row changes. invoice_lines is not touched (patch 63 already made
-- qty_received, units_per_invoice_unit, stock_qty_added, code_learned and
-- confirmed_by).
--
-- Idempotent (IF NOT EXISTS). Dry run first, then COMMIT; (or ROLLBACK;).

BEGIN;

-- BEFORE: how many invoices exist, by status
SELECT status, count(*) AS invoices FROM invoices GROUP BY status ORDER BY status;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS record_only BOOLEAN NOT NULL DEFAULT false;

-- AFTER 1: expect 1 row: record_only, boolean, NO, false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'invoices' AND column_name = 'record_only';

-- AFTER 2: same counts as BEFORE, and record_only_true = 0 on every row
SELECT status, count(*) AS invoices, count(*) FILTER (WHERE record_only) AS record_only_true
FROM invoices GROUP BY status ORDER BY status;

-- AFTER 3: the duplicate guard index is still there (expect 1 row)
SELECT indexname FROM pg_indexes WHERE tablename = 'invoices' AND indexname = 'invoices_vendor_number_received_uq';

-- AFTER 4: RLS still on, still no policies (expect true, then 0)
SELECT relrowsecurity FROM pg_class WHERE relname = 'invoices' AND relkind = 'r';
SELECT count(*) AS policy_count FROM pg_policies WHERE tablename = 'invoices';

-- COMMIT;   -- uncomment and run after the "after" results look right (or ROLLBACK;)
