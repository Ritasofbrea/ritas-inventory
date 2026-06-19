-- Rita's Italian Ice – Brea Location Inventory Schema

CREATE TABLE IF NOT EXISTS items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'boxes',
  current_count INTEGER NOT NULL DEFAULT 0,
  par_level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  count INTEGER NOT NULL,
  entered_by TEXT NOT NULL DEFAULT 'shift_lead',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update items.updated_at automatically
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed initial items
INSERT INTO items (name, category, unit, par_level, sort_order) VALUES
  -- Containers & Cups
  ('4 oz Cups',         'Containers & Cups', 'sleeves',   3, 10),
  ('6 oz Cups',         'Containers & Cups', 'sleeves',   3, 20),
  ('8 oz Cups',         'Containers & Cups', 'sleeves',   4, 30),
  ('12 oz Cups',        'Containers & Cups', 'sleeves',   4, 40),
  ('16 oz Cups',        'Containers & Cups', 'sleeves',   3, 50),
  ('Quart Containers',  'Containers & Cups', 'boxes',     2, 60),
  -- Lids
  ('Small Lids (4/6 oz)',  'Lids', 'sleeves', 3, 10),
  ('Medium Lids (8/12 oz)','Lids', 'sleeves', 3, 20),
  ('Large Lids (16 oz)',   'Lids', 'sleeves', 2, 30),
  -- Spoons & Straws
  ('Italian Ice Spoons', 'Spoons & Straws', 'boxes',   2, 10),
  ('Straws',             'Spoons & Straws', 'boxes',   1, 20),
  -- Topping Containers
  ('2 oz Condiment Cups', 'Topping Containers', 'bags', 2, 10),
  ('4 oz Condiment Cups', 'Topping Containers', 'bags', 2, 20),
  -- Toppings - Dry
  ('Rainbow Sprinkles',      'Toppings - Dry', 'containers', 2, 10),
  ('Chocolate Sprinkles',    'Toppings - Dry', 'containers', 2, 20),
  ('Gummy Bears',            'Toppings - Dry', 'bags',       2, 30),
  ('Mango Chili Powder',     'Toppings - Dry', 'containers', 1, 40),
  ('Coconut Flakes',         'Toppings - Dry', 'bags',       1, 50),
  ('Graham Cracker Crumbles','Toppings - Dry', 'bags',       1, 60)
ON CONFLICT DO NOTHING;
