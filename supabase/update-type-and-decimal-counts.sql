-- Add type column to inventory_counts
-- Backfills all existing rows with 'count' (correct — all historical entries are real counts)
ALTER TABLE inventory_counts
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'count';

-- Fix count column to accept decimals (e.g. 0.5 bags, 13.5 boxes)
-- Matches items.current_count which was already changed to DECIMAL(10,2)
ALTER TABLE inventory_counts
  ALTER COLUMN count TYPE DECIMAL(10,2);
