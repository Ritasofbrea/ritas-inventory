-- Adds a nullable secondary par level for items that have a secondary_unit
-- configured (e.g. sleeves, bags). par_level stays primary-unit-only.
ALTER TABLE items ADD COLUMN IF NOT EXISTS par_level_secondary INTEGER;
