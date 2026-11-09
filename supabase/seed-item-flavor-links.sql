-- Patch 45 Phase 1 -- links real Ice Mix items to their matching flavor,
-- so the flavor's program tag can show on Manage Items/Current Stock/
-- Order List/Count. Idempotent (every statement is guarded by `flavor_id
-- is null`, so re-running this never overwrites a link Josh has since
-- changed by hand in Manage Items). Requires add-item-flavor-link.sql to
-- have been run first (adds the column). Updates only, by exact item name
-- + category = 'Ice Mix', matched against the exact flavor name + type
-- (flavors are unique by (name, type), not name alone -- e.g. "Cherry"
-- exists as both italian_ice and sugar_free).
--
-- 44 of the real 50 Ice Mix items get a link here. The other 6 are
-- deliberately left out -- see the Phase 1 report's match table and "no
-- clear match" list for why each one was excluded, instead of guessed:
-- Banana / Banana Split, Cheesecake, Purple Candy, Skittles, Mermaid,
-- Dr Pepper.
--
-- NOT RUN.

-- Direct exact-name matches (33), including "Cherry" -> the italian_ice
-- Cherry specifically (the plain item has no "Sugar Free" in its name;
-- the sugar_free Cherry flavor is reserved for the separate "Sugar Free
-- Cherry" item below).
update items set flavor_id = (select id from flavors where name = 'Birthday Cake' and type = 'cream_ice')
  where name = 'Birthday Cake' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Blue Raspberry' and type = 'italian_ice')
  where name = 'Blue Raspberry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Cherry' and type = 'italian_ice')
  where name = 'Cherry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Clementine' and type = 'italian_ice')
  where name = 'Clementine' and category = 'Ice Mix' and flavor_id is null;

-- Cola matches an INACTIVE, Hibernate-tagged flavor -- flagged in the
-- Phase 1 report for your awareness, included anyway since the name match
-- itself is exact and unambiguous (veto by clearing the link in Manage
-- Items if you'd rather it stay unlinked).
update items set flavor_id = (select id from flavors where name = 'Cola' and type = 'italian_ice')
  where name = 'Cola' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Coconut Cream' and type = 'cream_ice')
  where name = 'Coconut Cream' and category = 'Ice Mix' and flavor_id is null;

-- Cookies N Cream / Cookies 'n Cream -- apostrophe-only difference.
update items set flavor_id = (select id from flavors where name = 'Cookies ''n Cream' and type = 'cream_ice')
  where name = 'Cookies N Cream' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Cotton Candy' and type = 'italian_ice')
  where name = 'Cotton Candy' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Georgia Peach' and type = 'italian_ice')
  where name = 'Georgia Peach' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Green Apple' and type = 'italian_ice')
  where name = 'Green Apple' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Gummy Bear' and type = 'italian_ice')
  where name = 'Gummy Bear' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Island Fusion' and type = 'italian_ice')
  where name = 'Island Fusion' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Key Lime' and type = 'italian_ice')
  where name = 'Key Lime' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Lemon' and type = 'italian_ice')
  where name = 'Lemon' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Mango' and type = 'italian_ice')
  where name = 'Mango' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Passionfruit Paloma' and type = 'italian_ice')
  where name = 'Passionfruit Paloma' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Pina Colada' and type = 'italian_ice')
  where name = 'Pina Colada' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Pineapple' and type = 'italian_ice')
  where name = 'Pineapple' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Raspberry' and type = 'italian_ice')
  where name = 'Raspberry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Root Beer' and type = 'italian_ice')
  where name = 'Root Beer' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'S''mores' and type = 'cream_ice')
  where name = 'S''mores' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Swedish Fish' and type = 'italian_ice')
  where name = 'Swedish Fish' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Strawberry' and type = 'italian_ice')
  where name = 'Strawberry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Vanilla' and type = 'italian_ice')
  where name = 'Vanilla' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Watermelon' and type = 'italian_ice')
  where name = 'Watermelon' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Chocolate' and type = 'italian_ice')
  where name = 'Chocolate' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Blackberry' and type = 'italian_ice')
  where name = 'Blackberry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Kiwi Melon' and type = 'italian_ice')
  where name = 'Kiwi Melon' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Juicy Pear' and type = 'italian_ice')
  where name = 'Juicy Pear' and category = 'Ice Mix' and flavor_id is null;

