-- PATCH 66: invoice code cleanup (data only, no schema change).
-- Source: the patch 65 invoice-read experiment (17 real photos, Opus 5.5 + Sonnet 5.5)
-- plus Josh's check of the paper invoices. Generated 2026-11-11 against live items.
--
-- Changes (6 rows):
--   Glitter Sprinkles (2724)        NULL      -> M95700001   (9 chars, printed on Bunzl invoice 70252537)
--   DoorDash Stickers (1223)        NULL      -> 743043191   (9 chars, printed on Bunzl invoice 70242840)
--   Large Rita's Paper Bags (1221)  10060200  -> 10060235    (confirmed on the paper invoice)
--   Vanilla Custard Bags (2446)     NULL      -> 302446      (Balford invoice 24168404)
--   Chocolate Custard Bags (2447)   NULL      -> 302447      (Balford invoice 24168404)
--   Chocolate Chips (7050)          NULL      -> 307050      (Balford invoice 24168404)
-- Left out on purpose:
--   Hershey's Special Dark Fudge 34944: no Balford item matches. The only fudge item, "Hot Fudge",
--     has distributor 'other' and no item_number.
--   Tajin L59900031: still held, not confirmed on an invoice.
--   Pink Rags (0806) 25608507: already correct (the models misread the 8 as a B).
--
-- Every UPDATE is pinned to id AND name AND item_number AND the code it has now, and refuses to run
-- if the new code is already on a different item. A drifted row or a collision updates 0 rows
-- instead of the wrong item. item_number is NOT touched.
-- Dry run first: run everything, check the "after" results, then run COMMIT; (or ROLLBACK;).

BEGIN;

-- ---------------------------------------------------------------------------
-- BEFORE: the 6 target rows as they are now (expect 6 rows, codes as listed above)
-- ---------------------------------------------------------------------------
SELECT id, name, item_number, distributor, vendor_item_code
FROM items
WHERE id IN (
  'ad3dc226-8e8c-4637-aa44-2526be6b8285',
  'be87eee6-73fe-470f-afff-1953482b14da',
  '63bbc9e3-a156-4d3e-81ed-4949e0bef9b3',
  'fe2a511f-da71-473e-a362-438d4cf549c4',
  '740f3bca-03d0-4aba-8386-f12afbe393d6',
  'fa24efc8-ccf6-45e0-af2a-08e39d3c94e7'
)
ORDER BY name;

-- BEFORE: collision check. Expect 0 rows (no other item already holds a new code).
SELECT id, name, item_number, vendor_item_code
FROM items
WHERE vendor_item_code IN ('M95700001', '743043191', '10060235', '302446', '302447', '307050');

-- ---------------------------------------------------------------------------
-- UPDATES
-- ---------------------------------------------------------------------------
UPDATE items SET vendor_item_code = 'M95700001'
WHERE id = 'ad3dc226-8e8c-4637-aa44-2526be6b8285' AND name = 'Glitter Sprinkles' AND item_number = '2724'
  AND distributor = 'bunzl' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = 'M95700001' AND o.id <> 'ad3dc226-8e8c-4637-aa44-2526be6b8285');

UPDATE items SET vendor_item_code = '743043191'
WHERE id = 'be87eee6-73fe-470f-afff-1953482b14da' AND name = 'DoorDash Stickers' AND item_number = '1223'
  AND distributor = 'bunzl' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '743043191' AND o.id <> 'be87eee6-73fe-470f-afff-1953482b14da');

UPDATE items SET vendor_item_code = '10060235'
WHERE id = '63bbc9e3-a156-4d3e-81ed-4949e0bef9b3' AND name = 'Large Rita''s Paper Bags' AND item_number = '1221'
  AND distributor = 'bunzl' AND vendor_item_code = '10060200'
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '10060235' AND o.id <> '63bbc9e3-a156-4d3e-81ed-4949e0bef9b3');

UPDATE items SET vendor_item_code = '302446'
WHERE id = 'fe2a511f-da71-473e-a362-438d4cf549c4' AND name = 'Vanilla Custard Bags' AND item_number = '2446'
  AND distributor = 'balford' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '302446' AND o.id <> 'fe2a511f-da71-473e-a362-438d4cf549c4');

