-- Seed data for task_templates, built from Rita's corporate Opening Checklist,
-- Closing Checklist, and Time to Lean / Time to Clean checklist.
--
-- Run AFTER add-task-checklist-grouping.sql, and after the checklist-grouping
-- patch (which teaches the app to render checklist_name/section) is deployed.
--
-- created_by uses 'Joshua Castro' to match the staff table seeded in
-- add-tasks.sql. Change it if you want a different name attributed to these.
--
-- FIXED vs. the original draft: sort_order now counts continuously across each
-- whole checklist instead of resetting to 1 at every section boundary. There is
-- no separate section-order column, so with resetting numbers there was nothing
-- deterministic telling the app which section comes before which (DB row-return
-- order is not guaranteed to match insertion order). Section labels, items, and
-- item order within each section are unchanged — only the numbers differ.

-- =========================================================
-- OPENING CHECKLIST (daily, recurrence = 'daily')
-- =========================================================

insert into task_templates (title, recurrence, checklist_name, section, sort_order, created_by) values
('Disarm alarm, unlock doors, and turn on lights', 'daily', 'Opening Checklist', 'Shop Readiness', 1, 'Joshua Castro'),
('Complete a full store walk-through (front to back) for cleanliness, safety hazards, and equipment concerns', 'daily', 'Opening Checklist', 'Shop Readiness', 2, 'Joshua Castro'),
('Check that fridges, freezers, and dip boxes are holding proper temperatures', 'daily', 'Opening Checklist', 'Shop Readiness', 3, 'Joshua Castro'),
('Ensure hot water is working', 'daily', 'Opening Checklist', 'Shop Readiness', 4, 'Joshua Castro'),
('Open safe and count drawer tills; verify starting banks. Complete safe log if required', 'daily', 'Opening Checklist', 'Shop Readiness', 5, 'Joshua Castro'),
('Confirm internet connection, and ensure Clover receipt printers have paper', 'daily', 'Opening Checklist', 'Shop Readiness', 6, 'Joshua Castro'),
('Check Online Ordering / Delivery tablets are active; update flavors', 'daily', 'Opening Checklist', 'Shop Readiness', 7, 'Joshua Castro'),
('Assign positions, review the day''s focus, and ensure the team is guest-ready before unlocking doors and opening windows', 'daily', 'Opening Checklist', 'Shop Readiness', 8, 'Joshua Castro'),

('Set up triple bowl sink: fill wash and sanitize compartments', 'daily', 'Opening Checklist', 'Sanitation Setup', 9, 'Joshua Castro'),
('Make fresh sanitizer; fill spray bottles and red sanitizer buckets', 'daily', 'Opening Checklist', 'Sanitation Setup', 10, 'Joshua Castro'),
('Fill mop bucket', 'daily', 'Opening Checklist', 'Sanitation Setup', 11, 'Joshua Castro'),
('Confirm hand sinks are stocked with soap and paper towels', 'daily', 'Opening Checklist', 'Sanitation Setup', 12, 'Joshua Castro'),
('Fill two pump buckets (22 qt) with cold water an inch above the rim', 'daily', 'Opening Checklist', 'Sanitation Setup', 13, 'Joshua Castro'),

('Turn custard machine into Day Mode and fill machine', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 14, 'Joshua Castro'),
('Attach star nozzles and place draw-off container on drip tray', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 15, 'Joshua Castro'),
('Fill pitchers with custard mix (vanilla & chocolate) and water; label pitchers with 7-day shelf life', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 16, 'Joshua Castro'),
('Bring ice scoopers, topping scoops/ladles, black tongs, pumps, poke, two pump buckets, draw-off containers, and Mix N Chill rinse cup to the storefront', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 17, 'Joshua Castro'),
('Pump & poke ice; place in proper dip boxes and check day dots', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 18, 'Joshua Castro'),
('Scrape & smooth ice; place a clean scoop in ice by the handle', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 19, 'Joshua Castro'),
('Restock spoons, straws, napkins, cups, lids, carriers, bags, cones, and custard machine supplies', 'daily', 'Opening Checklist', 'Custard & Product Preparation', 20, 'Joshua Castro'),

