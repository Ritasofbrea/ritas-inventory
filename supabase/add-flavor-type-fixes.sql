-- Corrects two issues discovered after add-flavor-type.sql and the
-- original seed-flavors-from-csv.sql were already run (patch 26):
--
-- 1. flavors.name had a plain unique constraint (patch 20), but the CSV
--    export has the same name under more than one type ("Cherry" exists
--    as both an italian_ice and a sugar_free flavor — two distinct real
--    items). That silently dropped the sugar-free Cherry via the seed's
--    original `on conflict (name) do nothing`. Swap the constraint to
--    (name, type) so both can coexist, then insert the missing Cherry.
--
-- 2. flavor_week_slots never snapshotted a flavor's type the way it
--    already snapshots flavor_name (patch 20's rationale: a slot's
--    display must survive its catalog entry being deleted later). Add
--    flavor_type and backfill the current week's already-picked slots
--    from the catalog.
--
-- Run in the Supabase SQL Editor.

alter table flavors drop constraint flavors_name_key;
alter table flavors add constraint flavors_name_type_key unique (name, type);

insert into flavors (name, type, active)
values ('Cherry', 'sugar_free', true)
on conflict (name, type) do nothing;

alter table flavor_week_slots add column flavor_type text
  check (flavor_type in ('italian_ice', 'cream_ice', 'sugar_free'));

update flavor_week_slots s
set flavor_type = f.type
from flavors f
where s.flavor_id = f.id and s.flavor_type is null;
