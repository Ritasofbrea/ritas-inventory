-- Add secondary count support (e.g. "4 boxes + 2 sleeves")
ALTER TABLE items ADD COLUMN IF NOT EXISTS secondary_count DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS secondary_unit TEXT NOT NULL DEFAULT '';
