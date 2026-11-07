# Rita's Italian Ice – Brea Inventory & Tasks App

## 1. What this is
A mobile-first PWA for Rita's Italian Ice, Brea location: inventory counting/ordering **plus** a full daily task/checklist system, sticky notes, and weekly flavor planning. Owner: Rita (mother); day-to-day owner-role users are Josh and Gina; shift leads and staff use it on a shared ViewSonic touchscreen mounted in the store, plus personal phones. Installable via "Add to Home Screen" (standalone, no browser chrome).

Auto-reload: every deploy bakes a build id (`VERCEL_GIT_COMMIT_SHA`, see `next.config.ts`) into the bundle. `AutoReloadWatcher` (mounted in root layout) polls `/api/version` every 5 min (3s while idle) and does a hard reload when the server's build id no longer matches the page's — silent, no banner. A `localStorage` loop-guard (`ritas_autoreload_log`) blocks repeat reloads within 10 minutes. Disable via server env var `AUTO_RELOAD_DISABLED=1` (needs a redeploy to take effect — see §3).

This directory (`ritas-app/`) IS the Next.js root and the git repo root.

---

## 2. Commands
- `npm install` — install deps
- `npm run dev` — `next dev` (Turbopack)
- `npx tsc --noEmit` — typecheck (there is **no** `npm run typecheck` script)
- `npm run lint` — `eslint .`
- `npm run build` — `next build`

