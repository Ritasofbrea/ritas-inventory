-- Patch 38: storage stock (bulk items kept in storage as well as in-store).
--
-- Per-item: has_storage flags that this item's Low/Out/Order/Dashboard math
-- should use store + storage combined (see src/lib/types.ts's
-- getMainUnitTotal, extended in the same patch). storage_count is in the
-- SAME unit as current_count (the primary unit) -- it does not get its own
-- secondary/sub-unit granularity, matching the "4 store + 16 storage = 20"
-- example, which has no conversion factor involved.
--
-- Existing items default has_storage=false, storage_count=0, so nothing
-- changes on screen until an owner explicitly flags an item.
ALTER TABLE items ADD COLUMN IF NOT EXISTS has_storage BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_count DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_updated_at TIMESTAMP WITH TIME ZONE;

-- Full history of every change to storage_count -- traceability (who, when,
-- how much) and so reports can correct for "Move to store" inflating
-- current_count without a sale (see the Phase 1 report's formula fix).
--
-- kind:
--   'add'                -- bulk purchase arrives directly into storage
--                            (Manage Items). storage up by `amount`, store
--                            untouched (store_before = store_after).
--   'move_to_store'       -- internal transfer: storage down by `amount`,
--                            store (current_count) up by the same `amount`.
--   'receive_to_storage'  -- a delivery received via Receive Order routed to
--                            storage instead of the store (owner-only
--                            choice). Same shape as 'add' (store untouched),
--                            kept as its own kind so the two sources stay
--                            distinguishable in history.
--   'correction'          -- owner sets storage to an exact new number (a
--                            miscount fix). storage_after is that number
--                            directly; store untouched.
--
-- amount is the positive quantity moved/added for 'add', 'move_to_store',
-- and 'receive_to_storage'. For 'correction' it's the SIGNED delta
-- (storage_after - storage_before) -- can be negative or zero -- which is
-- why amount has no positivity CHECK at the column level; each route
-- validates its own kind's sign/positivity before writing.
CREATE TABLE IF NOT EXISTS storage_moves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'move_to_store', 'receive_to_storage', 'correction')),
  amount DECIMAL(10,2) NOT NULL,
  store_before DECIMAL(10,2) NOT NULL,
  store_after DECIMAL(10,2) NOT NULL,
  storage_before DECIMAL(10,2) NOT NULL,
  storage_after DECIMAL(10,2) NOT NULL,
  by_name TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_moves_item_created ON storage_moves(item_id, created_at);

-- Same convention as enable-rls-all.sql: RLS on, no policies -- the anon
-- key stays locked out, the service role (server-side only) bypasses it as
-- always. Added here directly since this table is new, instead of waiting
-- for that file to be re-run.
ALTER TABLE storage_moves ENABLE ROW LEVEL SECURITY;
