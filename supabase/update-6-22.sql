-- Run this in Supabase SQL Editor (one paste, one run)
-- Rita's Inventory Update – 6/22/2026

-- 1. Allow decimal counts (e.g., 13.5 bags custard, 4.25 boxes)
ALTER TABLE items ALTER COLUMN current_count TYPE DECIMAL(10,2);

-- 2. Rename single milkshake lid to "Small Hole" now that there are two types
UPDATE items SET name = 'Small Hole Milkshake Lids'
  WHERE name = 'Milkshake Cup Lids' AND category = 'Lids';

-- 3. Fix Whipped Cream unit (it comes in cans, not bottles)
UPDATE items SET unit = 'cans' WHERE name = 'Whipped Cream';

-- 4. Add items that were on your count sheet but not yet in the database
INSERT INTO items (name, category, unit, par_level, sort_order) VALUES
  -- Napkins & Paper
  ('Brown Small Napkins',            'Napkins & Paper',    'boxes',   0,  25),
  -- Lids
  ('Large Hole Milkshake Lids',      'Lids',               'boxes',   0, 105),
  -- Toppings - Dry
  ('Sour Dust',                      'Toppings - Dry',     'bottles', 0, 245),
  -- Toppings - Wet
  ('Butter',                         'Toppings - Wet',     'lbs',     0, 140),
  -- Ice Mix – new flavors
  ('Blackberry',                     'Ice Mix',            'gallons', 0, 375),
  ('Sour Patch Kids Red',            'Ice Mix',            'gallons', 0, 380),
  ('Kiwi Melon',                     'Ice Mix',            'gallons', 0, 390),
  ('Juicy Pear',                     'Ice Mix',            'gallons', 0, 400),
  ('Sour Blue Pucker',               'Ice Mix',            'gallons', 0, 410),
  ('Sugar Free Dragon Fruit',        'Ice Mix',            'bottles', 0, 420),
  ('Sugar Free Mango Peach',         'Ice Mix',            'bottles', 0, 430),
  ('Sugar Free Cherry',              'Ice Mix',            'bottles', 0, 440),
  ('Sugar Free Pink Lemonade',       'Ice Mix',            'bottles', 0, 450),
  ('Mermaid',                        'Ice Mix',            'gallons', 0, 460),
  ('Blue Hawaii',                    'Ice Mix',            'gallons', 0, 470),
  -- Cleaning Supplies
  ('Ajax',                           'Cleaning Supplies',  'cans',    0,  53),
  ('Clorox Surface Cleaner',         'Cleaning Supplies',  'bottles', 0,  65),
  ('Bleach',                         'Cleaning Supplies',  'bottles', 0, 115),
  -- Trash Bags
  ('M Gloves',                       'Trash Bags',         'boxes',   0,  30),
  ('L Gloves',                       'Trash Bags',         'boxes',   0,  40)
ON CONFLICT DO NOTHING;