('Turn on TVs, menu boards, music, dip box lights, and open sign', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 21, 'Joshua Castro'),
('Set up ice flavor tags in dip box, flavor board, and walk-up menu', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 22, 'Joshua Castro'),
('Review any promos or LTO messaging with the team', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 23, 'Joshua Castro'),
('Empty and reline outdoor trash cans; ensure logos face forward', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 24, 'Joshua Castro'),
('Sweep parking lot and window queuing area', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 25, 'Joshua Castro'),
('Water flowers/plants outdoors', 'daily', 'Opening Checklist', 'Operational & Outdoor Readiness', 26, 'Joshua Castro'),

('Turn on pretzel oven and warmer; bake a small batch to start the day', 'daily', 'Opening Checklist', 'Approval-Based Products', 27, 'Joshua Castro'),
('Turn on waffle iron; prepare batter if needed and store in refrigerator; make fresh waffle cones and bowls', 'daily', 'Opening Checklist', 'Approval-Based Products', 28, 'Joshua Castro');


insert into task_templates (title, recurrence, checklist_name, section, sort_order, created_by) values
('Assign pre-closing positions so cleaning does not interfere with guests', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 1, 'Joshua Castro'),
('Restock frontline: spoons, straws, napkins, cups, lids, carriers, bags, cones, bottled water', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 2, 'Joshua Castro'),
('Confirm bathrooms are clean and stocked; empty trash, sweep, mop as needed', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 3, 'Joshua Castro'),
('Set up fresh triple bowl sink (wash + sanitize)', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 4, 'Joshua Castro'),
('Empty and refill mop bucket', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 5, 'Joshua Castro'),
('Begin wiping counters, walls, windows, tables, chairs, and shelves', 'daily', 'Closing Checklist', 'Preclosing (30 Min Prior)', 6, 'Joshua Castro'),

('Look for any approaching guests, including vehicles entering the parking lot, before locking windows/doors', 'daily', 'Closing Checklist', 'Final Guest Check', 7, 'Joshua Castro'),
('Bring in counter mats, napkin dispensers, mustard containers, etc.', 'daily', 'Closing Checklist', 'Final Guest Check', 8, 'Joshua Castro'),
('Bring in outdoor furniture, trash cans, umbrellas, and signage', 'daily', 'Closing Checklist', 'Final Guest Check', 9, 'Joshua Castro'),
('Lock doors/windows, close blinds, and turn off the open sign', 'daily', 'Closing Checklist', 'Final Guest Check', 10, 'Joshua Castro'),
('Verify all online orders are completed, then power off tablets', 'daily', 'Closing Checklist', 'Final Guest Check', 11, 'Joshua Castro'),

('Confirm pumped ice is still within freshness policy; discard ice made yesterday', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 12, 'Joshua Castro'),
('Scrape & smooth ice', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 13, 'Joshua Castro'),
('Remove scoops and place lids on containers', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 14, 'Joshua Castro'),
('Scrape dip box sides with green scraper; clean dummy buckets/dividers', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 15, 'Joshua Castro'),
('Place ice into appropriate dip boxes for overnight storage', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 16, 'Joshua Castro'),
('Turn custard machine to Night Mode and complete nightly wipe-down using sanitizer and one-use paper towels', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 17, 'Joshua Castro'),
('Power off Mix ''N Chill; fully disassemble (spindle, stainless interior, plastic protector)', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 18, 'Joshua Castro'),
('Remove scoops, ladles, and lids from toppings; wipe down dispensers', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 19, 'Joshua Castro'),
('Transfer sprinkles to clean pans', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 20, 'Joshua Castro'),
('Wipe Cambro pitchers and discard expired product', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 21, 'Joshua Castro'),
('Wash & sanitize ice scoops, pumps, pump buckets, ladles, star nozzles, draw-off containers, drip trays, Mix N Chill parts, dip box dividers, and remaining dishes; empty triple sink after, hang towels and mop to air dry', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 22, 'Joshua Castro'),
('Prepare novelty items for overnight freezing', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 23, 'Joshua Castro'),
('Complete DST Production Sheet (CIM): accurately record the amount of Italian Ice remaining in the shop', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 24, 'Joshua Castro'),
('Turn off menu boards, TVs, and music', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 25, 'Joshua Castro'),
('Close and lock safe and count drawer tills; verify ending banks and complete safe log if required', 'daily', 'Closing Checklist', 'Product Handling & Equipment', 26, 'Joshua Castro'),

