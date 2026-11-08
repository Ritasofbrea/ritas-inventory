-- Follow-up to e2e-test-accounts.sql: makes ZZTEST Owner/ZZTEST Shift Lead
-- permanently active so tests/e2e never needs them toggled on/off again
-- (helpers/auth.mjs now mints their session cookies directly via
-- src/lib/session-token.ts, instead of logging in through
-- /api/pins/verify with a test PIN).
--
-- Why this is safe to leave active forever:
--   - ZZTEST Owner is invisible everywhere the app queries owners -- every
--     such list (the Change PIN screen, task "Added by") is a hardcoded
--     name list (['Josh','Gina'] / ['Josh','Gina','Valerie']), never
--     DB-driven by `active`.
--   - ZZTEST Shift Lead is excluded by name at the three real call sites
--     that list active shift leads for production behavior (the Change
--     PIN screen, and the two places that compute a note's required
--     acknowledgment count) -- see CLAUDE.md §8.
--
-- The `pin` value below is random and non-digit on purpose: real PINs are
-- always 4-6 digits (enforced at change-PIN time), and /api/pins/verify
-- now rejects any non-digit submission before even touching the database
-- (see src/app/api/pins/verify/route.ts). That makes PIN login for these
-- two accounts impossible regardless of what the stored value is -- this
-- is belt-and-suspenders, not the only thing standing between them and a
-- real login.
update owners
set active = true,
    pin = 'ZZTEST-DISABLED-LOGIN-' || substr(md5(random()::text), 1, 12)
where name = 'ZZTEST Owner';

update shift_leads
set active = true,
    pin = 'ZZTEST-DISABLED-LOGIN-' || substr(md5(random()::text), 1, 12)
where name = 'ZZTEST Shift Lead';

-- Safe to re-run any time (e.g. to rotate the pin value again) -- both
-- statements are plain targeted updates, not inserts.
