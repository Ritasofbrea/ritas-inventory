-- Patch 40: tag the real ICE flavors with corporate's program (chart updated 2026-01-20).
-- Run add-flavor-program.sql FIRST. Then run this WHOLE file in the Supabase SQL Editor.
-- Safe to run twice (every statement sets the same value). Matches by name AND type.
-- This is the exact version Josh ran, resolving every ambiguity/fuzzy match from
-- the Phase 1 report (Chocolate for Chocolate Base/Mix, both Watermelon rows,
-- Ritas Retro Sugar-Free Pink Lemonade, Pumpkin Pie, PEEPS Party Cake Ice).
-- Cantaloupe, Cheesecake, Skittles, and Nerds Grape are not in the catalog at
-- all and stay untagged.

-- everyday
update public.flavors set program = 'everyday' where name = 'Blue Raspberry' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Cherry' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Chocolate' and type = 'italian_ice'; -- chart: Chocolate Base + Chocolate Mix
update public.flavors set program = 'everyday' where name = 'Cotton Candy' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Green Apple' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Lemon' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Mango' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Root Beer' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Vanilla' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Dragonfruit' and type = 'sugar_free'; -- chart: S.F. Dragonfruit
update public.flavors set program = 'everyday' where name = 'Mango Peach' and type = 'sugar_free'; -- chart: S.F. Mango Peach
update public.flavors set program = 'everyday' where name = 'Strawberry' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Swedish Fish' and type = 'italian_ice';
update public.flavors set program = 'everyday' where name = 'Wild Black Cherry' and type = 'italian_ice';

-- seasonal
update public.flavors set program = 'seasonal' where name = 'Clementine' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Coconut Cream' and type = 'cream_ice';
update public.flavors set program = 'seasonal' where name = 'Cookies ''n Cream' and type = 'cream_ice'; -- chart: Cookies n' Cream
update public.flavors set program = 'seasonal' where name = 'Georgia Peach' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Gummy Bear' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Island Fusion' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Kiwi Melon' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'KOOL-AID Sharkleberry Fin' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'KOOL-AID Tropical Punch' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Mint Chocolate Chip' and type = 'cream_ice'; -- chart: Mint Choc. Chip
update public.flavors set program = 'seasonal' where name = 'Passionfruit Paloma' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Pina Colada' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Pineapple' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Cherry' and type = 'sugar_free'; -- chart: S.F. Cherry
update public.flavors set program = 'seasonal' where name = 'Tangerine' and type = 'sugar_free'; -- chart: S.F. Tangerine
update public.flavors set program = 'seasonal' where name = 'S''mores' and type = 'cream_ice';
update public.flavors set program = 'seasonal' where name = 'SOUR PATCH KIDS Watermelon' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Watermelon' and type = 'italian_ice';
update public.flavors set program = 'seasonal' where name = 'Ritas Retro Sugar-Free Pink Lemonade' and type = 'sugar_free'; -- chart: S.F. Pink Lemonade

-- low_inventory
update public.flavors set program = 'low_inventory' where name = 'Banana' and type = 'italian_ice';
update public.flavors set program = 'low_inventory' where name = 'Birthday Cake' and type = 'cream_ice';
update public.flavors set program = 'low_inventory' where name = 'Dr. Pepper' and type = 'italian_ice'; -- chart: Dr Pepper
update public.flavors set program = 'low_inventory' where name = 'Juicy Pear' and type = 'italian_ice';
update public.flavors set program = 'low_inventory' where name = 'Key Lime' and type = 'italian_ice';
update public.flavors set program = 'low_inventory' where name = 'Raspberry' and type = 'italian_ice';
update public.flavors set program = 'low_inventory' where name = 'SOUR PATCH KIDS Red' and type = 'italian_ice'; -- chart: SOUR PATCH KIDS - Red

-- opt_in (spring/fall notes are on the chart only, not stored)
update public.flavors set program = 'opt_in' where name = 'Unicorn' and type = 'italian_ice';
update public.flavors set program = 'opt_in' where name = 'Pumpkin Pie' and type = 'cream_ice'; -- chart: Pumpkin

-- hibernate (Cola is inactive in the catalog; program is independent of active)
update public.flavors set program = 'hibernate' where name = 'Cola' and type = 'italian_ice';

-- lto
update public.flavors set program = 'lto' where name = 'PEEPS Party Cake Ice' and type = 'italian_ice'; -- chart: Mystery Peeps

-- Check: expect everyday 14, seasonal 19, low_inventory 7, opt_in 2, hibernate 1, lto 1 (44 total).
select program, count(*) as flavors
from public.flavors
where program is not null
group by program
order by program;
