-- Dedicated ZZTEST accounts for tests/e2e/role-checks.mjs and
-- step-checks.mjs, so those scripts never need a real owner's/shift
-- lead's PIN. Run once in the Supabase SQL Editor; safe to re-run (every
-- insert is `on conflict (name) do nothing`, so re-running this after
-- you've replaced the placeholder PINs below does NOT overwrite them).
--
-- Columns checked directly against the live schema before writing this
-- (via the PostgREST OpenAPI root) rather than assumed:
--   owners:      name text primary key, pin text not null, active boolean
--                default true, created_at/updated_at timestamptz default now()
--   shift_leads: id uuid primary key default gen_random_uuid(), name text
--                unique not null, pin text not null, active boolean
--                default true, created_at/updated_at timestamptz default now()
--
-- Both rows are created with active = false on purpose -- a ZZTEST account
-- sitting active in production would otherwise show up anywhere a real
-- owner/shift-lead name does (Added by lists, "Last changed" displays,
-- etc). Flip active to true only while you're actually running
-- role-checks.mjs / step-checks.mjs, then back to false when done:
--
--   update owners set active = true where name = 'ZZTEST Owner';
--   update shift_leads set active = true where name = 'ZZTEST Shift Lead';
--   -- ... run the e2e scripts ...
--   update owners set active = false where name = 'ZZTEST Owner';
--   update shift_leads set active = false where name = 'ZZTEST Shift Lead';
--
-- 'REPLACE_ME_OWNER_PIN' / 'REPLACE_ME_SHIFT_LEAD_PIN' are placeholders --
-- not digits, so they can never accidentally match a real PIN. Replace
-- them with your own made-up test PINs (anything, as long as they don't
-- match a real owner's/shift lead's PIN) before the first run:
--
--   update owners set pin = '<your test PIN>' where name = 'ZZTEST Owner';
--   update shift_leads set pin = '<your test PIN>' where name = 'ZZTEST Shift Lead';

insert into owners (name, pin, active)
values ('ZZTEST Owner', 'REPLACE_ME_OWNER_PIN', false)
on conflict (name) do nothing;

insert into shift_leads (name, pin, active)
values ('ZZTEST Shift Lead', 'REPLACE_ME_SHIFT_LEAD_PIN', false)
on conflict (name) do nothing;