-- No program tag today (shows no badge until/unless you tag it), but the
-- name match itself is exact and unambiguous.
update items set flavor_id = (select id from flavors where name = 'Sour Blue Pucker' and type = 'italian_ice')
  where name = 'Sour Blue Pucker' and category = 'Ice Mix' and flavor_id is null;

-- INACTIVE, untagged flavor -- shows no badge today either way, included
-- for the same "exact match" reasoning as Cola above.
update items set flavor_id = (select id from flavors where name = 'Blue Hawaii' and type = 'italian_ice')
  where name = 'Blue Hawaii' and category = 'Ice Mix' and flavor_id is null;

-- No program tag today, exact match.
update items set flavor_id = (select id from flavors where name = 'Shirley Temple' and type = 'italian_ice')
  where name = 'Shirley Temple' and category = 'Ice Mix' and flavor_id is null;

-- Known tricky pairs Josh named explicitly (7) -- each a real naming
-- variance between the inventory item and the catalog flavor, not a
-- generic fuzzy guess.
update items set flavor_id = (select id from flavors where name = 'KOOL-AID Sharkleberry Fin' and type = 'italian_ice')
  where name = 'Koolaid Sharkleberry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'KOOL-AID Tropical Punch' and type = 'italian_ice')
  where name = 'Koolaid Tropical Punch' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Mint Chocolate Chip' and type = 'cream_ice')
  where name = 'Mint Chip' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'SOUR PATCH KIDS Watermelon' and type = 'italian_ice')
  where name = 'Sour Patch Watermelon' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'SOUR PATCH KIDS Red' and type = 'italian_ice')
  where name = 'Sour Patch Kids Red' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'PEEPS Party Cake Ice' and type = 'italian_ice')
  where name = 'Peeps' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Pumpkin Pie' and type = 'cream_ice')
  where name = 'Pumpkin' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Wild Black Cherry' and type = 'italian_ice')
  where name = 'Wild Cherry' and category = 'Ice Mix' and flavor_id is null;

-- Sugar Free items: matched against the sugar_free-type flavor of the
-- same name (per your instruction), with the "Sugar Free " prefix
-- stripped before comparing. "Sugar Free Dragon Fruit" vs the catalog's
-- one-word "Dragonfruit", and "Sugar Free Pink Lemonade" vs the catalog's
-- full name "Ritas Retro Sugar-Free Pink Lemonade" (the only sugar_free
-- flavor containing "Pink Lemonade" -- unique, unambiguous) are naming
-- variances, same spirit as the pairs above.
update items set flavor_id = (select id from flavors where name = 'Dragonfruit' and type = 'sugar_free')
  where name = 'Sugar Free Dragon Fruit' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Mango Peach' and type = 'sugar_free')
  where name = 'Sugar Free Mango Peach' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Cherry' and type = 'sugar_free')
  where name = 'Sugar Free Cherry' and category = 'Ice Mix' and flavor_id is null;

update items set flavor_id = (select id from flavors where name = 'Ritas Retro Sugar-Free Pink Lemonade' and type = 'sugar_free')
  where name = 'Sugar Free Pink Lemonade' and category = 'Ice Mix' and flavor_id is null;

-- Deliberately NOT included (no UPDATE statement) -- see the Phase 1
-- report for each one's reasoning:
--   Banana / Banana Split -- ambiguous between italian_ice "Banana" and
--     cream_ice "Banana Split Cream" (distributor text says CREAM MIX,
--     but that's not decisive enough to not guess).
--   Cheesecake -- flavors named "Cheesecake" only exist as hs_custard/
--     soft_serve, the wrong section entirely for an Ice Mix item; no real
--     candidate.
--   Purple Candy, Skittles, Mermaid -- no candidate flavor found under
--     any type (Mermaid Ice exists but isn't an exact name match -- a
--     guess, not a clear one).
--   Dr Pepper -- tracked in boxes (every other Ice Mix item is gallons),
--     and Josh flagged doubt it's a real flavor mix rather than something
--     else entirely. A flavor named "Dr. Pepper" does exist (italian_ice,
--     low_inventory) but is left unlinked pending your call.
