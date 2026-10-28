-- Seeds the full 89-flavor catalog from Joshua's Rita's Flavor Portal CSV,
-- and pre-fills the CURRENT week (Mon Oct 26, 2026) with the 12 flavors
-- that were marked active_now = true in that export.
-- Run AFTER add-flavors.sql and add-flavor-type.sql.
--
-- Note: the CSV has the same name under more than one type ("Cherry"
-- exists as both an italian_ice and a sugar_free flavor — two distinct
-- real items), so this targets the (name, type) unique constraint, not
-- name alone (see add-flavor-type-fixes.sql if you already ran an earlier
-- version of this file against the old name-only constraint — it silently
-- dropped the sugar-free Cherry, and that file repairs it).

-- 1. Full catalog (all 89, every one starts active/available to pick)
insert into flavors (name, type, active) values
('Apple Berry Blue', 'italian_ice', true),
('Banana', 'italian_ice', true),
('Blackberry', 'italian_ice', true),
('Blue Hawaii', 'italian_ice', true),
('Blue Raspberry', 'italian_ice', true),
('Blueberry', 'italian_ice', true),
('Blueberry Lemonade', 'italian_ice', true),
('Carnival', 'italian_ice', true),
('Cherry', 'italian_ice', true),
('Cherry Lemonade', 'italian_ice', true),
('Cherry Limeade', 'italian_ice', true),
('Chocolate', 'italian_ice', true),
('Chocolate Chocolate Chip', 'italian_ice', true),
('Chocolate Peanut Butter', 'italian_ice', true),
('Clementine', 'italian_ice', true),
('Cotton Candy', 'italian_ice', true),
('Dr. Pepper', 'italian_ice', true),
('Georgia Peach', 'italian_ice', true),
('Green Apple', 'italian_ice', true),
('Gummy Bear', 'italian_ice', true),
('Island Fusion', 'italian_ice', true),
('Juicy Pear', 'italian_ice', true),
('Key Lime', 'italian_ice', true),
('Kiwi Melon', 'italian_ice', true),
('KOOL-AID Sharkleberry Fin', 'italian_ice', true),
('KOOL-AID Tropical Punch', 'italian_ice', true),
('Lemon', 'italian_ice', true),
('MaliBLUE Freeze Smart Snack', 'italian_ice', true),
('Mango', 'italian_ice', true),
('Mango-Pineapple', 'italian_ice', true),
('Mango-Strawberry', 'italian_ice', true),
('Margarita', 'italian_ice', true),
('Mermaid Ice', 'italian_ice', true),
('Passionfruit Paloma', 'italian_ice', true),
('Peach Ring', 'italian_ice', true),
('PEEPS Party Cake Ice', 'italian_ice', true),
('Pina Colada', 'italian_ice', true),
('Pineapple', 'italian_ice', true),
('Raspberry Lemonade', 'italian_ice', true),
('Raspberry', 'italian_ice', true),
('Razzle Red Smart Snack', 'italian_ice', true),
('Rocket Pop', 'italian_ice', true),
('Root Beer', 'italian_ice', true),
('Shirley Temple', 'italian_ice', true),
('Sour Blue Pucker', 'italian_ice', true),
('SOUR PATCH KIDS Red', 'italian_ice', true),
('SOUR PATCH KIDS Watermelon', 'italian_ice', true),
('Strawberry', 'italian_ice', true),
('Strawberry Colada', 'italian_ice', true),
('Strawberry Lemonade', 'italian_ice', true),
('Strawberry Margarita', 'italian_ice', true),
('Strawberry-Watermelon', 'italian_ice', true),
('Swedish Fish', 'italian_ice', true),
('Tropical Daiquiri', 'italian_ice', true),
('Unicorn', 'italian_ice', true),
('Vanilla', 'italian_ice', true),
('Very Berry Smart Snack', 'italian_ice', true),
('Watermelon', 'italian_ice', true),
('Wild Black Cherry', 'italian_ice', true),
('Witches'' Brew-Berry', 'italian_ice', true),
('Zombie''s Blood', 'italian_ice', true),
('Banana Split Cream', 'cream_ice', true),
('Birthday Cake', 'cream_ice', true),
('Brookie Dough', 'cream_ice', true),
('Chocolate Cupcake Cream Ice', 'cream_ice', true),
('Chocolate-Covered Banana', 'cream_ice', true),
('Chocolate-Covered Strawberry', 'cream_ice', true),
('Coconut Cream', 'cream_ice', true),
('Cookie Dough', 'cream_ice', true),
('Cookies ''n Cream', 'cream_ice', true),
('Frozen Hot Cocoa', 'cream_ice', true),
('Fudge Brownie', 'cream_ice', true),
('Marshmallow-Peanut Butter', 'cream_ice', true),
('Mint Chocolate Chip', 'cream_ice', true),
('Mint Oreo', 'cream_ice', true),
('Orange Dreamsicle', 'cream_ice', true),
('Pumpkin Pie', 'cream_ice', true),
('Raspberries n'' Cream', 'cream_ice', true),
('Root Beer Float', 'cream_ice', true),
('S''mores', 'cream_ice', true),
('Strawberries n Cream', 'cream_ice', true),
('Strawberry Banana', 'cream_ice', true),
('Watermelon Chip', 'cream_ice', true),
('Cherry', 'sugar_free', true),
('Dragonfruit', 'sugar_free', true),
('Mango Dragonfruit', 'sugar_free', true),
('Mango Peach', 'sugar_free', true),
('Ritas Retro Sugar-Free Pink Lemonade', 'sugar_free', true),
('Tangerine', 'sugar_free', true)
on conflict (name, type) do nothing;

-- 2. Current week (Monday Oct 26, 2026)
insert into flavor_weeks (week_start) values ('2026-10-26')
on conflict (week_start) do nothing;

-- 3. Pre-fill this week's 12 slots with what was marked active_now = true
insert into flavor_week_slots (week_id, slot_number, flavor_id, flavor_name, flavor_type)
select
  (select id from flavor_weeks where week_start = '2026-10-26'),
  slot_number,
  (select id from flavors where name = flavor_name and type = flavor_type),
  flavor_name,
  flavor_type
from (values
  (1, 'Apple Berry Blue', 'italian_ice'),
  (2, 'Banana', 'italian_ice'),
  (3, 'Carnival', 'italian_ice'),
  (4, 'Mango', 'italian_ice'),
  (5, 'Margarita', 'italian_ice'),
  (6, 'Passionfruit Paloma', 'italian_ice'),
  (7, 'Vanilla', 'italian_ice'),
  (8, 'Witches'' Brew-Berry', 'italian_ice'),
  (9, 'Zombie''s Blood', 'italian_ice'),
  (10, 'Frozen Hot Cocoa', 'cream_ice'),
  (11, 'Mint Oreo', 'cream_ice'),
  (12, 'Mango Peach', 'sugar_free')
) as t(slot_number, flavor_name, flavor_type)
on conflict (week_id, slot_number) do nothing;
