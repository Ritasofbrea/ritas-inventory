# Rita's Italian Ice – Brea Inventory App

## What this is
A mobile-first PWA inventory management app for Rita's Italian Ice, Brea location. Owner: Rita (mother). Day-to-day users: shift leads. Installable on iOS/Android home screen via "Add to Home Screen" — no browser chrome in standalone mode.

---

## Stack
- **Framework**: Next.js (App Router, Turbopack) — this directory IS the Next.js root
- **Database**: Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Deployment**: Vercel — auto-deploys on push to `main`
- **GitHub**: https://github.com/Ritasofbrea/ritas-inventory.git
- All git operations run from inside `ritas-app/` — the repo root IS `ritas-app/`

---

## Environment Variables
| Name | Purpose |
|------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `NEXT_PUBLIC_OWNER_PIN` | Owner login PIN (4–6 digits) |

---

## Auth
No real auth system. Role stored in `localStorage` via `getRole()` / `clearRole()` in `src/lib/auth.ts`.

Two roles: `owner` and `shift_lead`
- Shift leads tap the red button on `/login` — no PIN required
- Owners tap the white button and enter `NEXT_PUBLIC_OWNER_PIN`
- All owner-only pages redirect to `/count` if role !== 'owner'

---

## Branding & Colors
- **Green**: `#1a7a3c` — primary brand, nav background, login background
- **Red**: `#c8102e` — Rita's Red, used for alerts and accent buttons
- **Mint**: `#d4edda` — inner page backgrounds
- Body background: `#1a7a3c` (prevents green bleed in PWA standalone mode)
- Inner pages: `bg-[#d4edda]` on outermost div, white cards inside
- Logo: `public/Ritas_Logo_4c.png` — transparent PNG. **Never add drop-shadow or box-shadow** — it renders as a dark square

---

## Navigation (`src/components/Navigation.tsx`)
Two-row sticky nav:
- **Top row**: logo + "Brea's Inventory" + role label + Switch button
- **Bottom row**: scrollable tab bar

**Owner tabs**: Dashboard · Order List · History · More ▾
- More dropdown contains: Count Entry, Receive Order, Par Levels, Manage Items, Reports
- Dropdown uses `position: fixed` with `getBoundingClientRect()` — **never use relative positioning**, it gets clipped by overflow

**Shift lead tabs**: Count Entry · Receive Order

---

## Database Schema
Run all four SQL files in order from `supabase/` in the Supabase SQL Editor:
1. `schema.sql` — creates `items`, `inventory_counts`, seeds all items
2. `update-secondary-count.sql` — adds `secondary_count`, `secondary_unit` columns to `items`
3. `update-6-22.sql` — decimal counts, new items, unit fixes
4. `add-order-history.sql` — creates `order_history` and `order_history_items` tables

### `items`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | |
| category | TEXT | |
| unit | TEXT | |
| current_count | DECIMAL(10,2) | |
| par_level | INTEGER | |
| sort_order | INTEGER | |
| supplier_order | INTEGER | ordering sort within distributor |
| distributor | TEXT | `bunzl`, `balford`, `other`, `seasonal`, `discontinued` |
| item_number | TEXT | customer-facing, e.g. `0101` |
| distributor_item_name | TEXT | name as it appears in distributor catalog |
| secondary_count | DECIMAL(10,2) | |
| secondary_unit | TEXT | if set, dual count field appears on Count Entry |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | auto-updated via trigger |

### `inventory_counts`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| item_id | UUID FK → items | |
| count | DECIMAL(10,2) | |
| entered_by | TEXT | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |

### `order_history`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| type | TEXT | `ordered`, `received`, `will_call`, `short` — enforced by CHECK constraint |
| notes | TEXT | |
| resolved | BOOLEAN | defaults `true`; shorts saved as `false` |
| related_order_id | UUID FK → order_history | receipt points back to the ordered record it fulfills |
| created_at | TIMESTAMPTZ | |

