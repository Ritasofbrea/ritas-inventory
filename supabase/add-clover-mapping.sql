-- Clover items (seeded from inventory export)
CREATE TABLE IF NOT EXISTS clover_items (
  clover_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Mapping: each Clover menu item → one or more inventory items + quantity consumed per sale
CREATE TABLE IF NOT EXISTS clover_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clover_item_id TEXT NOT NULL REFERENCES clover_items(clover_id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity DECIMAL(10,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clover_item_id, inventory_item_id)
);

-- Seed all real menu items from Clover export (system/payment items excluded)
INSERT INTO clover_items (clover_id, name, category, price) VALUES
-- Italian Ice
('SCMRT8DCCHYXM', 'Kids Ice', 'Italian Ice', 4.60),
('2PMCNV4T761BM', 'Small Ice', 'Italian Ice', 5.60),
('9RP681XQ0200A', 'Large Ice', 'Italian Ice', 6.90),
('1MZQ23TQ5R5WT', 'Quart Ice', 'Italian Ice', 10.80),
('N3PRPBN5ZS1SR', 'Ice Fun Pack Gallon', 'Italian Ice', 37.00),
('DVSKEXJNQ5C8C', '2.5 Gallon Ice Super Fun Pack', 'Italian Ice', 89.00),
('5G5NX69VARRKW', '3 Gallons- Ice Super Fun Variety Pack', 'Italian Ice', 104.99),
('W0Z5M7CMQ59GW', 'Ice Flights', 'Italian Ice', 7.20),
('PE2Z9JSKMBE9M', 'FDOS Free Ice', 'Italian Ice', 0.00),
('DEJ0316H3C1JW', 'FDOS Custard Topper Upcharge', 'Italian Ice', 1.80),
('WYNTAJZ378134', 'Rainbow Ice', 'Italian Ice', 0.00),
-- Soft Serve Custard
('PH3XFPKT8ZV5M', 'Kids SS Cup', 'Soft Serve Custard', 4.29),
('G8HRJZPH9914E', 'Small SS Cup', 'Soft Serve Custard', 5.90),
('D9YYAFZP3P6F2', 'Large SS Cup', 'Soft Serve Custard', 6.90),
('98YVQRZGCRW9C', 'Kids SS Cone', 'Soft Serve Custard', 4.29),
('5H57DV0MZNQ36', 'Small SS Cone', 'Soft Serve Custard', 5.90),
('534KBSA9H98GT', 'Large SS Cone', 'Soft Serve Custard', 6.90),
('6GD1BHE713TKY', 'Small SS Sundae', 'Soft Serve Custard', 8.40),
('GJCEZA20Z1CT8', 'Large SS Sundae', 'Soft Serve Custard', 9.60),
('QT4GPZ5WGK7EE', 'SS Custard Pint', 'Soft Serve Custard', 8.20),
('KYJJFA3VZKNEM', 'Small Brownie Sundae', 'Soft Serve Custard', 8.29),
('ZXVFG35CS1B7T', 'Small Cookie Sundae', 'Soft Serve Custard', 7.89),
('4BGNDSEP78Y40', 'Large Brownie Sundae', 'Soft Serve Custard', 8.99),
('27JKPG98XV7YE', 'Large Cookie Sundae', 'Soft Serve Custard', 8.69),
('3N08AKQ25S9WT', 'Pup Cup', 'Soft Serve Custard', 1.00),
('A9H8SPA6RMCPC', 'SS Extra Custard', 'Soft Serve Custard', 2.20),
-- Hand Scooped Custard
('1X818XQKRTZCA', 'HS Kids Cup', 'Hand Scooped Custard', 4.59),
('HYF4AXGWAF42W', 'HS Small Cup', 'Hand Scooped Custard', 6.60),
('CNJKXA997ZFXP', 'HS Large Cup', 'Hand Scooped Custard', 8.20),
('NQZDN48JHFW4J', 'HS Kids Cone', 'Hand Scooped Custard', 4.59),
('GCRYTPH37H3VM', 'HS Small Cone', 'Hand Scooped Custard', 6.60),
('YHDARB45GF5Q0', 'HS Large Cone', 'Hand Scooped Custard', 8.20),
('NRBEMT91EFMER', 'HS Flights', 'Hand Scooped Custard', 9.20),
('TR331BAKME7H8', 'HS Custard Pint', 'Hand Scooped Custard', 9.80),
('Z44X9PDVVBXYE', 'HS Upcharge', 'Hand Scooped Custard', 2.40),
('CCA5W7P555HJA', 'Add HS Scoop', 'Hand Scooped Custard', 2.40),
-- Gelati
('SQS025J6VCK7P', 'Small Gelati', 'Gelati', 6.90),
('PB5DWAYGNGVD4', 'Large Gelati', 'Gelati', 8.20),
('VJT7GEASPM59E', '5 Layer Gelati', 'Gelati', 8.90),
-- Misto
('1QFKYHENPDDM2', 'Small Misto / Gelati Blender', 'Misto', 6.60),
('ARYYNDT8Z49TC', 'Large Misto / Gelati Blender', 'Misto', 7.80),
-- Blendini
('PK1WSTX12WA88', 'Blendini', 'Blendini', 7.89),
-- Concrete
('8BEY9JJ3VDE9P', 'Concrete', 'Concrete', 9.30),
-- Milkshake
('ZBWJABWQ3JWSP', 'Small MilkShake', 'Milkshake', 8.40),
('DBX0KDSDZBA8M', 'Large MilkShake', 'Milkshake', 9.60),
-- Frozen Drink
('9RZRC2YDDHV20', 'Small Frozen Drink / Ice Blender', 'Frozen Drink', 5.90),
('QXTR3DVWDHVYY', 'Large Frozen Drink / Ice Blender', 'Frozen Drink', 6.90),
('XXY4BPQ0HAR4R', 'Small Twisted Cola Blender', 'Frozen Drink', 6.59),
('NDNMBFSYDZZAM', 'Large Twisted Cola Blender', 'Frozen Drink', 7.19),
-- Frozen Coffee/Matcha
('BV0RKTQNJY1CR', 'Small Frozen Coffee', 'Frozen Coffee/Matcha', 6.70),
('TDQZRKEKR9W2M', 'Large Frozen Coffee', 'Frozen Coffee/Matcha', 8.30),
('MNFA8JYHJVTPY', 'Small Frozen Matcha', 'Frozen Coffee/Matcha', 6.70),
('HX0BZM8XG2E3C', 'Large Frozen Matcha', 'Frozen Coffee/Matcha', 8.30),
-- Frozen Lemonade
('WEKPWPDY9591T', 'Small Frozen Lemonade', 'Frozen Lemonade', 6.49),
('7R8NQSYZMCS7P', 'Large Frozen Lemonade', 'Frozen Lemonade', 7.39),
-- Fresh Baked Cookies
('Y8KSAHW3ER0XG', 'Single Fresh Baked Cookie', 'Fresh Baked Cookies', 2.89),
('WDKCZWCNQ84HA', 'Fresh Baked Custard Cookie Sandwich', 'Fresh Baked Cookies', 7.90),
('2PZ68TZF70Y56', 'Single Fresh Baked Brownie', 'Fresh Baked Cookies', 2.39),
-- Novelty
('H0BQCTPVAMAWT', 'Frozen Custard Cake', 'Novelty', 34.99),
('N9GCC1HEZK8WM', '6-pack Cookie Sandwich Variety', 'Novelty', 17.80),
('J0SP0SVKTSRNE', 'Individual Custard Cookie Sandwich', 'Novelty', 4.50),
('6TQ7KBQGX1D26', 'DIY Treat Take Home Kit', 'Novelty', 0.00),
('CZSG2JSWED0Z8', 'Family Take Home Pack', 'Novelty', 0.00),
-- Pretzels
('E4ET3A5PH1EPT', 'Salted Super Pretzel', 'Pretzels', 6.22),
('2YHPAR4RRS40T', 'Jalapeno Stuffed Super Pretzel', 'Pretzels', 6.96),
('KY8KMH55DSBW6', 'Cream Cheese Stuffed Super Pretzel', 'Pretzels', 6.96),
('CD927RBEC7XGP', 'Cheese Dip', 'Pretzels', 2.50),
-- Beverages
('HZ87S99740SC2', 'Bottled Water', 'Beverages', 2.50),
('EYD2WYCVE8MNW', 'Small Coffee', 'Beverages', 1.99),
('C14X9PTH0GFVY', 'Small Apple Cider', 'Beverages', 2.69),
('SKBQSW6TM95WA', 'Float Upcharge', 'Beverages', 2.10),
-- Add On
('MKTGSJ18DQZME', 'Additional Topping', 'Add On', 1.55),
('GT0EBADGE70WJ', 'Add Waffle Bowl', 'Add On', 2.30),
('M1MDTYRCBVRNW', 'Add Waffle Cone', 'Add On', 2.30),
('QJG0M9A4J89TE', 'Pre-Packaged Toppings', 'Add On', 1.65),
('05W5WTAD4YQ5Y', 'Single Peep', 'Add On', 1.10),
('0MMHZTG0DNK7T', 'Peep/Sprinkles Combo', 'Add On', 1.55),
('DEG5W91HP94MM', 'Sprinkles Upcharge', 'Add On', 1.10),
('JA7HGBYWGDGG2', 'Whipped Cream', 'Add On', 1.19),
('Q3XMJ3Q2A7MHE', 'Single Trolli Brite Octopus', 'Add On', 0.77),
('NBF4BKBBJVQ5J', 'Sour Blue Dust', 'Add On', 0.77),
('X0GKMF7ZBHR10', 'Stuffed Upcharge', 'Add On', 1.00),
-- Cool Stuff
('9114E5BVQ8V9M', 'Mens T Shirts S-XL', 'Cool Stuff', 18.00),
('27QCFCEKTAFHE', 'Mens T Shirts XXL', 'Cool Stuff', 21.00),
('YKJCJHV0R1S3C', 'Womens T Shirts S-XL', 'Cool Stuff', 16.00),
('5KX3G1ZTX54N8', 'Womens T Shirts XXL', 'Cool Stuff', 20.00),
('RNVZSRCHB9CP4', 'Plush Ice Guys', 'Cool Stuff', 6.00),
('6YVQ3D135CX9C', 'Bumper Magnets', 'Cool Stuff', 5.00),
('GF7R8PZNBF52G', 'Cooler Bags', 'Cool Stuff', 10.00),
('YWJMTNAKK82B8', 'Gelati Lip Balm', 'Cool Stuff', 3.00),
('WH3TGM7PWA39C', '5 Inch Colorful Ice Guy', 'Cool Stuff', 6.00),
('0Q0XGCZ4KXBEY', 'Tumblers', 'Cool Stuff', 12.00),
('541K3FXR1PXAR', 'Insulated Bag', 'Cool Stuff', 10.00),
('AT5G306JEMV7E', 'Lanyard', 'Cool Stuff', 2.49),
-- Fundraiser
('DGJS6ZG7YWXD2', 'Fundraiser Card', 'Fundraiser', 1.00),
('S6P7DVZV5A4XA', 'Alex''s Lemonade Stand 2026', 'Fundraiser', 1.00),
('09Y2JK27FW8D2', 'Fundraiser', 'Fundraiser', 0.00),
-- Full Service Catering
('6NPCTZX859E10', 'Open $ Catering', 'Full Service Catering', NULL)
ON CONFLICT (clover_id) DO NOTHING;
