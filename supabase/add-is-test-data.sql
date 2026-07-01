-- Add is_test_data flag to inventory_counts so a whole count session can be
-- marked as test/QA data and excluded from trend, velocity, and par-suggestion
-- math (and every display surface) without deleting the rows.
--
-- There is no separate "session" table — inventory_counts is flat, one row
-- per item per save. Every row written by a single POST /api/counts call
-- shares the same is_test_data value, which is what makes a "session" here.
ALTER TABLE inventory_counts
  ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark pre-existing rows as test data up to a cutoff.
--
-- created_at is TIMESTAMPTZ, stored internally by Postgres in UTC. The
-- requested cutoff "2026-06-30 22:52:00" is Pacific local time (PDT, UTC-7
-- in effect on this date) = 2026-07-01T05:52:00Z in UTC. That boundary sits
-- 39 seconds before a real 193-item recount by Riley at 05:52:39Z, so this
-- migration correctly preserves that recount (and everything after it) as
-- real data, and marks everything before it — including test/debug entries
-- from earlier troubleshooting — as test data.
UPDATE inventory_counts
SET is_test_data = true
WHERE created_at < '2026-07-01T05:52:00Z'::timestamptz;
