# E2E regression scripts

Hand-written Node scripts (not a test runner/framework) that regress
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
  (Playwright) — the others talk to the API directly over `fetch`.
- **`row-cap-checks.mjs`** — patch 41: PostgREST silently caps any
  unlimited `.select()` at 1000 rows. Proves `/api/counts/last-per-item`
  returns exactly one row per item that has ever actually been counted
  (cross-checked independently via direct REST, batched 20 at a time) --
  the real regression this guards against is an item silently vanishing
  from Current Stock/Dashboard once `inventory_counts` grows past the cap.
  Also sanity-checks `/api/reports/velocity` and `/api/par-suggestions`
  over a multi-year range for a well-formed 200. Runs against real
  production-sized data, not a seeded dataset, since the bug only
  reproduces once a table is actually past 1000 rows.
- **`vendor-schedule-checks.mjs`** — patch 44 fix: pure-logic regression
  for `computeVendorDueInfo` (`src/lib/vendor-schedule.ts`) and
  `computeWeeksLeft` (`src/lib/weeks-left.ts`). No DB, no dev server —
  mocked-clock scenarios including explicit Sunday and Monday-morning
  checks, the Sunday/Monday-due-vendor wraparound (resolving an overdue
  Monday-due vendor on Sunday must still surface the resolution even
  though the active status rolls forward to next week's "due tomorrow"),
  and the weeks-left 8+ cap / thin-data hide rules. Runs via **`tsx`**, not
  plain `node` — `vendor-schedule.ts` imports other `src/lib` files with
  extensionless relative imports, which only bundler-style resolution
  follows.
- **`notification-linking-checks.mjs`** — patch 44 fix: proves
  `push_subscriptions.owner_name` isolation (`subsForOwner`/
  `subsForOwnersWithAlert` in `src/lib/push-server.ts`) — a device linked
  to one owner is never reachable through another owner's request or
  switch — using `ZZTEST Owner` as a safe stand-in third identity so no
  real Josh/Gina device row is ever touched. Also checks the shape of GET
  `/api/owners/alerts`' new `linked` field.
- **`vendor-week-switch-checks.mjs`** — patch 44 follow-up: switching a
  vendor's week mark between "Order Placed" and "Nothing to order" (both
  directions) and "Undo" clearing it back to pending, via `ZZTEST Vendor`
  (no real vendor_schedules row, but vendor_week_status/
  vendor_week_status_log need none). Also checks the
  `vendor_week_status_log` audit trail records every press in order — but
  only as a non-fatal, reported skip if `supabase/add-vendor-week-status-
  log.sql` hasn't been run yet, since the core switch/undo behavior never
  depends on that table existing.
- **`item-category-checks.mjs`** — regression for a bug where
  `PATCH /api/items` silently ignored `category` (never destructured or
  whitelisted, even though every other Manage Items edit-form field was) —
  a category change returned 200 with the row unchanged, so it looked like
  it saved and then "reverted" on refresh. Confirms category now actually
  persists (re-fetched independently, not just echoed in the PATCH
  response), that it doesn't touch par/count/pack_size, that every other
  field in the same form still saves (together, in one request), and the
  new "nothing matched" 400 guard. Uses a disposable `ZZTEST Category Bug
  Item`.
- **`item-flavor-link-checks.mjs`** — patch 45: `items.flavor_id`
  (owner-only `PATCH /api/items/flavor`, validated against a real flavor;
  shared `PATCH /api/items` ignores it; the shift_lead/staff/no-session
  gates). Cycles one `ZZTEST Flavor` through all six program values and
  re-fetches `GET /api/items` each time to prove the embedded badge is a
  live join (never copied), confirms a hibernate-tagged linked item's
  `is_off`/par/count are untouched, and that deleting the flavor leaves
  the item intact with `flavor_id` back to null. Uses a disposable
  `ZZTEST Flavor Badge Item` + `ZZTEST Flavor`.
- **`order-list-other-merge-checks.mjs`** — patch 46: regression for a bug
  where a null-distributor item showed up TWICE on the Order List, under
  two separate "Other" headers (`byDistributor['other']`'s
  `i.distributor ?? 'other'` already caught null, while a separate
  `unmapped` list ALSO caught it). Pure-logic, no DB — exercises
  `vendorKeyForItem()` (`src/lib/vendor-schedule.ts`), the one shared key
  function every grouping site (the Order List's display, its Order
  Placed/Nothing to order actions, and the server-side item-count-per-
  vendor helper) now uses, and mirrors the exact bucket-construction shape
  order-list/page.tsx builds from it. Runs via tsx, same reasoning as
  vendor-schedule-checks.mjs.