('Turn off pretzel oven and warmer; discard expired pretzels', 'daily', 'Closing Checklist', 'Approval-Based Products', 27, 'Joshua Castro'),
('Turn off waffle iron; brush clean; dispose of any batter past 36 hours', 'daily', 'Closing Checklist', 'Approval-Based Products', 28, 'Joshua Castro');


insert into task_templates (title, recurrence, weekday, checklist_name, section, sort_order, created_by) values
('Scrub and sanitize triple sink, including sprayer nozzle', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 1, 'Joshua Castro'),
('Clean drain pipes underneath triple bowl and handwashing sink', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 2, 'Joshua Castro'),
('Disinfect floor drains near batch machines', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 3, 'Joshua Castro'),
('Scrub mop sink and surrounding walls', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 4, 'Joshua Castro'),
('Sanitize hand sinks (basins and handles)', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 5, 'Joshua Castro'),
('Refill soap and towel dispensers', 'weekly', 0, 'Time to Lean, Time to Clean', 'Sinks, Drains & Water Sources', 6, 'Joshua Castro'),

('Clean all shelving above and below prep areas', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 7, 'Joshua Castro'),
('Stack extra inventory using FIFO', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 8, 'Joshua Castro'),
('Alphabetize flavor slats / dip tags', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 9, 'Joshua Castro'),
('Wipe sticky mix bottles with sanitizer', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 10, 'Joshua Castro'),
('Sweep & mop under all shelving', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 11, 'Joshua Castro'),
('Pre-label custard pint containers and lids', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 12, 'Joshua Castro'),
('Sanitize squeeze bottles; prep portion cups', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 13, 'Joshua Castro'),
('Rinse indoor/outdoor trash cans; clean lids', 'weekly', 1, 'Time to Lean, Time to Clean', 'General Housekeeping & Organization', 14, 'Joshua Castro'),
('Clean refrigeration/freezer interiors with soap and water; handle gaskets carefully', 'weekly', 1, 'Time to Lean, Time to Clean', 'Refrigeration & Freezers', 15, 'Joshua Castro'),
('Clean refrigeration/freezer exterior doors and handles', 'weekly', 1, 'Time to Lean, Time to Clean', 'Refrigeration & Freezers', 16, 'Joshua Castro'),
('Remove dust from refrigeration/freezer vents and fan guards', 'weekly', 1, 'Time to Lean, Time to Clean', 'Refrigeration & Freezers', 17, 'Joshua Castro'),
('Verify refrigeration/freezer thermometers are present and readable', 'weekly', 1, 'Time to Lean, Time to Clean', 'Refrigeration & Freezers', 18, 'Joshua Castro'),
('Check FIFO and discard expired product', 'weekly', 1, 'Time to Lean, Time to Clean', 'Refrigeration & Freezers', 19, 'Joshua Castro'),

