-- Allow fractional par levels (e.g. 0.25, 0.75) — previously integer-only.
ALTER TABLE items ALTER COLUMN par_level TYPE DECIMAL(10,2) USING par_level::DECIMAL(10,2);
ALTER TABLE items ALTER COLUMN par_level_secondary TYPE DECIMAL(10,2) USING par_level_secondary::DECIMAL(10,2);
