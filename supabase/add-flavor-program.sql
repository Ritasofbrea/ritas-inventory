-- Patch 40: optional "program" tag per flavor, reflecting corporate's Ice
-- Flavors ordering-status chart (updated 2026-01-20): everyday, seasonal,
-- low_inventory, opt_in, hibernate, lto. Nullable -- an untagged flavor
-- shows no badge and behaves exactly as it does today, no UI change.
--
-- Idempotent: safe to re-run. `add column if not exists` is a no-op if this
-- already ran; the constraint is dropped and re-added by name so re-running
-- after this same file changes can't collide with a stale version of it.
-- Does not touch flavor_week_slots -- a planned week's display is a
-- snapshot (flavor_name/flavor_type) taken at pick time, not a live join to
-- flavors, so a hibernate flavor already in a slot keeps showing normally
-- with no snapshot of program needed (patch 40's own requirement).

alter table flavors add column if not exists program text;

alter table flavors drop constraint if exists flavors_program_check;
alter table flavors add constraint flavors_program_check
  check (program is null or program in ('everyday', 'seasonal', 'low_inventory', 'opt_in', 'hibernate', 'lto'));
