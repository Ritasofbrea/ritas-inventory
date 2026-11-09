-- Patch 55 (replaces the earlier version of this file): clean up Ice
-- Mix's backwards sub-unit, WITHOUT changing the main unit.
--
-- Gallons stays the main unit -- current_count, par_level,
-- inventory_counts, and order_history_items are NOT touched by this file.
-- Counting, Correct Count, Par, Current Stock, Dashboard, History,
-- Velocity, and Par Suggestions all keep working exactly as they do
-- today. Only Order List and Receive Order (built in Phase 2, app code
-- only, no further SQL) will talk about boxes, computed on the fly from
-- pack_size -- nothing stored changes shape.
--
-- Two small, independent fixes:
--
-- 1) 42 Ice Mix items (every one with secondary_unit = 'Gallons' exactly)
--    have a backwards, confusing sub-unit: main unit "gallons", sub unit
--    "Gallons" -- the same real-world unit, duplicated, with a fake 4x
--    conversion between them. This is what makes Manage Items' edit form
--    say "Gallons in one gallon." Checked live: all 42 have
--    secondary_count = 0 today (confirmed again just below, with a
--    safety check that aborts if that's no longer true), so clearing the
--    sub-unit loses nothing. Watermelon and Wild Black Cherry are NOT in
--    this group -- they already have secondary_unit = '' (empty), nothing
--    to clean up for them.
--
-- 2) Dr Pepper and Shirley Temple have pack_size = null today (no
--    distributor info on file to double check against, but nothing
--    contradicts them being standard 4-gallon cases like every other
--    Ice Mix item) -- set to 4 so Phase 2's box-based Order List/Receive
--    Order math covers them the same as everything else.
--
-- Sugar Free items (unit = 'bottles') are not touched by anything in this
-- file -- real 6 x half-gallon packaging, out of scope.
--
-- Safe to run once. Re-running after a successful run is a no-op (the
-- WHERE clauses no longer match anything once secondary_unit is already
-- '' / pack_size is already 4).

begin;

-- ============================================================
-- STEP 0: BEFORE preview
-- ============================================================
select name, unit, secondary_unit, units_per_sub_unit, secondary_count, pack_size
from items
where category = 'Ice Mix' and unit <> 'bottles'
order by name;

-- ============================================================
-- STEP 0b: safety check -- must return ZERO rows. If this returns any
-- rows, STOP here (rollback, don't run STEP 1) and tell Claude --
-- something has secondary_count stock sitting in it that would be lost.
-- ============================================================
select name, secondary_count
from items
where category = 'Ice Mix' and secondary_unit = 'Gallons' and secondary_count <> 0;

-- ============================================================
-- STEP 1: clear the backwards sub-unit on the 42 affected items.
-- ============================================================
update items
set secondary_unit = '', units_per_sub_unit = null
where category = 'Ice Mix' and secondary_unit = 'Gallons';

-- ============================================================
-- STEP 2: give Dr Pepper and Shirley Temple a pack_size, matching
-- every other standard Ice Mix item.
-- ============================================================
update items
set pack_size = 4
where name in ('Dr Pepper', 'Shirley Temple') and category = 'Ice Mix';

-- ============================================================
-- STEP 3: AFTER preview -- compare against STEP 0
-- ============================================================
select name, unit, secondary_unit, units_per_sub_unit, secondary_count, pack_size
from items
where category = 'Ice Mix' and unit <> 'bottles'
order by name;

-- ============================================================
-- STEP 4: sanity check -- should be empty. Confirms the 4 Sugar Free
-- items are completely untouched.
-- ============================================================
select name, unit, secondary_unit, units_per_sub_unit, pack_size
from items
where category = 'Ice Mix' and unit = 'bottles'
  and (secondary_unit <> 'Half gallons' or units_per_sub_unit <> 6 or pack_size is not null);

-- If everything above looks right: commit;
-- If anything looks wrong: rollback;