**There is no persisted Playwright/regression suite in this repo.** Every past "test suite" (patch 29's role-check suite, patch 36's, etc.) was written from scratch into that session's ephemeral scratchpad directory (outside the repo) and does not survive between sessions. The established convention, to recreate when testing a change:
- Fixtures are prefixed `ZZTEST` (names, lists, tasks) so they're unmistakable and easy to sweep up.
- Run against `npm run dev` on localhost — **never** against a Vercel preview URL (previews are SSO-protected; see §6).
- Seed/cleanup via direct Supabase REST calls using the service-role key, read from `.env.local` with Node `readFileSync` and never printed/logged. A small `rest.mjs` helper (base URL + service-role auth header) gets reused across test files.
- Clean up afterward with a script that deletes by name/title `ilike 'zztest*'`, remembering that hard-deleting a template **detaches** (doesn't delete) its done/missed instances — a template-first sweep misses those; also sweep `task_instances` directly by title/`checklist_name`.
- Playwright's `getByRole`/text matchers are case-insensitive **substring** by default — pass `exact: true` or you'll get accidental matches (e.g. "Delete list" matching inside a fixture named "...Delete List").

---

## 3. Architecture map
- **Session & roles** — `src/lib/session.ts`. HMAC-SHA256-signed cookie `ritas_session` (httpOnly, `sameSite: lax`, `Secure` only when `NODE_ENV=production` so local http testing works). Roles: `owner` / `shift_lead` / `staff`. `getSession`/`requireRole` also revoke a structurally-valid cookie if the named person is `active=false` or if `owners.updated_at`/`shift_leads.updated_at` is newer than the cookie's `iat` (PIN change or deactivation kills existing sessions immediately, no 30-day wait). Staff sessions name no one and can't be revoked this way. `SessionGuard` (mounted globally) patches `window.fetch` so **any** 401 anywhere bounces the device to `/login`.
- **PIN verify** — `src/app/api/pins/verify/route.ts`. Checks the submitted PIN against `owners.pin` or `shift_leads.pin` directly (plaintext, see §5), rate-limited via `src/lib/rate-limit.ts` (`login_attempts` table: blocks after 10 failures from one IP in 15 minutes; purged after 7 days by the nightly cron). On match, sets the session cookie.
- **Tasks: templates/instances/generator/cron** — `src/lib/task-server.ts` is the core server logic (`generateInstancesForDate`, `sweepMissedInstances`, `createChecklist`, `renameChecklistList`, `deleteChecklistList`, `moveChecklistList`, `addChecklistItem`, `moveChecklistItem`, `moveTemplateToSection`, `renameChecklistSection`, `deleteTemplate`/`deleteOneOffTask`, step functions — see below). `/api/cron/generate-tasks` runs daily via Vercel Cron (`vercel.json`), auth'd by `Authorization: Bearer $CRON_SECRET` which Vercel sends automatically when that env var is set; fails closed with no secret configured. `/api/cron/cleanup-photos` runs nightly: purges task/note photos older than 90 days and `login_attempts` rows older than 7 days.
- **`src/lib/tasks.ts`** — shared grouping/ordering/date helpers: `buildChecklistGroups`/`buildTemplateChecklistGroups` (group by `checklist_name`→`section`), `sortChecklistNames`, `sortStandalone`, `groupHistoryByDay`, `todayInTZ`/`addDays`/`toHM`/`formatDueTime`/`isOverdue`/`normalizeListName`.
- **Steps + step checks** — a template can be `step_style: 'none' | 'reference' | 'checklist'`. `'checklist'` templates carry ordered sub-steps (`task_template_steps`); an instance can't be marked done until every step is checked (`task_instance_step_checks`, enforced in `canCompleteInstance`). `attachStepsToInstances` hydrates steps onto instances live from the template (not snapshotted — a template's steps mid-day change what an already-generated instance shows). **Gotcha:** neither `task_template_steps` nor `task_instance_step_checks` has a CREATE TABLE migration file anywhere in `supabase/` — both exist live (confirmed via `enable-rls-all.sql`'s table list) but were created directly in the Supabase SQL Editor without a saved migration. Same is true of `login_attempts` (referenced via comment as "add-login-attempts.sql", which doesn't exist in the repo).
- **Checklists/lists** — `checklists` table (`name` PK, `due_time`, `active`, `sort_order`). Owner-only CRUD via `/api/checklists`. Creating sets `sort_order = max+1`. Renaming cascades to templates and to open (and same-day done) instances in one operation; already-completed instances from before a rename keep the old name, so they show under a separate old-name card on Today's view until they roll into History — intentional, not a bug. Turning a list `active=false` stops the generator from making new instances for its templates and hides its open instances from the To-Do tab/counts/notifications for everyone; turning it back on resumes. Hard-deleting a list cascades to its templates using the same per-template rule as a single task's hard delete (open instances deleted, done/missed instances detached via `template_id=null`, so History stays intact).
- **Notes** — `src/lib/notes.ts` (types/helpers) + `notes-server.ts`. Tables: `notes`, `note_replies`, `note_acknowledgments`, `note_photos` (up to 3 per note). Delete = archive (`archived`/`archived_at`), not destroy. `owner_only` notes are private to the owner role with no exceptions (an earlier per-device "known author" exception leaked private notes and was removed). `requires_ack` notes track who acknowledged in `note_acknowledgments`; `computeAckDenominator` (`src/lib/staffColor.ts`) computes how many people are required to ack (every active staff + shift lead, deduped, minus owners, minus a shift-lead author's own note).
- **Flavors** — `src/lib/flavors.ts`. `FLAVOR_SECTIONS` defines three spaced-out slot "lanes" so growing one never renumbers another: `ice` (slots 1–12: italian_ice/cream_ice/sugar_free), `soft_serve` (101–103), `hs_custard` (201–212). Tables `flavors`/`flavor_weeks`/`flavor_week_slots`; a slot snapshots `flavor_name`+`flavor_type` at pick time so a past week's display survives the catalog entry being deleted later.
- **Shared components** — `src/components/`: `Navigation`, `SessionGuard`, `AutoReloadWatcher`, `StaffName`, `BackToTop`, `ScrollToSaveButton`, `PinModal`/`PinManagementView`. `src/components/todo/`: `TimeField` (custom hour/minute/AM-PM `<select>`s — see §7), `TemplatesView`, `ManageListModal`, `ShiftLeadView`/`StaffView`, `NotesBoard`/`AddNoteModal`/`AckModal`, `FlavorSlotPicker`/`FlavorCatalogView`, `HistoryView`/`MissedView`, `ConfirmModal`.
- **Inventory pages** — `/count`, `/order-list`, `/receive-order`, `/history`, `/reports`, `/par-settings`, `/manage-items`, `/dashboard`, `/current-stock`. Tables `items`, `inventory_counts`, `order_history`/`order_history_items` (snapshots `item_name` at order time). Unchanged base system predating the task/notes/flavors work.
- **Version/auto-reload plumbing** — `next.config.ts` bakes `NEXT_PUBLIC_BUILD_ID`; `/api/version` (`force-dynamic`, no auth — must never 401) returns the live build id + `autoReload` boolean read fresh from `AUTO_RELOAD_DISABLED` on every request.

---

## 4. Database
Every table has Row Level Security **enabled with no policies** (`supabase/enable-rls-all.sql`) — the anon key (public, embedded in the client bundle) is locked out of all of them. The app only ever uses the service-role key (`getServerSupabase()` in `src/lib/supabase.ts`), server-side only, which bypasses RLS entirely. **Never** request or print `SUPABASE_SERVICE_ROLE_KEY`'s value.

Key tables (not exhaustive — see `supabase/*.sql` for full history):
- `items`, `inventory_counts`, `order_history`/`order_history_items` — base inventory (pre-dates tasks).
- `owners` (`name` PK, `pin`, `active`, `created_at`, `updated_at`), `shift_leads` (`id` PK, `name` unique, `pin`, `active`, `created_at`, `updated_at`) — real per-person PINs, **plaintext**. A legacy generic `pins` table (`name` PK `'owner'/'shift_lead'`, `value`) predates these; both its rows were deleted when `owners`/`shift_leads` were introduced and no app code references it anymore (verified by grep) — it's vestigial but was never dropped.
- `staff` (`name` unique, `active`, `color`) — `created_by`/`assigned_to` on tasks use a separate short-name convention (`Josh`/`Gina`/`Valerie`), reconciled to staff full names via alias maps in `staffColor.ts`, not a FK.
- `checklists`, `task_templates`, `task_instances`, `task_template_steps`, `task_instance_step_checks` — see §3. **`checklist_name`/`section` on `task_templates`/`task_instances` are plain free-text columns, NOT a foreign key to `checklists.name`** (confirmed: no such `references` anywhere in `supabase/`). `task_instances` **snapshot** `checklist_name`/`section`/`sort_order`/`title`/etc. from their template at generation time — not a live join — so a rename/reorder must explicitly push onto already-generated instances or it won't show until tomorrow's regeneration. `task_instances.template_id → task_templates(id)` has **no cascade**; hard-deleting a template requires explicitly handling its instances (exactly what `deleteTemplate`/`deleteChecklistList` do).
- `notes`, `note_replies`, `note_acknowledgments`, `note_photos` — see §3.
- `flavors`, `flavor_weeks`, `flavor_week_slots` — see §3.
- `clover_items`, `clover_item_mappings` — Clover POS menu-item → inventory-item consumption mapping (seeded, not actively built out further).
- `count_draft`, `push_subscriptions`, `login_attempts` — single-row shared count-entry draft, web push subscriptions, login rate-limit log.

Migration files run roughly in this order: `schema.sql` → `update-secondary-count.sql`/`update-6-22.sql`/`update-type-and-decimal-counts.sql`/`update-par-levels-decimal.sql` (inventory evolution) → `add-order-history.sql`/`add-received-by.sql` → `add-tasks.sql` → `add-priority-and-pins.sql` (legacy `pins`) → `add-missed-status.sql` → `add-task-assigned-to.sql` → `add-task-instance-description.sql` → `add-task-checklist-grouping.sql` → `add-task-due-times.sql` (adds `checklists`) → `add-named-owner-pins.sql`/`add-named-shift-lead-pins.sql`/`add-owners-updated-at.sql` (kills legacy `pins` rows) → `add-notes.sql` and its chain (`-archive`/`-handled`/`-owner-only-notes`/`-note-acknowledgments`/`-note-photos`/`-note-multi-photos`/`-note-replies` + four `enable-*-realtime.sql`) → `add-flavors.sql`/`add-flavor-type.sql`/`add-flavor-type-fixes.sql`/`seed-flavors-from-csv.sql` → `add-clover-mapping.sql` → `add-count-draft.sql`/`add-is-test-data.sql`/`add-par-level-secondary.sql`/`add-conversion-factors.sql` → `add-push-subscriptions.sql` → `add-staff-color.sql` → `corporate-checklists-seed.sql` → `fix-checklist-created-by.sql`/`fix-clean-batch-machines-created-by.sql` (data corrections) → `add-lists-support.sql` (`checklists.active`+`sort_order`) → `enable-rls-all.sql`.

---

## 5. Security model
- Session cookie is HMAC-signed and verified with `timingSafeEqual`; expiry + role + revocation checked server-side on every `requireRole` call (see §3). **401** = no/invalid/expired/revoked session. **403** = valid session, wrong role for this route.
- Rate limiting: 10 failed PIN attempts from one IP in 15 minutes blocks further attempts with 429 (doesn't even check the PIN); the log purges after 7 days.
- Owner-only routes (server-enforced, not just hidden in the UI): list create/rename/move/activate/delete, template/list hard delete, task-template create/edit for most fields.
- **PINs are plaintext** in `owners.pin`/`shift_leads.pin` — verified directly in `/api/pins/verify/route.ts`, which does `.eq('pin', pin)`. **Correction to carry forward accurately: there is no PIN-hashing work anywhere in this repo.** `git branch -a` shows only `main` and `patch-29-sessions`; no `patch-31-pin-hash` or similar branch exists, and no commit mentions hashing PINs. If a future session is told such a branch exists, re-verify with `git branch -a` before trusting it — don't repeat an unverified claim.

---

## 6. How we work
- **SQL is always run by Josh in the Supabase SQL Editor — never by Claude.** Write idempotent `.sql` files (e.g. `add column if not exists`, `on conflict do nothing`) and STOP for explicit go-ahead before writing app code that depends on a schema change existing.
- For any nontrivial feature with open design questions, propose a plan first (two-phase: plan → explicit go-ahead → implement) rather than guessing intent.
- Testing is ZZTEST-only, on `localhost` via `npm run dev` — see §2. Always give back the exact cleanup SQL/script used.
- **Never** read, `cat`, or print `.env.local` or any secret value. Never run `vercel link`. Never touch Vercel protection/bypass settings.
- Vercel Preview deployments are SSO-protected — don't try to test against them; test on localhost instead.
- Env var changes in the Vercel dashboard need a redeploy to actually take effect (the running deployment keeps its old values).
- After a change: push to `main` (Vercel auto-deploys on push), wait for the deployment, and report back the commit sha and that production reached Ready.
- Don't change behavior beyond what's asked. If something surprising turns up mid-task, report it rather than silently working around it.
- Keep reports short and plain.

---

## 7. Design rules
- Never reuse an existing color's/badge's/icon's/border's established meaning for something new — invent a new badge/icon/border instead of overloading one that already means something else.
- Custom `TimeField` only, never a native `<input type="time">` — Safari/WebKit renders an empty native time input with a misleading phantom time instead of truly blank.
- Prefer deactivate/archive over hard delete; when something is deleted/renamed, snapshot the name/value it had so history displays correctly after the source changes or disappears.
- Big touch targets everywhere (shared touchscreen device) — buttons are `min-h-[48px]` or larger.
- No hover-only affordances/behavior.
- To-Do tab: no PIN and no name/staff picker required for anything **except** picking a name when completing a main (non-step) task.
- Dashboard must not duplicate Order List's content.

---

## 8. Gotchas
- **Switch/Home logout race**: a deliberate Home/Switch tap (`Navigation.tsx`) calls `POST /api/logout` then navigates to `/login`; if that call fails/times out, the session cookie may still look valid when `/login` runs its own "returning staff device" auto-skip check, making a deliberate exit look like it did nothing. Fixed via `SKIP_LOGIN_AUTOSKIP_KEY` in `sessionStorage` (`SessionGuard.tsx`), set right before navigating, which tells `/login` to skip that one check.
- **Instance snapshot staleness**: because `task_instances` snapshot template fields at generation time (not a live join), renaming/reordering/moving a template requires an explicit sync onto already-generated open (and same-day done) instances, or the change won't show until the next day's cron regeneration.
- Next.js's built-in dev-tools indicator badge only appears under `next dev` — it's not present in any real deploy (`next build`/Vercel Preview/Production), so don't mistake its absence for a bug.
- A Vercel environment variable marked "Sensitive" can be written but never read back (via dashboard or API) once saved — if you need to confirm a value, ask Josh to check it directly rather than trying to fetch it.
- Running `rm -rf .next` while `next dev` is still running crashes the dev server (MODULE_NOT_FOUND/ENOENT) — kill it first, then restart cleanly.
- PostgREST's `in.(...)` filter syntax breaks on a value containing a comma (e.g. the real list "Time to Lean, Time to Clean") — filter in JS after fetching instead of trying a DB `not in (...)`.

---

## 9. Current status
Shipped, in order:
- **28** — Task steps (reference text or checkable sub-steps per template/instance).
- **29** — Server-side sessions + role enforcement on every API route, RLS enabled on all tables, login rate limiting.
- **30** — Silent auto-reload when a new build deploys.
- **32** — Soft Serve + Hand Scoop Custard sections on the Flavors planner.
- **33** — Ice slots shown 3-wide on `/flavors`.
- **34** — Turned-off tasks sink to the bottom on Repeating; back-to-top button everywhere.
- **35** — Hide slot numbers on `/flavors`.
- **36** — Add tasks to any list, and create new lists (owner only): `sort_order = max+1` on create, rename cascades to templates + open/same-day-done instances, turning a list off stops its generator and hides it everywhere, duplicate names rejected case/whitespace-insensitively.
- **Unnumbered follow-up to 36** — Owner-only hard delete for task lists (cascading to templates, same detach-don't-delete rule as single-task hard delete), to match the hard delete tasks already had.

Not in progress; nothing currently paused. (A prior note in this file claimed a paused `patch-31-pin-hash` branch — that was checked this session and found not to exist; see §5.)

---

## 10. Known open items
- Three pre-existing `react-hooks/exhaustive-deps` lint warnings (not errors — `npm run lint` passes): `src/app/count/page.tsx:192` (`fetchItems`), `src/app/history/page.tsx:64` (`fetchTop10`), `src/app/order-list/page.tsx:114` (`loadAll`).
- No duplicate Vercel project — checked `list_projects`, only one project (`ritas-inventory`) exists under the team. (A prior note here claimed an unverified duplicate named `ritas-app`; not found.)
- A public-repo secret-history check (confirming no secret was ever committed to git history) has not been done.
- `task_template_steps`, `task_instance_step_checks`, and `login_attempts` have no migration file in `supabase/` despite existing live — see §3/§4. If any of them ever needs to change, write the new migration as a normal idempotent `.sql` file; don't assume a prior "original" file exists to look at.
- PIN hashing has not been started at all (see §5's correction) — PINs are plaintext today.
