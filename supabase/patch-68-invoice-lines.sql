-- PATCH 68: invoice matching + check-off. Columns on invoice_lines only.
-- invoice_lines is still empty (patch 65 only filled invoices.raw_extraction),
-- so nothing existing changes. No stock, no new tables.
--
--   printed_item_number  the 4-digit item number printed under a Bunzl code, as read
--   ai_note              the reader's note about anything hard to read on this line
--   ai_unsure            the reader flagged a value on this line as unsure
--   review_reason        why a human must pick the item:
--                          'shared_code'          the code is on more than one item
--                          'code_number_conflict' the code points to one item but the
--                                                 printed item number points to another
--                        NULL = no forced pick (matched, unmatched, or skipped)
--   checked              the crew checked this line off
--   updated_by / updated_at  last crew edit (match choice, received qty, checked, skip)
--
-- match_method keeps its patch 63 values ('vendor_code', 'item_number', 'manual',
-- 'skipped', 'none', 'description_confirmed'); patch 68 uses all but the last.
-- One row per (invoice, page, line) so a rebuild can never duplicate lines.
-- Dry run first, then COMMIT; (or ROLLBACK;).

BEGIN;

-- BEFORE: expect 0 (no lines exist yet)
SELECT count(*) AS invoice_lines_rows FROM invoice_lines;

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS printed_item_number TEXT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS ai_note TEXT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS ai_unsure BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS checked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_review_reason_check;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_review_reason_check
  CHECK (review_reason IS NULL OR review_reason IN ('shared_code', 'code_number_conflict'));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_invoice_page_line_uq
  ON invoice_lines (invoice_id, page, line_no);

-- AFTER: expect 7 rows (the new columns)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'invoice_lines'
  AND column_name IN ('printed_item_number', 'ai_note', 'ai_unsure', 'review_reason', 'checked', 'updated_by', 'updated_at')
ORDER BY column_name;

-- AFTER: expect 1 row (the unique index)
SELECT indexname FROM pg_indexes WHERE tablename = 'invoice_lines' AND indexname = 'invoice_lines_invoice_page_line_uq';

-- AFTER: RLS still on, still no policies (expect true, then 0)
SELECT relrowsecurity FROM pg_class WHERE relname = 'invoice_lines' AND relkind = 'r';
SELECT count(*) AS policy_count FROM pg_policies WHERE tablename = 'invoice_lines';

-- COMMIT;   -- uncomment and run after the "after" results look right (or ROLLBACK;)
