-- Conversion factor import from Riley's CSV export.
-- units_per_sub_unit is new; secondary_unit already exists (dual-count field on Count Entry).
-- Exact match on item_id, na=true rows already excluded.
ALTER TABLE items ADD COLUMN IF NOT EXISTS units_per_sub_unit INTEGER;

UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 2 WHERE id = 'f9c3c85f-da2f-45a6-969f-a567e64dec92'; -- Drink Carriers
UPDATE items SET secondary_unit = 'Bottles', units_per_sub_unit = 4 WHERE id = '458ad427-fefc-4f98-ab55-0aab8cc485b9'; -- Sanitizer
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 6 WHERE id = 'f6800765-c174-48f9-be48-412147b72377'; -- Cake Cones
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 6 WHERE id = '88bd5b2e-6187-4466-99aa-661a8a11207e'; -- Waffle Bowls
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = '2e6dc25f-70f5-4327-a8d9-d47e84a507b2'; -- Waffle Cones
UPDATE items SET secondary_unit = 'Sleeve', units_per_sub_unit = 1 WHERE id = '18ee95b8-d324-453d-80cd-1c7256daea0b'; -- Individual Hinged Cookie Containers
UPDATE items SET secondary_unit = 'sleeves', units_per_sub_unit = 20 WHERE id = '46d51a26-2ca4-4f97-bb44-74b30b9aada9'; -- Kids Ice Cups
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = 'c21d7888-1c9b-49fd-995d-17edbf6948fa'; -- Large Ice Cups
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '4cdc1eb9-6e95-4215-a944-db54d735e869'; -- Large Milkshake Cups
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 8 WHERE id = '29628f4f-d098-43f4-859a-809ff546221d'; -- Large Sundae Bowls
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '28c03d0a-084d-448b-9450-ee0cc184e808'; -- Pints
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '91708735-43df-44b9-bde5-0712b73d96f0'; -- Quarts
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '1d04f958-6bba-489f-91f6-ce11e0ed6c0f'; -- Small Custard Cups
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = 'fa101d58-9286-4a73-badd-50e3343130fd'; -- Small Ice Cups
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = 'e099ecd5-926e-4c4f-b357-703c05d063bb'; -- Small Milkshake Cups
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 2 WHERE id = '740f3bca-03d0-4aba-8386-f12afbe393d6'; -- Chocolate Custard Bags
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 2 WHERE id = 'fe2a511f-da71-473e-a362-438d4cf549c4'; -- Vanilla Custard Bags
UPDATE items SET secondary_unit = 'Bottles', units_per_sub_unit = 4 WHERE id = 'e43be1e9-b318-40e9-9068-60811ea7e176'; -- Cold Brew Concentrate
UPDATE items SET secondary_unit = 'Bottles', units_per_sub_unit = 4 WHERE id = 'd4f01d1e-7d03-4846-9781-21aa1628a658'; -- Matcha Syrup
UPDATE items SET secondary_unit = 'Bottles', units_per_sub_unit = 24 WHERE id = '828f8642-5bb7-4548-8c3b-4c5658c03748'; -- Water Bottles
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '1f896398-a4b1-407b-84a0-8290c58005f4'; -- Banana / Banana Split
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'edf9b663-01ef-4cae-8564-91beea5b3fc0'; -- Birthday Cake
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '0eec66da-c7f9-4fdf-838f-d55c1a394a8b'; -- Blackberry
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'b22c789a-df64-45c9-ba25-5bcca2af5c1f'; -- Blue Hawaii
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '03df78f0-17a7-4463-b25c-e4baca5509c6'; -- Blue Raspberry
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'a3a8a20c-dca1-47e9-b41f-b9a6eee2aebb'; -- Cheesecake
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'dcfa5b4c-b530-4b15-bb30-e4642f4d9d6e'; -- Cherry
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '0f30f677-da3b-4b59-91c6-a5071b43dcd6'; -- Chocolate
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'f7ffb190-a892-4d67-8a57-bcec4e4c8850'; -- Clementine
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '8e1f62ed-1c67-4063-8e7d-77e23f834581'; -- Coconut Cream
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'db4f8995-edd5-4e36-b760-c492bcd27e73'; -- Cola
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '4a4bfd9c-64b7-4900-9cfb-8b7eb67b1780'; -- Cookies N Cream
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'd8d55106-013d-4f32-ab38-ab790679f451'; -- Cotton Candy
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'ea6233f2-3653-452f-98e6-aa2f3fb19592'; -- Georgia Peach
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '1c3a0b79-0bd1-4f90-822f-3c83920dac6c'; -- Green Apple
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'dd3fb322-af89-4781-bfbe-b70f5d9936f0'; -- Gummy Bear
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '29a2d0a7-e922-4db1-8f97-4bc14d9152f4'; -- Island Fusion
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '4714a63a-d3de-46c1-a906-b4f0196d27b9'; -- Juicy Pear
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'c53d1e22-5f85-4b7a-8172-e5e0a636565a'; -- Key Lime
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '76690ec1-7baa-417d-993d-c6e4512055ac'; -- Kiwi Melon
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '30f41d8b-4846-48bb-8e37-b94038b4b6ab'; -- Koolaid Sharkleberry
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'f1d65b96-a04e-407b-91ce-27e00314aece'; -- Koolaid Tropical Punch
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'f0d1d56c-fe6f-407d-964a-d79bafb373fb'; -- Lemon
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'fb7210b5-a81c-4592-9aba-0b5b966095a7'; -- Mango
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '3281851b-3dbd-4507-a387-59b7a89166ed'; -- Mermaid
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'e53dafba-a775-4781-9e04-667a88fa5542'; -- Mint Chip
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'aa826d86-1f0d-46b8-94f6-927ac1a8b7cf'; -- Passionfruit Paloma
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'e03b602a-de1b-4e42-907c-161ec829eec3'; -- Peeps
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '63fadae5-55f4-48e6-bc9e-4fdf681a5ea4'; -- Pina Colada
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '2e347e98-9a3f-42c9-808b-75773a8a78e4'; -- Pineapple
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'b6c41a6d-c518-4321-a87a-c020024eaa0b'; -- Pumpkin
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'c82a198c-6bed-4b28-ac62-0fa8835c994f'; -- Purple Candy
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '9ff62651-fe9a-4867-a718-f363f077b5d1'; -- Raspberry
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '353a125d-4e9f-4aa8-9c46-00811f8ba21b'; -- Root Beer
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '22eae464-f367-45b3-8d53-a1900981843f'; -- S'mores
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '5a601b69-8b7f-4eb4-a60c-0db0e9061e12'; -- Skittles
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'e3f31f36-d4f8-497c-b79c-5fa2fad8b7b1'; -- Sour Blue Pucker
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '1cd8063e-08da-47df-9a87-a4681f0ee1c0'; -- Sour Patch Kids Red
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = 'ebb60d56-93fd-4fdd-84d7-9a1c056fe532'; -- Sour Patch Watermelon
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '7991386e-6498-46cf-afec-f3b6f08077ca'; -- Strawberry
UPDATE items SET secondary_unit = 'Half gallons', units_per_sub_unit = 6 WHERE id = '847a4549-d85e-454a-a923-e0ed5b195c7c'; -- Sugar Free Cherry
UPDATE items SET secondary_unit = 'Half gallons', units_per_sub_unit = 6 WHERE id = '8bc36664-4c4f-4856-8f86-2a3db20844fb'; -- Sugar Free Dragon Fruit
UPDATE items SET secondary_unit = 'Half gallons', units_per_sub_unit = 6 WHERE id = '6def3a05-9d8e-415a-81e5-676fd138fb75'; -- Sugar Free Mango Peach
UPDATE items SET secondary_unit = 'Half gallons', units_per_sub_unit = 6 WHERE id = 'fee17433-d72d-4873-b44c-33157968613f'; -- Sugar Free Pink Lemonade
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '228b35a7-119c-4941-a0bf-d8709c74d3df'; -- Swedish Fish
UPDATE items SET secondary_unit = 'Gallons', units_per_sub_unit = 4 WHERE id = '318fef22-fac3-46c9-8277-737c90980564'; -- Vanilla

