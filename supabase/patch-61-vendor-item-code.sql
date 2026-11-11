-- PATCH 61: Bunzl invoice product codes -> items.vendor_item_code
-- Source: ritas_item_mapping-2.csv (187 rows). Bunzl rows only. Generated 2026-11-11 against live items.
-- Each UPDATE is pinned to id AND current item_number AND name, so a drifted row updates 0 rows instead of the wrong item.
-- item_number is NOT touched.
-- Left empty on purpose (no UPDATE): Strawberry/Cotton Candy/Pumpkin (Syrups), Cheesecake (Ice Mix),
--   Large Hole Milkshake Lids, Skittles (Ice Mix), Sour Blue Pucker (seasonal, no item_number). Balford not included.
-- Run in the Supabase SQL editor BEFORE pushing the app code.

BEGIN;

ALTER TABLE items ADD COLUMN IF NOT EXISTS vendor_item_code TEXT;
-- Not UNIQUE: several items legitimately share one Bunzl product (napkins, topping cups, cookie containers).
CREATE INDEX IF NOT EXISTS items_vendor_item_code_idx ON items (vendor_item_code);

UPDATE items SET vendor_item_code = '10900754' WHERE id = 'e6428bf6-f451-49f0-b1b1-081f800b5513' AND item_number = '1043' AND name = 'Cookie Bags';  -- Bags & Carriers
UPDATE items SET vendor_item_code = 'M9560000' WHERE id = 'f9c3c85f-da2f-45a6-969f-a567e64dec92' AND item_number = '1222' AND name = 'Drink Carriers';  -- Bags & Carriers
UPDATE items SET vendor_item_code = '10060200' WHERE id = '63bbc9e3-a156-4d3e-81ed-4949e0bef9b3' AND item_number = '1221' AND name = 'Large Rita''s Paper Bags';  -- Bags & Carriers
UPDATE items SET vendor_item_code = '52490168' WHERE id = '1df61d3f-e75c-4599-8c4f-b7e43fac4d91' AND item_number = '1209' AND name = 'Plastic Bags';  -- Bags & Carriers
UPDATE items SET vendor_item_code = '10060201' WHERE id = 'dfe8cf2c-ada5-4edd-85ad-28c4bdfb2877' AND item_number = '1220' AND name = 'Small Rita''s Paper Bags';  -- Bags & Carriers
UPDATE items SET vendor_item_code = '52342901' WHERE id = '64d31d95-7fe4-4499-9db4-8b62f984bbf9' AND item_number = '0898' AND name = 'Dish Soap';  -- Cleaning Supplies
UPDATE items SET vendor_item_code = '75004229' WHERE id = 'cfce9c94-1333-4969-a764-98857e0a81cb' AND item_number = '0824' AND name = 'Hand Soap';  -- Cleaning Supplies
UPDATE items SET vendor_item_code = '35409202' WHERE id = '458ad427-fefc-4f98-ab55-0aab8cc485b9' AND item_number = '0831' AND name = 'Sanitizer';  -- Cleaning Supplies
UPDATE items SET vendor_item_code = '41665427' WHERE id = 'f6800765-c174-48f9-be48-412147b72377' AND item_number = '0243' AND name = 'Cake Cones';  -- Cones
UPDATE items SET vendor_item_code = '41660011' WHERE id = '88bd5b2e-6187-4466-99aa-661a8a11207e' AND item_number = '0257' AND name = 'Waffle Bowls';  -- Cones
UPDATE items SET vendor_item_code = '41665576' WHERE id = '2e6dc25f-70f5-4327-a8d9-d47e84a507b2' AND item_number = '0242' AND name = 'Waffle Cones';  -- Cones
UPDATE items SET vendor_item_code = 'H3470024' WHERE id = '0ff4bc16-9c46-4bde-bf87-014c495ec550' AND item_number = '0499' AND name = '2.5 Gallon Containers';  -- Containers & Cups
UPDATE items SET vendor_item_code = '39355508' WHERE id = '9c2aad61-26aa-4200-9d11-9d9c402575d6' AND item_number = '1602' AND name = '6-Pack Cookie Containers';  -- Containers & Cups
UPDATE items SET vendor_item_code = '22661707' WHERE id = '9e574463-c31e-4c59-aaaf-19013d3ee4a0' AND item_number = '0360' AND name = 'Gallon Containers';  -- Containers & Cups
UPDATE items SET vendor_item_code = '39355508' WHERE id = '18ee95b8-d324-453d-80cd-1c7256daea0b' AND item_number = '1602' AND name = 'Individual Hinged Cookie Containers';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'J6990050' WHERE id = '46d51a26-2ca4-4f97-bb44-74b30b9aada9' AND item_number = '0501' AND name = 'Kids Ice Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'M2100002' WHERE id = 'a981bbcf-2396-4c18-83d2-47288f4ddbeb' AND item_number = '2910' AND name = 'Large Custard Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'J6990048' WHERE id = 'c21d7888-1c9b-49fd-995d-17edbf6948fa' AND item_number = '1954' AND name = 'Large Ice Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'E7680177' WHERE id = '4cdc1eb9-6e95-4215-a944-db54d735e869' AND item_number = '1957' AND name = 'Large Milkshake Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = '12500693' WHERE id = '29628f4f-d098-43f4-859a-809ff546221d' AND item_number = '0333' AND name = 'Large Sundae Bowls';  -- Containers & Cups
UPDATE items SET vendor_item_code = '18200100' WHERE id = '28c03d0a-084d-448b-9450-ee0cc184e808' AND item_number = '1971' AND name = 'Pints';  -- Containers & Cups
UPDATE items SET vendor_item_code = '13400533' WHERE id = '91708735-43df-44b9-bde5-0712b73d96f0' AND item_number = '1973' AND name = 'Quarts';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'M2100001' WHERE id = '1d04f958-6bba-489f-91f6-ce11e0ed6c0f' AND item_number = '1995' AND name = 'Small Custard Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'J6990075' WHERE id = 'fa101d58-9286-4a73-badd-50e3343130fd' AND item_number = '1975' AND name = 'Small Ice Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = 'E7680176' WHERE id = 'e099ecd5-926e-4c4f-b357-703c05d063bb' AND item_number = '1956' AND name = 'Small Milkshake Cups';  -- Containers & Cups
UPDATE items SET vendor_item_code = '53790068' WHERE id = '1f896398-a4b1-407b-84a0-8290c58005f4' AND item_number = '0128' AND name = 'Banana / Banana Split';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790087' WHERE id = 'edf9b663-01ef-4cae-8564-91beea5b3fc0' AND item_number = '0159' AND name = 'Birthday Cake';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950017' WHERE id = '0eec66da-c7f9-4fdf-838f-d55c1a394a8b' AND item_number = '2150' AND name = 'Blackberry';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950019' WHERE id = 'b22c789a-df64-45c9-ba25-5bcca2af5c1f' AND item_number = '2149' AND name = 'Blue Hawaii';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790134' WHERE id = '03df78f0-17a7-4463-b25c-e4baca5509c6' AND item_number = '0119' AND name = 'Blue Raspberry';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790056' WHERE id = 'dcfa5b4c-b530-4b15-bb30-e4642f4d9d6e' AND item_number = '0102' AND name = 'Cherry';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790117' WHERE id = '0f30f677-da3b-4b59-91c6-a5071b43dcd6' AND item_number = '0103' AND name = 'Chocolate';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950012' WHERE id = 'f7ffb190-a892-4d67-8a57-bcec4e4c8850' AND item_number = '2143' AND name = 'Clementine';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790049' WHERE id = '8e1f62ed-1c67-4063-8e7d-77e23f834581' AND item_number = '0125' AND name = 'Coconut Cream';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790061' WHERE id = '4a4bfd9c-64b7-4900-9cfb-8b7eb67b1780' AND item_number = '0131' AND name = 'Cookies N Cream';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790144' WHERE id = 'd8d55106-013d-4f32-ab38-ab790679f451' AND item_number = '2102' AND name = 'Cotton Candy';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790088' WHERE id = 'ea6233f2-3653-452f-98e6-aa2f3fb19592' AND item_number = '2131' AND name = 'Georgia Peach';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790066' WHERE id = '1c3a0b79-0bd1-4f90-822f-3c83920dac6c' AND item_number = '0120' AND name = 'Green Apple';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790155' WHERE id = 'dd3fb322-af89-4781-bfbe-b70f5d9936f0' AND item_number = '2136' AND name = 'Gummy Bear';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790086' WHERE id = '29a2d0a7-e922-4db1-8f97-4bc14d9152f4' AND item_number = '0156' AND name = 'Island Fusion';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790140' WHERE id = '4714a63a-d3de-46c1-a906-b4f0196d27b9' AND item_number = '0163' AND name = 'Juicy Pear';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790089' WHERE id = 'c53d1e22-5f85-4b7a-8172-e5e0a636565a' AND item_number = '0161' AND name = 'Key Lime';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950015' WHERE id = '76690ec1-7baa-417d-993d-c6e4512055ac' AND item_number = '2146' AND name = 'Kiwi Melon';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950011' WHERE id = '30f41d8b-4846-48bb-8e37-b94038b4b6ab' AND item_number = '2142' AND name = 'Koolaid Sharkleberry';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950008' WHERE id = 'f1d65b96-a04e-407b-91ce-27e00314aece' AND item_number = '2139' AND name = 'Koolaid Tropical Punch';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790030' WHERE id = 'f0d1d56c-fe6f-407d-964a-d79bafb373fb' AND item_number = '0101' AND name = 'Lemon';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790032' WHERE id = 'fb7210b5-a81c-4592-9aba-0b5b966095a7' AND item_number = '0117' AND name = 'Mango';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950018' WHERE id = '3281851b-3dbd-4507-a387-59b7a89166ed' AND item_number = '2147' AND name = 'Mermaid';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790010' WHERE id = 'e53dafba-a775-4781-9e04-667a88fa5542' AND item_number = '0127' AND name = 'Mint Chip';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950013' WHERE id = 'aa826d86-1f0d-46b8-94f6-927ac1a8b7cf' AND item_number = '2144' AND name = 'Passionfruit Paloma';  -- Ice Mix
UPDATE items SET vendor_item_code = 'J3950014' WHERE id = 'e03b602a-de1b-4e42-907c-161ec829eec3' AND item_number = '2145' AND name = 'Peeps';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790036' WHERE id = '63fadae5-55f4-48e6-bc9e-4fdf681a5ea4' AND item_number = '0105' AND name = 'Pina Colada';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790097' WHERE id = '2e347e98-9a3f-42c9-808b-75773a8a78e4' AND item_number = '1119' AND name = 'Pineapple';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790091' WHERE id = 'b6c41a6d-c518-4321-a87a-c020024eaa0b' AND item_number = '0164' AND name = 'Pumpkin';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790125' WHERE id = '9ff62651-fe9a-4867-a718-f363f077b5d1' AND item_number = '0123' AND name = 'Raspberry';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790037' WHERE id = '353a125d-4e9f-4aa8-9c46-00811f8ba21b' AND item_number = '0114' AND name = 'Root Beer';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790131' WHERE id = '22eae464-f367-45b3-8d53-a1900981843f' AND item_number = '0166' AND name = 'S''mores';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790139' WHERE id = '1cd8063e-08da-47df-9a87-a4681f0ee1c0' AND item_number = '0111' AND name = 'Sour Patch Kids Red';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790000' WHERE id = 'ebb60d56-93fd-4fdd-84d7-9a1c056fe532' AND item_number = '2137' AND name = 'Sour Patch Watermelon';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790132' WHERE id = '7991386e-6498-46cf-afec-f3b6f08077ca' AND item_number = '0118' AND name = 'Strawberry';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790105' WHERE id = '847a4549-d85e-454a-a923-e0ed5b195c7c' AND item_number = '0177' AND name = 'Sugar Free Cherry';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790003' WHERE id = '8bc36664-4c4f-4856-8f86-2a3db20844fb' AND item_number = '2108' AND name = 'Sugar Free Dragon Fruit';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790104' WHERE id = '6def3a05-9d8e-415a-81e5-676fd138fb75' AND item_number = '0181' AND name = 'Sugar Free Mango Peach';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790108' WHERE id = 'fee17433-d72d-4873-b44c-33157968613f' AND item_number = '0179' AND name = 'Sugar Free Pink Lemonade';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790145' WHERE id = '228b35a7-119c-4941-a0bf-d8709c74d3df' AND item_number = '2103' AND name = 'Swedish Fish';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790133' WHERE id = '318fef22-fac3-46c9-8277-737c90980564' AND item_number = '0121' AND name = 'Vanilla';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790135' WHERE id = '1bb9ac24-8ca5-4328-8a25-3b1b81052dfb' AND item_number = '0124' AND name = 'Watermelon';  -- Ice Mix
UPDATE items SET vendor_item_code = '53790065' WHERE id = '4d46923e-0dea-40b1-b110-b1dd058330b0' AND item_number = '0140' AND name = 'Wild Black Cherry';  -- Ice Mix | CSV name "Wild Cherry"
UPDATE items SET vendor_item_code = '22662239' WHERE id = '1086bd0f-9cb9-48c6-b4d6-ffe9edc1db71' AND item_number = '0361' AND name = 'Gallon Lids';  -- Lids
UPDATE items SET vendor_item_code = '12500111' WHERE id = '1c535fdf-126b-4ffe-b388-8753dfee3751' AND item_number = '1946' AND name = 'Kids Ice Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = '18208869' WHERE id = '6849cc18-2d74-4efc-a0b6-fe82c064b629' AND item_number = '0303' AND name = 'Large Ice Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = '12500716' WHERE id = 'f74f4f7b-c982-4c18-bb7a-bc412f67be0a' AND item_number = '0416' AND name = 'Large Sundae Bowl Lids';  -- Lids
UPDATE items SET vendor_item_code = '18200105' WHERE id = '736bc56b-08b0-4edf-81f1-581507fdc2eb' AND item_number = '1972' AND name = 'Pint Lids';  -- Lids
UPDATE items SET vendor_item_code = '14701434' WHERE id = '7d92d5c3-9e7d-477d-bff8-1d277577c7f3' AND item_number = '1974' AND name = 'Quart Ice Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = 'E7680124' WHERE id = '18e8705e-3229-44cd-81e2-59dac82c6e6f' AND item_number = '1958' AND name = 'Small Hole Milkshake Lids';  -- Lids | CSV row "Milkshake Cup Lids" 1958, owner confirmed Small Hole
UPDATE items SET vendor_item_code = 'J6990097' WHERE id = '4f238e7a-8350-45cd-bd2a-801d0cf4b26c' AND item_number = '1976' AND name = 'Small Ice Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = 'M2100000' WHERE id = 'ace40481-078f-4aa0-8c93-6454246fe022' AND item_number = '1996' AND name = 'Small/Large Custard Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = '12501397' WHERE id = '6eeac8c6-5357-4bb6-8d92-35294c68f4ba' AND item_number = '0322' AND name = 'Topping Cup Lids';  -- Lids
UPDATE items SET vendor_item_code = '14100865' WHERE id = '817ec84f-dab7-472a-a289-9cc4e2c6d9e1' AND item_number = '0577' AND name = 'Brown Small Napkins';  -- Napkins & Paper
UPDATE items SET vendor_item_code = '78000008' WHERE id = 'ebf664fd-4ad1-4e7d-bb34-db931a3ecd04' AND item_number = '0805' AND name = 'Paper Towels';  -- Napkins & Paper
UPDATE items SET vendor_item_code = '25608507' WHERE id = '0a25934e-01db-4a93-a792-2ff7cd54b274' AND item_number = '0806' AND name = 'Pink Rags';  -- Napkins & Paper
UPDATE items SET vendor_item_code = '14100865' WHERE id = '472827fc-af7f-4db5-8d59-243e3fad87b0' AND item_number = '0577' AND name = 'White Napkins';  -- Napkins & Paper
UPDATE items SET vendor_item_code = 'M9260052' WHERE id = 'b33c5736-a3cd-446a-bfa5-532ee7627aa9' AND item_number = '0338' AND name = 'Large Straws';  -- Spoons & Straws
UPDATE items SET vendor_item_code = '75003678' WHERE id = 'b0577ddc-624d-4f66-ac99-80963c76164c' AND item_number = '0311' AND name = 'Long Spoons';  -- Spoons & Straws
UPDATE items SET vendor_item_code = '75002494' WHERE id = '328427ac-22ef-4922-898b-b32adf9e390f' AND item_number = '0307' AND name = 'Regular Spoons';  -- Spoons & Straws
UPDATE items SET vendor_item_code = '75000073' WHERE id = '4117a042-b33f-4af5-a169-d9f034630a0b' AND item_number = '0352' AND name = 'Sample Spoons';  -- Spoons & Straws
-- HELD (9-char code, confirm on invoice first): UPDATE items SET vendor_item_code = '743043191' WHERE id = 'be87eee6-73fe-470f-afff-1953482b14da' AND item_number = '1223' AND name = 'DoorDash Stickers';  -- Stickers & Receipts
UPDATE items SET vendor_item_code = 'L6390026' WHERE id = '63f23de7-1e7f-4caa-8ed7-82b466cb64a6' AND item_number = '1732' AND name = 'Banana';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390020' WHERE id = '8c200d62-0b56-4549-905c-4bbe12ec13d1' AND item_number = '1733' AND name = 'Black Raspberry';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390021' WHERE id = '8669325e-7c41-4182-b2eb-781ae795b472' AND item_number = '1734' AND name = 'Butter Pecan';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390016' WHERE id = 'fb2a7bf1-025b-4ca0-9417-ee9b3d66fcab' AND item_number = '1735' AND name = 'Cake Batter';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390000' WHERE id = '33fc41b7-a15a-4874-8153-f724183330b0' AND item_number = '2768' AND name = 'Campfire S''mores';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390022' WHERE id = 'b3038ae9-6cf5-4b01-9719-c650e334eeb6' AND item_number = '1736' AND name = 'Cheesecake';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390018' WHERE id = '3c24fb6e-9bb4-40b5-b53d-e7f824ba41f9' AND item_number = '1737' AND name = 'Coffee';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390017' WHERE id = '858833cf-b8fa-4397-b249-5c7d898cc9a5' AND item_number = '1739' AND name = 'Mint';  -- Syrups
UPDATE items SET vendor_item_code = 'L6390025' WHERE id = '11f45427-7ea9-40e9-b6ad-e3d7c3a9ef7e' AND item_number IS NULL AND name = 'Salted Caramel';  -- Syrups | not in CSV; Bunzl invoice 70282859 (4-digit 1742, item_number left NULL)
UPDATE items SET vendor_item_code = '53790082' WHERE id = 'f5ce66a5-1fb8-4b90-b95d-13b7301c1502' AND item_number = '2723' AND name = 'Chocolate Base';  -- Things to Make Ice
UPDATE items SET vendor_item_code = 'K1700001' WHERE id = '381c8562-743a-4dd1-a881-b0cb685a813f' AND item_number = '1084' AND name = 'Cream Ice Powder';  -- Things to Make Ice
UPDATE items SET vendor_item_code = '53790002' WHERE id = 'f54701cf-2f34-4834-a4fb-5285ca93410a' AND item_number = '0270' AND name = 'Milkshake Syrup';  -- Things to Make Ice
UPDATE items SET vendor_item_code = 'G6670004' WHERE id = '95d08d57-dbc9-4107-96f9-f037b30f37f0' AND item_number = '1071' AND name = 'Sugar';  -- Things to Make Ice
UPDATE items SET vendor_item_code = '18202614' WHERE id = '3396b311-4ef6-431b-bd0b-56ff3c4fa6fd' AND item_number = '0354' AND name = 'Paper Souffle/Sample Cups';  -- Topping Containers
UPDATE items SET vendor_item_code = '12500428' WHERE id = '25176d03-b5eb-496c-9d7f-9513a05b388a' AND item_number = '0327' AND name = 'Rita''s Logo Topping Cups';  -- Topping Containers
UPDATE items SET vendor_item_code = '12500428' WHERE id = 'f571bf46-c820-4924-9d3d-9d70a7bed194' AND item_number = '0327' AND name = 'Translucent Plastic Topping Cups';  -- Topping Containers
UPDATE items SET vendor_item_code = 'G0680002' WHERE id = 'f8e91ac5-c63a-4753-8693-9520e62430ce' AND item_number = '0266' AND name = 'Chocolate Sprinkles';  -- Toppings - Dry
-- HELD (9-char code, confirm on invoice first): UPDATE items SET vendor_item_code = 'M95700001' WHERE id = 'ad3dc226-8e8c-4637-aa44-2526be6b8285' AND item_number = '2724' AND name = 'Glitter Sprinkles';  -- Toppings - Dry
UPDATE items SET vendor_item_code = 'A4510360' WHERE id = '7d21c33d-e047-457d-aafa-01fe8a7f3243' AND item_number = '0232' AND name = 'M&Ms';  -- Toppings - Dry
UPDATE items SET vendor_item_code = 'F1320000' WHERE id = 'c34cfe20-c18a-4e13-837a-c7ad92f7ca46' AND item_number = '2790' AND name = 'Nilla Wafers';  -- Toppings - Dry
UPDATE items SET vendor_item_code = 'F8870014' WHERE id = '0c4ec934-766f-49de-b354-316efe9bff0d' AND item_number = '2748' AND name = 'Oreo Pieces';  -- Toppings - Dry
UPDATE items SET vendor_item_code = 'G0680001' WHERE id = '4f97ccbd-7f69-40e2-a7c7-2fddb81b952b' AND item_number = '0265' AND name = 'Rainbow Sprinkles';  -- Toppings - Dry
-- HELD (9-char code, confirm on invoice first): UPDATE items SET vendor_item_code = 'L59900031' WHERE id = '6142ed2c-59f3-4a7c-948a-eb544e0c7e10' AND item_number = '2786' AND name = 'Tajin';  -- Toppings - Dry
UPDATE items SET vendor_item_code = '53790092' WHERE id = 'd4343bf1-ba26-4274-b4fa-d3b5b57f3412' AND item_number = '2726' AND name = 'Apple Topping';  -- Toppings - Wet
UPDATE items SET vendor_item_code = '53790011' WHERE id = 'f390195c-da99-4a39-bd67-2f0148cbed4b' AND item_number = '0201' AND name = 'Crushed Cherries';  -- Toppings - Wet
UPDATE items SET vendor_item_code = 'N1370000' WHERE id = 'fb72eb64-cd7f-4e5f-8b40-0fd37876f53b' AND item_number = '2783' AND name = 'Diced Black Cherries';  -- Toppings - Wet
UPDATE items SET vendor_item_code = '53790084' WHERE id = '3a0151c3-fc53-45f7-80e2-e69a7bc907cd' AND item_number = '2727' AND name = 'Pineapple Topping';  -- Toppings - Wet
UPDATE items SET vendor_item_code = '53790149' WHERE id = '2850216c-8f2b-4299-82c2-4fcaecfcda0e' AND item_number = '2745' AND name = 'Pumpkin Cream Topping';  -- Toppings - Wet
UPDATE items SET vendor_item_code = '53790138' WHERE id = '425b3c19-1fd0-4f6b-9250-1b4bdaf6246e' AND item_number = '0253' AND name = 'Strawberry Topping';  -- Toppings - Wet
UPDATE items SET vendor_item_code = 'N1370002' WHERE id = '87f90fb0-77c1-4121-9352-7dd9160dc352' AND item_number = '2782' AND name = 'Whole Cherries';  -- Toppings - Wet
UPDATE items SET vendor_item_code = '78000096' WHERE id = 'a10deb7d-85f8-4d42-b1cd-38a23e1216f3' AND item_number = '0803' AND name = 'Black Trash Bags';  -- Trash Bags
UPDATE items SET vendor_item_code = '75006280' WHERE id = '0805daa2-14f0-473b-826b-caf6440b7c46' AND item_number = '0835' AND name = 'L Gloves';  -- Trash Bags
UPDATE items SET vendor_item_code = '75006270' WHERE id = '5ff4c7e9-4af2-4ca3-a122-bac62c2cf085' AND item_number = '0834' AND name = 'M Gloves';  -- Trash Bags