UPDATE items SET vendor_item_code = '302447'
WHERE id = '740f3bca-03d0-4aba-8386-f12afbe393d6' AND name = 'Chocolate Custard Bags' AND item_number = '2447'
  AND distributor = 'balford' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '302447' AND o.id <> '740f3bca-03d0-4aba-8386-f12afbe393d6');

UPDATE items SET vendor_item_code = '307050'
WHERE id = 'fa24efc8-ccf6-45e0-af2a-08e39d3c94e7' AND name = 'Chocolate Chips' AND item_number = '7050'
  AND distributor = 'balford' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '307050' AND o.id <> 'fa24efc8-ccf6-45e0-af2a-08e39d3c94e7');

-- ---------------------------------------------------------------------------
-- AFTER: expect 6 rows, each with its new code
-- ---------------------------------------------------------------------------
SELECT id, name, item_number, distributor, vendor_item_code
FROM items
WHERE id IN (
  'ad3dc226-8e8c-4637-aa44-2526be6b8285',
  'be87eee6-73fe-470f-afff-1953482b14da',
  '63bbc9e3-a156-4d3e-81ed-4949e0bef9b3',
  'fe2a511f-da71-473e-a362-438d4cf549c4',
  '740f3bca-03d0-4aba-8386-f12afbe393d6',
  'fa24efc8-ccf6-45e0-af2a-08e39d3c94e7'
)
ORDER BY name;

-- AFTER: each new code is on exactly one item (expect 6 rows, every count = 1)
SELECT vendor_item_code, count(*) AS items_with_code
FROM items
WHERE vendor_item_code IN ('M95700001', '743043191', '10060235', '302446', '302447', '307050')
GROUP BY vendor_item_code
ORDER BY vendor_item_code;

-- AFTER: the old bag code is gone (expect 0 rows)
SELECT id, name FROM items WHERE vendor_item_code = '10060200';

-- AFTER: total items with a code. Before this patch: 118. Expect 123 (5 new codes; the bag only changes).
SELECT count(*) AS items_with_code FROM items WHERE vendor_item_code IS NOT NULL;

-- COMMIT;   -- uncomment and run after the "after" results look right (or ROLLBACK;)

-- ===========================================================================
-- RUN AFTER (follow-up, 2026-11-11): two more Balford codes from the patch 65
-- experiment's reverse check. Both models read them on Balford invoice
-- 24110078, and each matches the "last 4 digits = item_number" pattern.
--   Cold Brew Concentrate (7260)  NULL -> 307260
--   Brownie Bites (7053)          NULL -> 307053
-- Same guards as above. Dry run, then COMMIT; (or ROLLBACK;).
-- ===========================================================================
BEGIN;

-- BEFORE: expect 2 rows, both with an empty code
SELECT id, name, item_number, distributor, vendor_item_code FROM items
WHERE id IN ('e43be1e9-b318-40e9-9068-60811ea7e176', 'a0f73560-4eac-4d06-8163-e4ed20048002');
-- BEFORE: collision check, expect 0 rows
SELECT id, name, vendor_item_code FROM items WHERE vendor_item_code IN ('307260', '307053');

UPDATE items SET vendor_item_code = '307260'
WHERE id = 'e43be1e9-b318-40e9-9068-60811ea7e176' AND name = 'Cold Brew Concentrate' AND item_number = '7260'
  AND distributor = 'balford' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '307260' AND o.id <> 'e43be1e9-b318-40e9-9068-60811ea7e176');

UPDATE items SET vendor_item_code = '307053'
WHERE id = 'a0f73560-4eac-4d06-8163-e4ed20048002' AND name = 'Brownie Bites' AND item_number = '7053'
  AND distributor = 'balford' AND vendor_item_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM items o WHERE o.vendor_item_code = '307053' AND o.id <> 'a0f73560-4eac-4d06-8163-e4ed20048002');

-- AFTER: expect 2 rows with the new codes
SELECT id, name, item_number, vendor_item_code FROM items
WHERE id IN ('e43be1e9-b318-40e9-9068-60811ea7e176', 'a0f73560-4eac-4d06-8163-e4ed20048002');
-- AFTER: total items with a code, expect 125 (was 123)
SELECT count(*) AS items_with_code FROM items WHERE vendor_item_code IS NOT NULL;

-- COMMIT;   -- uncomment and run after the "after" results look right (or ROLLBACK;)