('Remove items one shelf at a time; clean, sanitize, dry, replace', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 20, 'Joshua Castro'),
('Clean shelves above dip boxes (top and bottom)', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 21, 'Joshua Castro'),
('Sanitize all countertops; remove ice stains', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 22, 'Joshua Castro'),
('Clean cup lid dividers, spindles, and acrylic displays', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 23, 'Joshua Castro'),
('Wash tip cups', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 24, 'Joshua Castro'),
('Sanitize registers, terminals, scanners, pens, and cable areas', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 25, 'Joshua Castro'),
('Wipe napkin dispensers; restock', 'weekly', 2, 'Time to Lean, Time to Clean', 'Countertops, Shelving & Service Areas', 26, 'Joshua Castro'),
('Pull out dip box units; sweep and mop underneath and behind', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 27, 'Joshua Castro'),
('Clean all sides of dip boxes; remove stains and debris (no bleach)', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 28, 'Joshua Castro'),
('Clean walls behind dip box units (upper and lower)', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 29, 'Joshua Castro'),
('Remove dust from dip box vents', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 30, 'Joshua Castro'),
('Gently clean dip box door gaskets', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 31, 'Joshua Castro'),
('Defrost dip boxes', 'weekly', 2, 'Time to Lean, Time to Clean', 'Dip Boxes', 32, 'Joshua Castro'),

('Pull out custard machines; sweep and mop underneath', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 33, 'Joshua Castro'),
('Wipe walls behind custard machine equipment', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 34, 'Joshua Castro'),
('Remove dust from custard machine vents', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 35, 'Joshua Castro'),
('Gently clean custard machine door gaskets', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 36, 'Joshua Castro'),
('Sanitize front, sides, and top of custard machines; dry immediately to prevent streaking', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 37, 'Joshua Castro'),
('Wipe custard machine caster wheels', 'weekly', 3, 'Time to Lean, Time to Clean', 'Custard Machines', 38, 'Joshua Castro'),
('Clean baseboards and lower walls (no scuffs or footprints)', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 39, 'Joshua Castro'),
('Fully clean bathrooms: mirrors, floors, trash, doors', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 40, 'Joshua Castro'),
('Sanitize guest seating (tables, chairs, benches)', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 41, 'Joshua Castro'),
('Clean windows and entry doors inside/outside', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 42, 'Joshua Castro'),
('Wipe handles and push plates', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 43, 'Joshua Castro'),
('Clean exterior entry mats', 'weekly', 3, 'Time to Lean, Time to Clean', 'Lobby & Guest Areas', 44, 'Joshua Castro'),

('Update all checklists, charts, and TTM boards', 'weekly', 4, 'Time to Lean, Time to Clean', 'Manager Ownership', 45, 'Joshua Castro'),
('Verify hot water meets required temperature', 'weekly', 4, 'Time to Lean, Time to Clean', 'Manager Ownership', 46, 'Joshua Castro'),
('Organize office supplies', 'weekly', 4, 'Time to Lean, Time to Clean', 'Manager Ownership', 47, 'Joshua Castro'),

('Remove dust, cobwebs, and splatter from ceilings', 'weekly', 5, 'Time to Lean, Time to Clean', 'Above the Sightline', 48, 'Joshua Castro'),
('Clean HVAC vents and returns', 'weekly', 5, 'Time to Lean, Time to Clean', 'Above the Sightline', 49, 'Joshua Castro'),
('Wipe light fixtures and protective shields', 'weekly', 5, 'Time to Lean, Time to Clean', 'Above the Sightline', 50, 'Joshua Castro'),
('Inspect ceiling tiles for stains or damage; report to manager', 'weekly', 5, 'Time to Lean, Time to Clean', 'Above the Sightline', 51, 'Joshua Castro'),

('Clean ice machine exterior and bin lid (if applicable)', 'weekly', 6, 'Time to Lean, Time to Clean', 'Equipment & Food Safety Details', 52, 'Joshua Castro'),
('Wipe mix bottles and pump handles', 'weekly', 6, 'Time to Lean, Time to Clean', 'Equipment & Food Safety Details', 53, 'Joshua Castro'),
('Ensure NSF containers and ice buckets are residue-free', 'weekly', 6, 'Time to Lean, Time to Clean', 'Equipment & Food Safety Details', 54, 'Joshua Castro'),
('Wipe chemical bottles; confirm labels', 'weekly', 6, 'Time to Lean, Time to Clean', 'Equipment & Food Safety Details', 55, 'Joshua Castro');