-- Handwritten list (name-matched, confirmed by owner 2026-07-06)
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 8 WHERE id = 'f74f4f7b-c982-4c18-bb7a-bc412f67be0a'; -- Large Sundae Bowl Lids [Sundae Bowl Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '88baa1f4-2af0-431f-ba81-34510db13759'; -- Large Hole Milkshake Lids [Concrete Lids (big hole)]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '1c535fdf-126b-4ffe-b388-8753dfee3751'; -- Kids Ice Cup Lids [Kids Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = '4f238e7a-8350-45cd-bd2a-801d0cf4b26c'; -- Small Ice Cup Lids [Small Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = '6849cc18-2d74-4efc-a0b6-fe82c064b629'; -- Large Ice Cup Lids [Large Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = 'ace40481-078f-4aa0-8c93-6454246fe022'; -- Small/Large Custard Cup Lids [Custard Cup Lids (confirmed)]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '6eeac8c6-5357-4bb6-8d92-35294c68f4ba'; -- Topping Cup Lids [Topping Cup Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = 'f571bf46-c820-4924-9d3d-9d70a7bed194'; -- Translucent Plastic Topping Cups [Topping Cups]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 25 WHERE id = '25176d03-b5eb-496c-9d7f-9513a05b388a'; -- Rita's Logo Topping Cups [Rita's Topping Cups]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '3396b311-4ef6-431b-bd0b-56ff3c4fa6fd'; -- Paper Souffle/Sample Cups [Souffle Cups]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 4 WHERE id = '0c4ec934-766f-49de-b354-316efe9bff0d'; -- Oreo Pieces [Oreo Toppings]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 4 WHERE id = '1fbde056-0049-4984-9d1c-7d43986f8d07'; -- Hot Fudge [Hot Fudge & Caramel]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 4 WHERE id = 'ba27c483-8e0d-41ed-b960-cbb09c76fcb1'; -- Caramel [Hot Fudge & Caramel]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 2 WHERE id = '7d21c33d-e047-457d-aafa-01fe8a7f3243'; -- M&Ms [M&M's]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 4 WHERE id = '71c42ab9-54da-419e-93f2-466ced1b1b86'; -- Gummy Bears [Gummy Bears]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 2 WHERE id = 'eb9b5c2d-f22e-4f9f-805a-ff17c63366de'; -- Peppermint [Peppermint]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 1 WHERE id = 'cb2403a7-41b1-40a8-801b-14990263b959'; -- Peanuts [Peanuts]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 36 WHERE id = '817ec84f-dab7-472a-a289-9cc4e2c6d9e1'; -- Brown Small Napkins [Small Brown Napkins]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 16 WHERE id = 'ebf664fd-4ad1-4e7d-bb34-db931a3ecd04'; -- Paper Towels [Paper Towels]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 12 WHERE id = '472827fc-af7f-4db5-8d59-243e3fad87b0'; -- White Napkins [White Napkins]
UPDATE items SET secondary_unit = 'Boxes', units_per_sub_unit = 10 WHERE id = '5ff4c7e9-4af2-4ca3-a122-bac62c2cf085'; -- M Gloves [S/L Gloves]
UPDATE items SET secondary_unit = 'Boxes', units_per_sub_unit = 10 WHERE id = '0805daa2-14f0-473b-826b-caf6440b7c46'; -- L Gloves [S/L Gloves]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 2 WHERE id = '11b1ecd3-47ca-474d-aad8-2b71d45d7422'; -- Reese's Cups [Reese's Cups]
UPDATE items SET secondary_unit = 'Boxes', units_per_sub_unit = 4 WHERE id = 'ecb22d1d-877c-43f9-a993-56dc4e05c00d'; -- Andes [Andes Mints]
UPDATE items SET secondary_unit = 'Cans', units_per_sub_unit = 3 WHERE id = 'ab9c69c4-6cd6-4d2a-aef7-b15f661ddb9c'; -- Whipped Cream [Whipped Cream]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 20 WHERE id = '736bc56b-08b0-4edf-81f1-581507fdc2eb'; -- Pint Lids [Pint Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = '7d92d5c3-9e7d-477d-bff8-1d277577c7f3'; -- Quart Ice Cup Lids [Quart Lids]
UPDATE items SET secondary_unit = 'Sleeves', units_per_sub_unit = 10 WHERE id = '18e8705e-3229-44cd-81e2-59dac82c6e6f'; -- Small Hole Milkshake Lids [Small Hole Milkshake Lids]
UPDATE items SET secondary_unit = 'Containers', units_per_sub_unit = 6 WHERE id = '080c917f-18dc-49cc-9ad8-eb34dd8dd6fc'; -- Peanut Butter Topping [Peanut Butter]
UPDATE items SET secondary_unit = 'Bottles', units_per_sub_unit = 2 WHERE id = 'f5ce66a5-1fb8-4b90-b95d-13b7301c1502'; -- Chocolate Base [Chocolate Base]
UPDATE items SET secondary_unit = 'Half gallons', units_per_sub_unit = 2 WHERE id = 'f54701cf-2f34-4834-a4fb-5285ca93410a'; -- Milkshake Syrup [Milkshake Syrup]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 12 WHERE id = 'e437892a-cab9-4ac2-b3b3-fda958096ad7'; -- Lime Concentrate [Lime & Lemon Concentrate]
UPDATE items SET secondary_unit = 'Bags', units_per_sub_unit = 12 WHERE id = 'f8c4684d-1486-47d7-8850-a8f02cac7742'; -- Lemon Concentrate [Lime & Lemon Concentrate]
UPDATE items SET secondary_unit = 'Rolls', units_per_sub_unit = 13 WHERE id = '06ca85ef-3995-454f-a138-de3655e9bf3a'; -- Receipt Paper [Receipt Paper]
