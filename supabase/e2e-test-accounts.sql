-- Dedicated ZZTEST accounts for tests/e2e/role-checks.mjs and
-- step-checks.mjs, so those scripts never need a real owner's/shift
-- lead's PIN. Run once in the Supabase SQL Editor; safe to re-run (the
-- inserts are `on conflict (name) do nothing`). Run
-- zztest-accounts-permanent.sql right after this one -- it sets the real
-- `active`/`pin` values these rows end up with; the placeholders below are
-- just throwaway values to satisfy the `pin not null` constraint until then.
--
-- Columns checked directly against the live schema before writing this
-- (via the PostgREST OpenAPI root) rather than assumed:
--   owners:      name text primary key, pin text not null, active boolean
--                default true, created_at/updated_at timestamptz default now()
--   shift_leads: id uuid primary key default gen_random_uuid(), name text
--                unique not null, pin text not null, active boolean
--                default true, created_at/updated_at timestamptz default now()

insert into owners (name, pin, active)
values ('ZZTEST Owner', 'REPLACE_ME_OWNER_PIN', false)
on conflict (name) do nothing;

insert into shift_leads (name, pin, active)
values ('ZZTEST Shift Lead', 'REPLACE_ME_SHIFT_LEAD_PIN', false)
on conflict (name) do nothing;
