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

-- Seed initial items (imported from Inventory 6:8.csv)
INSERT INTO items (name, category, unit, par_level, sort_order) VALUES
  -- Containers & Cups
  ('Kids Ice Cups',                        'Containers & Cups', 'boxes',      0,  10),
  ('Small Ice Cups',                       'Containers & Cups', 'boxes',      0,  20),
  ('Large Ice Cups',                       'Containers & Cups', 'boxes',      0,  30),
  ('Quarts',                               'Containers & Cups', 'boxes',      0,  40),
  ('Ice Flights',                          'Containers & Cups', 'lots',       0,  50),
  ('Gallon Containers',                    'Containers & Cups', 'containers', 0,  60),
  ('2.5 Gallon Containers',               'Containers & Cups', 'containers', 0,  70),
  ('1st Day Spring Cups',                  'Containers & Cups', 'boxes',      0,  80),
  ('Small Custard Cups',                   'Containers & Cups', 'boxes',      0,  90),
  ('Large Custard Cups',                   'Containers & Cups', 'boxes',      0, 100),
  ('Large Sundae Bowls',                   'Containers & Cups', 'boxes',      0, 110),
  ('Pints',                                'Containers & Cups', 'boxes',      0, 120),
  ('Small Milkshake Cups',                 'Containers & Cups', 'boxes',      0, 130),
  ('Large Milkshake Cups',                 'Containers & Cups', 'boxes',      0, 140),
  ('Individual Hinged Cookie Containers',  'Containers & Cups', 'boxes',      0, 150),
  ('6-Pack Cookie Containers',             'Containers & Cups', 'boxes',      0, 160),
  ('Food Boats (Small)',                   'Containers & Cups', 'boxes',      0, 170),
  -- Lids
  ('Kids Ice Cup Lids',              'Lids', 'boxes', 0,  10),
  ('Small Ice Cup Lids',             'Lids', 'boxes', 0,  20),
  ('Large Ice Cup Lids',             'Lids', 'boxes', 0,  30),
  ('Quart Ice Cup Lids',             'Lids', 'boxes', 0,  40),
  ('Ice Flight Lids',                'Lids', 'lots',  0,  50),
  ('Gallon Lids',                    'Lids', 'boxes', 0,  60),
  ('Small/Large Custard Cup Lids',   'Lids', 'boxes', 0,  70),
  ('Large Sundae Bowl Lids',         'Lids', 'boxes', 0,  80),
  ('Pint Lids',                      'Lids', 'boxes', 0,  90),
  ('Milkshake Cup Lids',             'Lids', 'boxes', 0, 100),
  ('Topping Cup Lids',               'Lids', 'boxes', 0, 110),
  -- Spoons & Straws
  ('Regular Spoons', 'Spoons & Straws', 'boxes', 0, 10),
  ('Long Spoons',    'Spoons & Straws', 'boxes', 0, 20),
  ('Sample Spoons',  'Spoons & Straws', 'boxes', 0, 30),
  ('Small Straws',   'Spoons & Straws', 'boxes', 0, 40),
  ('Large Straws',   'Spoons & Straws', 'boxes', 0, 50),
  -- Topping Containers
  ('Rita''s Logo Topping Cups',        'Topping Containers', 'boxes', 0, 10),
  ('Translucent Plastic Topping Cups', 'Topping Containers', 'boxes', 0, 20),
  ('Paper Souffle/Sample Cups',        'Topping Containers', 'boxes', 0, 30),
  -- Toppings - Dry
  ('Graham Crackers',        'Toppings - Dry', 'boxes',      0,  10),
  ('Nilla Wafers',           'Toppings - Dry', 'boxes',      0,  20),
  ('M&Ms',                   'Toppings - Dry', 'boxes',      0,  30),
  ('Peppermint',             'Toppings - Dry', 'boxes',      0,  40),
  ('Peanuts',                'Toppings - Dry', 'boxes',      0,  50),
  ('Gummy Bears',            'Toppings - Dry', 'boxes',      0,  60),
  ('Oreo Pieces',            'Toppings - Dry', 'boxes',      0,  70),
  ('Chocolate Sprinkles',    'Toppings - Dry', 'boxes',      0,  80),
  ('Rainbow Sprinkles',      'Toppings - Dry', 'boxes',      0,  90),
  ('Glitter Sprinkles',      'Toppings - Dry', 'containers', 0, 100),
  ('Reese''s Cups',          'Toppings - Dry', 'boxes',      0, 110),
  ('Chocolate Chips',        'Toppings - Dry', 'boxes',      0, 120),
  ('Take 5',                 'Toppings - Dry', 'boxes',      0, 130),
  ('Cookie Dough Bites',     'Toppings - Dry', 'boxes',      0, 140),
  ('Brownie Bites',          'Toppings - Dry', 'boxes',      0, 150),
  ('Unicorn Bark',           'Toppings - Dry', 'boxes',      0, 160),
  ('Baby Nerds',             'Toppings - Dry', 'boxes',      0, 170),
  ('Regular Nerds',          'Toppings - Dry', 'boxes',      0, 180),
  ('Skittles',               'Toppings - Dry', 'boxes',      0, 190),
  ('Almond Roca',            'Toppings - Dry', 'boxes',      0, 200),
  ('Andes',                  'Toppings - Dry', 'boxes',      0, 210),
  ('Tajin',                  'Toppings - Dry', 'bottles',    0, 220),
  ('Tamarind Candy',         'Toppings - Dry', 'boxes',      0, 230),
  ('Brownies (for sundaes)', 'Toppings - Dry', 'boxes',      0, 240),
  -- Toppings - Wet
  ('Peanut Butter Topping',  'Toppings - Wet', 'containers', 0,  10),
  ('Crushed Cherries',       'Toppings - Wet', 'containers', 0,  20),
  ('Diced Black Cherries',   'Toppings - Wet', 'containers', 0,  30),
  ('Apple Topping',          'Toppings - Wet', 'containers', 0,  40),
  ('Strawberry Topping',     'Toppings - Wet', 'containers', 0,  50),
  ('Pumpkin Cream Topping',  'Toppings - Wet', 'containers', 0,  60),
  ('Whole Cherries',         'Toppings - Wet', 'containers', 0,  70),
  ('Pineapple Topping',      'Toppings - Wet', 'containers', 0,  80),
  ('Caramel',                'Toppings - Wet', 'bags',       0,  90),
  ('Hot Fudge',              'Toppings - Wet', 'bags',       0, 100),
  ('Whipped Cream',          'Toppings - Wet', 'bottles',    0, 110),
  ('Nacho Cheese',           'Toppings - Wet', 'containers', 0, 120),
  ('Chamoy',                 'Toppings - Wet', 'bottles',    0, 130),
  -- Syrups
  ('Banana',          'Syrups', 'bottles', 0,  10),
  ('Black Raspberry', 'Syrups', 'bottles', 0,  20),
  ('Butter Pecan',    'Syrups', 'bottles', 0,  30),
  ('Cake Batter',     'Syrups', 'bottles', 0,  40),
  ('Campfire S''mores','Syrups','bottles', 0,  50),
  ('Cheesecake',      'Syrups', 'bottles', 0,  60),
  ('Coffee',          'Syrups', 'bottles', 0,  70),
  ('Cotton Candy',    'Syrups', 'bottles', 0,  80),
  ('Mint',            'Syrups', 'bottles', 0,  90),
  ('Peach',           'Syrups', 'bottles', 0, 100),
  ('Pistachio',       'Syrups', 'bottles', 0, 110),
  ('Pumpkin',         'Syrups', 'bottles', 0, 120),
  ('Strawberry',      'Syrups', 'bottles', 0, 130),
  -- Ice Mix
  ('Banana / Banana Split',  'Ice Mix', 'gallons', 0,  10),
  ('Birthday Cake',          'Ice Mix', 'gallons', 0,  20),
  ('Blue Raspberry',         'Ice Mix', 'gallons', 0,  30),
  ('Cheesecake',             'Ice Mix', 'gallons', 0,  40),
  ('Cherry',                 'Ice Mix', 'gallons', 0,  50),
  ('Clementine',             'Ice Mix', 'gallons', 0,  60),
  ('Cola',                   'Ice Mix', 'gallons', 0,  70),
  ('Coconut Cream',          'Ice Mix', 'gallons', 0,  80),
  ('Cookies N Cream',        'Ice Mix', 'gallons', 0,  90),
  ('Cotton Candy',           'Ice Mix', 'gallons', 0, 100),
  ('Georgia Peach',          'Ice Mix', 'gallons', 0, 110),
  ('Green Apple',            'Ice Mix', 'gallons', 0, 120),
  ('Gummy Bear',             'Ice Mix', 'gallons', 0, 130),
  ('Island Fusion',          'Ice Mix', 'gallons', 0, 140),
  ('Key Lime',               'Ice Mix', 'gallons', 0, 150),
  ('Koolaid Sharkleberry',   'Ice Mix', 'gallons', 0, 160),
  ('Koolaid Tropical Punch', 'Ice Mix', 'gallons', 0, 170),
  ('Lemon',                  'Ice Mix', 'gallons', 0, 180),
  ('Mango',                  'Ice Mix', 'gallons', 0, 190),
  ('Mint Chip',              'Ice Mix', 'gallons', 0, 200),
  ('Passionfruit Paloma',    'Ice Mix', 'gallons', 0, 210),
  ('Pina Colada',            'Ice Mix', 'gallons', 0, 220),
  ('Pineapple',              'Ice Mix', 'gallons', 0, 230),
  ('Purple Candy',           'Ice Mix', 'gallons', 0, 240),
  ('Pumpkin',                'Ice Mix', 'gallons', 0, 250),
  ('Raspberry',              'Ice Mix', 'gallons', 0, 260),
  ('Root Beer',              'Ice Mix', 'gallons', 0, 270),
  ('Skittles',               'Ice Mix', 'gallons', 0, 280),
  ('S''mores',               'Ice Mix', 'gallons', 0, 290),
  ('Sour Patch Watermelon',  'Ice Mix', 'gallons', 0, 300),
  ('Swedish Fish',           'Ice Mix', 'gallons', 0, 310),
  ('Strawberry',             'Ice Mix', 'gallons', 0, 320),
  ('Vanilla',                'Ice Mix', 'gallons', 0, 330),
  ('Watermelon',             'Ice Mix', 'gallons', 0, 340),
  ('Wild Cherry',            'Ice Mix', 'gallons', 0, 350),
  ('Peeps',                  'Ice Mix', 'gallons', 0, 360),
  ('Chocolate',              'Ice Mix', 'gallons', 0, 370),
  -- Custard
  ('Vanilla Custard Bags',   'Custard', 'boxes', 0, 10),
  ('Chocolate Custard Bags', 'Custard', 'boxes', 0, 20),
  -- Things to Make Ice
  ('Sugar',              'Things to Make Ice', 'bags',    0, 10),
  ('Cream Ice Powder',   'Things to Make Ice', 'boxes',   0, 20),
  ('Chocolate Base',     'Things to Make Ice', 'bottles', 0, 30),
  ('Lemon Concentrate',  'Things to Make Ice', 'boxes',   0, 40),
  ('Lime Concentrate',   'Things to Make Ice', 'boxes',   0, 50),
  ('Milkshake Syrup',    'Things to Make Ice', 'bottles', 0, 60),
  -- Cones
  ('Waffle Cones',  'Cones', 'boxes', 0, 10),
  ('Cake Cones',    'Cones', 'boxes', 0, 20),
  ('Waffle Bowls',  'Cones', 'boxes', 0, 30),
  -- Cookies
  ('Chocolate Chip Cookies',           'Cookies', 'boxes', 0, 10),
  ('Peanut Butter Cookies',            'Cookies', 'boxes', 0, 20),
  ('Sugar Cookies',                    'Cookies', 'boxes', 0, 30),
  ('Red Velvet Cookies',               'Cookies', 'boxes', 0, 40),
  ('Macadamia Nut Cookies',            'Cookies', 'boxes', 0, 50),
  ('Oreo Wafers (for sandwiches)',     'Cookies', 'boxes', 0, 60),
  ('Chocolate Chip Cookie Sandwiches', 'Cookies', 'boxes', 0, 70),
  -- Drink Items
  ('Cold Brew Concentrate', 'Drink Items', 'bottles', 0, 10),
  ('Matcha Syrup',          'Drink Items', 'bottles', 0, 20),
  ('Milk',                  'Drink Items', 'gallons', 0, 30),
  ('Water Bottles',         'Drink Items', 'cases',   0, 40),
  -- Bags & Carriers
  ('Cookie Bags',             'Bags & Carriers', 'boxes', 0, 10),
  ('Plastic Bags',            'Bags & Carriers', 'boxes', 0, 20),
  ('Small Rita''s Paper Bags','Bags & Carriers', 'boxes', 0, 30),
  ('Large Rita''s Paper Bags','Bags & Carriers', 'boxes', 0, 40),
  ('Drink Carriers',          'Bags & Carriers', 'boxes', 0, 50),
  -- Napkins & Paper
  ('White Napkins',  'Napkins & Paper', 'boxes', 0, 10),
  ('Paper Towels',   'Napkins & Paper', 'boxes', 0, 20),
  ('Pink Rags',      'Napkins & Paper', 'boxes', 0, 30),
  -- Cleaning Supplies
  ('Hand Soap',                    'Cleaning Supplies', 'bottles', 0,  10),
  ('Soap Refill Bottle',           'Cleaning Supplies', 'bottles', 0,  20),
  ('Dish Soap',                    'Cleaning Supplies', 'gallons', 0,  30),
  ('Glass Cleaner',                'Cleaning Supplies', 'bottles', 0,  40),
  ('Comet Bathroom Spray',         'Cleaning Supplies', 'cans',    0,  50),
  ('Scrub Free All Purpose Cleaner','Cleaning Supplies','bottles', 0,  60),
  ('Stainless Steel Cleaner',      'Cleaning Supplies', 'cans',    0,  70),
  ('Scour Pads',                   'Cleaning Supplies', 'packs',   0,  80),
  ('Pine-Sol',                     'Cleaning Supplies', 'bottles', 0,  90),
  ('Neutral Cleaner',              'Cleaning Supplies', 'bottles', 0, 100),
  ('Sanitizer',                    'Cleaning Supplies', 'bottles', 0, 110),
  -- Bathroom Supplies
  ('Toilet Paper',       'Bathroom Supplies', 'rolls', 0, 10),
  ('Toilet Seat Covers', 'Bathroom Supplies', 'boxes', 0, 20),
  -- Trash Bags
  ('White Trash Bags', 'Trash Bags', 'boxes', 0, 10),
  ('Black Trash Bags', 'Trash Bags', 'boxes', 0, 20),
  -- Stickers & Receipts
  ('DoorDash Stickers',                    'Stickers & Receipts', 'rolls', 0, 10),
  ('Small Rita''s Red Stickers',           'Stickers & Receipts', 'rolls', 0, 20),
  ('Cookie Sandwich Stickers',             'Stickers & Receipts', 'rolls', 0, 30),
  ('Cookie Sandwich Ingredient Stickers',  'Stickers & Receipts', 'rolls', 0, 40),
  ('Receipt Paper',                        'Stickers & Receipts', 'rolls', 0, 50)
ON CONFLICT DO NOTHING;
