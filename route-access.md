# Route access table (patch 29)

Server-enforced via `requireRole(db, request, [...roles])` in `src/lib/session.ts`,
checking the `ritas_session` cookie set by `/api/pins/verify` (owner/shift_lead)
and `/api/session` (staff). No session → 401. Valid session, wrong role → 403.

Derived from what each route's actual callers in `src/app/*` are allowed to see
today (not from the route's own code comments, which sometimes said "owner-only"
more loosely than the UI actually enforces) — see the patch 29 report for the
handful of judgment calls and corrections.

Tiers, most to least permissive:
- **PUBLIC** — no session required (login itself, cron secret-gated routes, logout)
- **ANY** — any valid session: `owner`, `shift_lead`, or `staff`
- **SL+** — `owner` or `shift_lead`
- **OWNER** — `owner` only

| Route | Method | Tier | Why |
|---|---|---|---|
| `/api/cron/generate-tasks` | GET | PUBLIC (CRON_SECRET) | unchanged |
| `/api/cron/cleanup-photos` | GET | PUBLIC (CRON_SECRET) | unchanged |
| `/api/seed` | POST | PUBLIC (CRON_SECRET) | one-time, no caller |
| `/api/migrate-counts` | POST | PUBLIC (CRON_SECRET) | one-time, no caller |
| `/api/migrate-distributor` | POST | PUBLIC (CRON_SECRET) | one-time, no caller |
| `/api/push-debug` | GET | PUBLIC (CRON_SECRET) | debug, no caller |
| `/api/pins/verify` | POST | PUBLIC | this *is* login (owner/shift_lead); also what the todo page's inline "+Add Task" PinModal calls, which now also grants a real owner session as a side effect |
| `/api/session` | GET | PUBLIC | tells a device what session (if any) it has, for routing |
| `/api/session` | POST | PUBLIC | issues a staff session after picking a name from the active list — not a security boundary, just gives the server a role to check |
| `/api/logout` | POST | PUBLIC | must work even with an invalid/expired cookie |
| `/api/checklists` | GET | ANY | read |
| `/api/checklists` | PATCH | OWNER | due-time editor, owner-only in UI |
| `/api/clover-items` | GET | OWNER | Clover Mapping page is owner-only |
| `/api/clover-mappings` | POST/DELETE | OWNER | same page |
| `/api/count-draft` | GET/PUT/DELETE | SL+ | Count Entry is owner+shift_lead |
| `/api/counts` | GET/POST | SL+ | Count Entry / Adjustment |
| `/api/counts/last-per-item` | GET | OWNER | only called from Current Stock (owner) |
| `/api/dashboard-summary` | GET | SL+ | called from both Count Entry and Dashboard |
| `/api/flavors` | GET | ANY | weekly planner's picker is visible even with no role |
| `/api/flavors` | POST/PATCH/DELETE | OWNER | Flavors Catalog management, owner-only in UI |
| `/api/flavors/week` | GET | ANY | same visibility as flavors GET |
| `/api/flavors/week` | PATCH | SL+ | "same tier as + Add Task" per its own comment, and Flavors page's `canManage` has no staff PIN-unlock escape hatch (unlike the todo page) |
| `/api/items` | GET | SL+ | Count/Adjust/Receive-Order/Dashboard/Manage Items all need it |
| `/api/items` | POST | OWNER | only Manage Items creates items |
| `/api/items` | PATCH | SL+ | Count/Adjust/Receive-Order bump `current_count` through this same endpoint as Manage Items' full-record edits — **more permissive than ideal**: a shift_lead session can technically also rename an item or change its par level through this route today, since it's not split by field. Flagged, not fixed this patch. |
| `/api/items` | DELETE | OWNER | only Manage Items deletes |
| `/api/notes` | GET | ANY | `?role=` query param removed — owner-only notes now gated by `session.role === 'owner'` only |
| `/api/notes` | POST | ANY | no-PIN tier today, unchanged |
| `/api/notes` | PATCH | ANY | "handled" toggle; the owner-authored-note sub-case stays client-side gated as before — not split out this patch |
| `/api/notes` | DELETE | SL+ | archive, owner/shift-lead tier per its own comment |
| `/api/notes/history` | GET | ANY | same `?role=` removal as `/api/notes` |
| `/api/notes/acknowledgments` | POST | ANY | no-PIN tier today |
| `/api/notes/replies` | POST | ANY | no-PIN tier today |
| `/api/notes/photo-upload` | POST | ANY | no-PIN tier today |
| `/api/order-history` | GET/POST | SL+ | Receive Order is owner+shift_lead |
| `/api/order-history` | PATCH | OWNER | only Dashboard resolves a short |
| `/api/order-history` | DELETE | OWNER | only Order List deletes a record |
| `/api/par-suggestions` | GET | OWNER | only Par Settings |
| `/api/pins` | GET/PATCH | SL+ | Change PIN screen, self-service for either role |
| `/api/reports/velocity` | GET | OWNER | Dashboard/History/Reports are all owner-only |
| `/api/send-push` | POST | ANY | **more permissive than the patch's suggested "owner or shift_lead"** — the todo page's task-completion flow calls this and has no role requirement today (plain staff completes tasks); gating tighter would have silently killed completion push notifications. Flagged. |
| `/api/shift-leads` | GET/POST/PATCH/DELETE | OWNER | management screen, owner-only in UI |
| `/api/staff` | GET (default) | PUBLIC | **correction during implementation**: the login page's one-time staff name picker needs this *before* any session exists, to call `POST /api/session` in the first place — gating it to ANY would make that bootstrap step impossible. Just names, nothing sensitive, and was fully public before this patch too, so nothing lost. |
| `/api/staff` | GET `?all=true` | OWNER | Staff management screen only |
| `/api/staff` | POST/PATCH | OWNER | same screen |
| `/api/subscribe` | POST/DELETE | OWNER | "Enable Notifications" only renders in the owner-only More dropdown |
| `/api/task-templates*` (incl. `/steps`, `/checklist-item`, `/rename-section`) | all | OWNER | Repeating tab, owner-only in UI |
| `/api/tasks` | GET `view=today\|badge\|history` | ANY | the To-Do board itself has no role requirement |
| `/api/tasks` | GET `view=missed` | OWNER | comment: "Owner-only (client-side gated...)" |
| `/api/tasks` | POST (one-off create) | SL+ | gated by the todo page's `canManage` (owner/shift_lead, or staff who unlocked via the real owner PIN — which now also grants a real session, so SL+ covers that path too) |
| `/api/tasks` | PATCH `action=complete\|check-step\|uncheck-step\|photo` | ANY | no role requirement in the UI today |
| `/api/tasks` | PATCH `action=undo` | SL+ | gated by `canManage`, same as task creation |
| `/api/tasks` | PATCH `action=move\|priority\|edit` | OWNER | `isOwner`-gated buttons / explicit "owner-only in the UI" comments |
| `/api/tasks` | DELETE | OWNER | comment: "the UI only offers this to owners" |
| `/api/tasks/photo-upload` | POST | ANY | no role requirement in the UI today |

## Not session-gated at all (unchanged, out of scope for this patch)
- `/api/pins` PATCH's own `current_pin` check — a secret check, not a role check; kept, now also rate-limited (B9).
- Field-level distinctions inside `/api/items` PATCH and `/api/notes` PATCH (who-authored-it sub-cases) — flagged above, left for later.
