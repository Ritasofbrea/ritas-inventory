# E2E regression scripts

Hand-written Node scripts (not a test runner/framework) that regress three
specific behaviors that have broken before. They are **not** a full
coverage suite — see `route-access.md` at the repo root for the complete
role-access table these partially regress.

They run only against `localhost` (`npm run dev`), never against a Vercel
preview or production URL — previews are SSO-protected, and these scripts
create and delete real rows in whatever Supabase project `.env.local`
points at.

## What each one covers
- **`role-checks.mjs`** — patch 29: server-enforced role checks
  (`requireRole` in `src/lib/session.ts`). Hits one real route per tier from
  `route-access.md` (PUBLIC/ANY/SL+/OWNER) and checks the 401-vs-403
  distinction: 401 = no/invalid session, 403 = valid session, wrong role.
- **`step-checks.mjs`** — patch 28: a `'checklist'`-style task can't be
  completed until every step is checked (`canCompleteInstance` in
  `src/lib/task-server.ts`), and `check-step`/`uncheck-step` toggle
  correctly.
- **`logout-race.mjs`** — the Home/Switch logout race: a deliberate exit
  must still reach `/login`'s three-button screen even if `POST
  /api/logout` fails or hangs (bounded by a 3s client-side timeout in
  `Navigation.tsx`). This is the only suite that drives a real browser
  (Playwright) — the other two talk to the API directly over `fetch`.

## Setup (one time)
```
npm install
npx playwright install chromium   # only needed for logout-race.mjs
```

**These scripts never use a PIN.** `role-checks.mjs` and `step-checks.mjs`
log in as two dedicated test accounts — `ZZTEST Owner` and `ZZTEST Shift
Lead` — created by `supabase/e2e-test-accounts.sql` and kept permanently
active by `supabase/zztest-accounts-permanent.sql` (run once each in the
Supabase SQL Editor; both idempotent, safe to re-run). `helpers/auth.mjs`
mints a real, production-signed session cookie for each directly — the
exact same `createSessionToken` function the app itself uses to sign every
cookie (`src/lib/session-token.ts`, no Next.js import, so it's importable
from a plain Node script) — instead of calling `/api/pins/verify` with a
test PIN. The two account names are hardcoded literals in that file, not
parameters, so there's no way to point it at anything but those two ZZTEST
accounts.

This needs `SESSION_SECRET` from `.env.local` (already there for the app
itself) — read from `process.env` at run time, never printed. Set
`E2E_BASE_URL` too if you're not using the default `http://localhost:3000`.

Both ZZTEST accounts are **permanently `active = true`** (see
`supabase/zztest-accounts-permanent.sql` for why this is safe: `ZZTEST
Owner` is invisible everywhere the real app queries owners, since those
lists are hardcoded by name; `ZZTEST Shift Lead` is explicitly filtered out
of the two real call sites that list active shift leads — the Change PIN
screen and the Notes acknowledgment-count math — so it's also invisible).
Their `pin` column is set to a long non-digit value, which `/api/pins/
verify` rejects before it would even reach the database (real PINs are
always 4-6 digits) — so neither account can ever be logged into through
the normal PIN screen, only through this test helper.

Nothing needs toggling before or after a run anymore. Just start the dev
server in another terminal (`npm run dev`) and run:
```
npm run test:e2e                 # all three, in sequence
npm run test:e2e:role-checks
npm run test:e2e:step-checks
npm run test:e2e:logout-race     # doesn't need either ZZTEST account
npm run test:e2e:cleanup         # sweep any leftover ZZTEST fixtures
```
Each script prints `ok - <check>` / `FAIL - <check>` per assertion and
exits non-zero on any failure.

## Fixtures and cleanup
Anything these scripts create in the database is named with a `ZZTEST`
prefix (see `helpers/zztest.mjs`), the same convention used throughout this
project's manual testing. `role-checks.mjs` and `step-checks.mjs` clean up
their own fixtures as part of a normal run; if a run crashes partway
through, `npm run test:e2e:cleanup` sweeps anything `ZZTEST`-named left
behind. `logout-race.mjs` creates no database rows (it only establishes a
staff session).
