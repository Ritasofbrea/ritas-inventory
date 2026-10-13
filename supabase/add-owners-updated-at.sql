-- The `owners` table (add-named-owner-pins.sql) has no updated_at column,
-- but the Change PIN screen shows "Last changed <date>" for every option
-- (Josh, Gina, Shift Lead) — add it so Josh/Gina aren't missing that while
-- Shift Lead (the `pins` table) has it. Run after add-named-owner-pins.sql.

alter table owners add column updated_at timestamptz not null default now();
