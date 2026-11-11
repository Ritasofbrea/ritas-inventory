-- PATCH 63: invoice scanning foundation (storage only -- no AI, no stock changes).
-- Run in the Supabase SQL editor BEFORE pushing the app code (the new
-- /api/invoices routes and the Scan Invoice screen need these tables and
-- the bucket to exist).
--
-- Idempotent: safe to run again (IF NOT EXISTS / ON CONFLICT / guarded UPDATE).
--
-- Creates:
--   invoices          one row per scanned vendor invoice (draft until later patches read + receive it)
--   invoice_lines     one row per invoice line (empty until patch 65 reads the photos)
--   items.invoice_units_per_case   stock units per invoice case, backfilled from pack_size
--   storage bucket invoice-photos  PRIVATE, 5 MB, images only
--
-- RLS: both new tables get ROW LEVEL SECURITY with NO policies, same as
-- every other table (supabase/enable-rls-all.sql). The app only touches
-- them through server routes using the service role key, which bypasses
-- RLS; the public anon key gets nothing.
--
-- Bucket fallback: if the INSERT INTO storage.buckets below errors with a
-- permission problem, ROLLBACK, delete that statement, run the rest, and
-- create the bucket in the dashboard instead:
--   Storage -> New bucket -> Name: invoice-photos
--   Public bucket: OFF
--   Restrict file size: ON, 5 MB
--   Restrict MIME types: ON -> image/jpeg, image/png, image/webp, image/heic, image/heif
--   Save. Do NOT add any policies to it.

BEGIN;

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor           TEXT NOT NULL,                 -- vendorKeyForItem key: 'bunzl', 'balford', 'other'
  invoice_number   TEXT,
  invoice_date     DATE,
  photo_paths      TEXT[] NOT NULL DEFAULT '{}',  -- paths inside the private invoice-photos bucket, page order
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'read', 'received', 'discarded')),
  related_order_id UUID REFERENCES order_history(id) ON DELETE SET NULL, -- the 'ordered' row; NULL = will call / standalone
  receipt_id       UUID REFERENCES order_history(id) ON DELETE SET NULL, -- the received/will_call row it created (patch 67)
  raw_extraction   JSONB,                         -- what the reader returned, per page (patch 65)
  read_model       TEXT,
  created_by       TEXT,
  received_by      TEXT,
  received_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON invoices (created_at DESC);

-- One vendor invoice number can only be RECEIVED once. Drafts and
-- discarded scans of the same invoice are allowed (rescans happen).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_vendor_number_received_uq
  ON invoices (vendor, invoice_number)
  WHERE status = 'received' AND invoice_number IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_lines (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  page                    INT NOT NULL DEFAULT 1,
  line_no                 INT NOT NULL,
  vendor_code             TEXT,
  description             TEXT,
  invoice_unit            TEXT,          -- CS, BX, EA ...
  qty_ordered             NUMERIC,
  qty_shipped             NUMERIC,
  qty_received            NUMERIC,       -- crew-confirmed, in invoice units
  units_per_invoice_unit  NUMERIC,       -- conversion used at confirm time
  stock_qty_added         NUMERIC,       -- what actually went into stock, in items.unit
  item_id                 UUID REFERENCES items(id) ON DELETE SET NULL,
  match_method            TEXT NOT NULL DEFAULT 'none'
                          CHECK (match_method IN ('vendor_code', 'item_number', 'description_confirmed', 'manual', 'skipped', 'none')),
  code_learned            BOOLEAN NOT NULL DEFAULT false,
  confirmed_by            TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines (invoice_id);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- items.invoice_units_per_case
-- Stock units per invoice case. Backfilled from pack_size where set
-- (Ice Mix 4 gal, Sugar Free 6 bottles, Syrups 2 bottles, ...). Left NULL
-- everywhere else: later patches treat NULL on a box-counted item as
-- 1 CS = 1 box, and ask once for anything else.
-- ---------------------------------------------------------------------------
ALTER TABLE items ADD COLUMN IF NOT EXISTS invoice_units_per_case NUMERIC;

UPDATE items
   SET invoice_units_per_case = pack_size
 WHERE pack_size IS NOT NULL
   AND invoice_units_per_case IS NULL;

-- ---------------------------------------------------------------------------
-- Private storage bucket (see the dashboard fallback at the top)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoice-photos', 'invoice-photos', false, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Checks (look at these before COMMIT)
-- ---------------------------------------------------------------------------
-- 1. Both tables exist with RLS on: expect 2 rows, rls_enabled = true
SELECT relname, relrowsecurity AS rls_enabled
  FROM pg_class
 WHERE relname IN ('invoices', 'invoice_lines') AND relkind = 'r';

-- 2. No policies on either table: expect 0
SELECT count(*) AS policy_count FROM pg_policies WHERE tablename IN ('invoices', 'invoice_lines');

-- 3. Backfill: these two numbers should match
SELECT count(*) FILTER (WHERE pack_size IS NOT NULL) AS items_with_pack_size,
       count(*) FILTER (WHERE invoice_units_per_case IS NOT NULL) AS items_with_invoice_units
  FROM items;

-- 4. Every backfilled value equals its pack_size: expect 0
SELECT count(*) AS mismatched FROM items
 WHERE invoice_units_per_case IS NOT NULL AND invoice_units_per_case <> pack_size;

-- 5. Bucket: expect 1 row, public = false, file_size_limit = 5242880
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'invoice-photos';

-- 6. No storage policies mention the bucket: expect 0
SELECT count(*) AS bucket_policy_count FROM pg_policies
 WHERE schemaname = 'storage' AND (qual ILIKE '%invoice-photos%' OR with_check ILIKE '%invoice-photos%');

-- COMMIT;   -- uncomment after the checks look right (or ROLLBACK;)