- **`order-history-paging-checks.mjs`** — patch 47: `order_history` has no
  upper bound, and an unlimited `.select()` silently truncates at
  PostgREST's 1000-row cap (same bug class as patch 41's row-cap fix).
  `src/lib/order-list-server.ts`'s `getItemsNeedingOrderByVendor` (feeds the
  Order List's vendor counts, `GET /api/vendor-schedules`, and the
  vendor-reminders cron) used to read `order_history` this way; it now
  pages through the whole table via `fetchAllOrderHistoryRows` instead.
  Can't practically grow `order_history` past 1000 real rows in a test, so
  this proves the paging loop itself is correct by forcing a tiny
  `pageSize` (2) against a handful of disposable `ZZTEST` order rows and
  confirming the result exactly matches a plain unbounded `.select()`, then
  separately confirms `getItemsNeedingOrderByVendor`'s real-data output
  matches an independent re-implementation of the old (pre-patch-47)
  single-select matching logic. Also covers
  `src/lib/vendor-reminder-server.ts`'s `recordReminderSent` (the
  `vendor_reminder_log` write the cron route now performs *before* sending
  a push, so a write failure skips that tick's push instead of risking a
  repeat send) — its failure path is tested with a hand-rolled fake db
  stub, never a real write, and a loop simulation proves one vendor's
  failure doesn't stop the next vendor from being processed. Uses a
  disposable `ZZTEST Paging Item` plus six `ZZTEST`-tagged `order_history`
  rows, all cleaned up in the same run via the real `DELETE` routes
  (`order_history_items` cascades off `order_history` on delete).

- **`receive-order-race-checks.mjs`** — patch 48: `POST /api/order-history`'s
  non-storage receive branch used to do a naive read-then-write on
  `items.current_count` (no compare-and-swap, no retry) -- two overlapping
  receipts for the same item could silently lose one increment. Fixed via
  `applyCurrentCountIncrement` (`src/lib/storage-server.ts`), a new sibling
  to the existing storage writers built on the same shared `withRetry`
  control flow. Proves: a normal single receipt (storage and non-storage)
  still gives the exact same number as before; five rounds of two
  overlapping concurrent receipts for the same `ZZTEST` item never lose an
  increment; a receipt with one item that genuinely can't be applied (a
  real, deterministic Postgres numeric-overflow forced by pre-loading a
  second `ZZTEST` item right up against `current_count`'s `DECIMAL(10,2)`
  limit -- not a mock) rolls back completely -- the other item's
  already-applied increment is reversed and no `order_history` row is left
  behind; and, separately, that the retry primitive itself genuinely gives
  up with a clear 409 after exactly `MAX_RETRIES` attempts, tested against
  a hand-rolled fake db that always reports a conflict (same "mock to force
  exhaustion" technique as patch 47's `recordReminderSent` test, since a
  real HTTP race can't reliably force every attempt to collide on demand).

- **`notes-photo-path-checks.mjs`** — patch 49: note photos used to be
  saved under a path built only from `Date.now() + Math.random()` in a
  public-read bucket; `POST /api/notes/photo-upload` now prefixes new
  uploads with a fresh `crypto.randomUUID()` instead (same unguessable idea
  as task photos' task-id-prefixed path). Proves a new upload's path
  matches the UUID-prefixed shape, that it actually uploads and attaches to
  a real (disposable `ZZTEST Notes Staff`-authored) note correctly, that
  role rules are unchanged (no session -> 401), and — read-only, against
  real data, never printing the URL — that an existing photo uploaded
  under the OLD path still loads. Also proves the four routes patch 49
  deleted (`push-debug`, `migrate-counts`, `migrate-distributor`, `seed`)
  now 404 and nothing else broke. Uses a disposable `ZZTEST Notes Staff`
  (notes require `created_by` to be an active `staff` row, which the
  ZZTEST owner/shift-lead accounts aren't) plus one uploaded test file,
  both cleaned up in the same run.

- **`patch-50-checks.mjs`** — patch 50: upload limits, the note-photos
  orphan cleanup's dry run, and the `order_history_related_order_id_fkey`
  fix. Proves the 5MB/image-type bucket limits (set once via the Storage
  admin API, not a route in this app) genuinely reject an oversized or
  non-image upload and that `friendlyUploadError()` (`src/lib/photo.ts`)
  translates Storage's raw messages into plain language. Proves
  `cleanupOrphanedNotePhotos` (`src/lib/note-photo-cleanup-server.ts`)
  only selects an orphan past its 24h safety window — using an injected
  clock, since a real Storage object's `created_at` can't be backdated —
  while a fresh orphan and a referenced file both survive, and that its
  fail-safes (a broken or unexpectedly-empty `note_photos` lookup) abort
  without deleting anything. Proves deleting a `ZZTEST` "ordered" row that
  a `ZZTEST` "received" row points to now succeeds and nulls that row's
  link, with vendor "needs ordering" counts unchanged. Uses disposable
  `ZZTEST` items/notes/staff/storage files, all cleaned up in the same run.

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
npm run test:e2e                 # all ten, in sequence
npm run test:e2e:role-checks
npm run test:e2e:step-checks
npm run test:e2e:logout-race     # doesn't need either ZZTEST account
npm run test:e2e:row-cap-checks
npm run test:e2e:vendor-schedule # pure logic, doesn't need the dev server or either ZZTEST account
npm run test:e2e:notification-linking
npm run test:e2e:vendor-week-switch
npm run test:e2e:item-category
npm run test:e2e:item-flavor-link
npm run test:e2e:order-list-other-merge # pure logic, doesn't need the dev server
npm run test:e2e:order-history-paging
npm run test:e2e:receive-order-race
npm run test:e2e:notes-photo-path
npm run test:e2e:patch-50
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
