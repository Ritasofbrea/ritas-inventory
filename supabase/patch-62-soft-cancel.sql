-- PATCH 62: soft cancel for orders
-- Cancel Order no longer deletes. A canceled 'ordered' row stays in order_history
-- (with its order_history_items) and is marked here instead.
-- An order is canceled when canceled_at IS NOT NULL.
-- Additive only: both columns are nullable, no backfill, existing rows untouched.
-- Run in the Supabase SQL editor BEFORE pushing the patch 62 app code
-- (src/lib/order-list-server.ts selects canceled_at by name).

ALTER TABLE order_history ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE order_history ADD COLUMN IF NOT EXISTS canceled_by TEXT;

-- Check: both columns exist and are nullable; nothing is canceled yet (expect 0).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'order_history' AND column_name IN ('canceled_at', 'canceled_by')
ORDER BY column_name;

SELECT count(*) AS canceled_orders FROM order_history WHERE canceled_at IS NOT NULL;