### `order_history_items`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| order_id | UUID FK → order_history | CASCADE delete |
| item_id | UUID FK → items | SET NULL on delete |
| item_name | TEXT | snapshot at time of order |
| quantity | DECIMAL(10,2) | |
| unit | TEXT | |

---

## API Routes

### `/api/items`
- `GET` — all items ordered by `sort_order`
- `POST` — create item (auto-calculates `sort_order`)
- `PATCH` — update any item fields including `secondary_count`, `secondary_unit`, `par_level`

### `/api/counts`
- `POST` — saves inventory count records + updates `items.current_count` for each item counted

### `/api/order-history`
- `GET` — `?type=ordered|received|will_call|short`, `?unresolved=true`; returns with `order_history_items` joined; limit 50 newest
- `POST` — creates order record + items rows; auto-adds to `current_count` when `type` is `received` or `will_call`; pass `resolved: false` for shorts
- `PATCH` — `{ id, resolved: true }` to resolve a short

### `/api/reports/velocity`
- `GET` — `?start=YYYY-MM-DD&end=YYYY-MM-DD` — consumed per item between two count dates

### `/api/par-suggestions`
- `GET` — returns suggested par levels per item based on 90-day velocity (1.5× weekly avg consumption); only items with 2+ count records

---

## Pages

| Route | Role | Description |
|-------|------|-------------|
| `/login` | all | Role selection + owner PIN entry |
| `/dashboard` | owner | OUT/LOW/OK sections + unresolved short shipment banners |
| `/count` | both | Count entry grouped by category; secondary counts in purple |
| `/order-list` | owner | Today's Order (with On Order section) + Order History tabs |
| `/receive-order` | both | 3-step: select order → enter quantities → acknowledge shorts |
| `/history` | owner | Top 10 velocity tab + Recent Counts tab |
| `/reports` | owner | Date-range velocity report with category filter |
| `/par-settings` | owner | Set par levels with velocity-based suggestions inline |
| `/manage-items` | owner | Edit all item fields |

---

## Key Behaviors & Gotchas

### Decimal inputs
Always use `type="text" inputMode="decimal"` with regex `/^\d*\.?\d*$/`. **Never use `type="number"`** — unreliable on iOS.

### Stock status (`src/lib/types.ts` → `getStockStatus`)
- `out`: `current_count === 0`
- `low`: `current_count > 0 && current_count < par_level`
- `ok`: `current_count >= par_level`

### Order list flow
- Items below par appear in Today's Order with checkboxes (all checked by default)
- After "Mark as Ordered", items move to an "On Order" section and leave the actionable list
- "On Order" = item appears in an `ordered` record whose `id` is NOT in any `received`/`will_call` record's `related_order_id`
- Items return to Today's Order automatically if a short is received (current_count stays below par)

### Short shipment flow
1. Receive Order → enter quantities less than ordered → shorts detected
2. Acknowledge shorts screen (must check each item)
3. On save: receipt record saved (`resolved: true`) + short record saved (`resolved: false`)
4. Dashboard shows red banner per unresolved short; "Resolved ✓" PATCHes `resolved: true`

### Supabase TypeScript casts
Use `(data as unknown) as MyType[]` when direct cast fails — the generated types don't always match query shapes.

### Vercel deploys
Auto-deploys on push to `main`. If pushes stop deploying, go to Vercel dashboard → Deployments → Redeploy. **Do not run `npx vercel deploy --prod`** — it creates a new project without env vars.

### PWA
- `public/manifest.json`: name "Brea's Inventory – Rita's Italian Ice", theme `#1a7a3c`, standalone portrait
- `public/sw.js`: network-first; API calls always bypass cache
- `src/components/ServiceWorkerRegistration.tsx`: registers SW on mount
- Icons: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`

---

## Open Items / Known Gaps
- No push notifications for short shipments (dashboard banner only)
- Clover POS integration was discussed but not pursued
- `distributor` values in active use: `bunzl`, `balford`, `other`, `seasonal`, `discontinued`
