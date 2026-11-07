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

Add these to your existing `.env.local` (gitignored, never commit it):
```
E2E_OWNER_PIN=<a real, currently-active owner's PIN>
E2E_SHIFT_LEAD_PIN=<a real, currently-active shift lead's PIN>
E2E_BASE_URL=http://localhost:3000   # optional, this is the default
```
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already in
`.env.local` for the app itself and get reused here. Nothing in `tests/e2e/`
contains a secret, PIN, or key — every credential is read from
`process.env` at run time.

Then start the dev server in another terminal: `npm run dev`.

## Running
```
npm run test:e2e                 # all three, in sequence
npm run test:e2e:role-checks
npm run test:e2e:step-checks
npm run test:e2e:logout-race
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