-- Verify before COMMIT: expect 117 rows with a code
SELECT count(*) FROM items WHERE vendor_item_code IS NOT NULL;
SELECT name, category, item_number, vendor_item_code FROM items WHERE distributor = 'bunzl' ORDER BY category, name;

 COMMIT;   -- uncomment after the counts look right (or ROLLBACK;)

-- ---------------------------------------------------------------------------
-- RUN AFTER (run manually by the owner on 2026-11-11, after the transaction above committed)
-- Follow-up UPDATEs, each pinned to id + item_number + name like the ones above.
-- Note: these items' item_number (and Sour Blue Pucker's distributor -> 'bunzl')
-- were set outside this file, before these ran.
-- ---------------------------------------------------------------------------
UPDATE items SET vendor_item_code = 'L6390025' WHERE id = '11f45427-7ea9-40e9-b6ad-e3d7c3a9ef7e' AND item_number = '1742' AND name = 'Salted Caramel';  -- Syrups | Bunzl invoice 70282859
UPDATE items SET vendor_item_code = 'J3950016' WHERE id = 'e3f31f36-d4f8-497c-b79c-5fa2fad8b7b1' AND item_number = '2148' AND name = 'Sour Blue Pucker';  -- Ice Mix | "Sour Blue Pucker Dark Blue 4x1gal"
