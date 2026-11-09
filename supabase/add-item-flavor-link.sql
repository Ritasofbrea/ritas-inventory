-- Patch 45 Phase 1 -- links an Ice Mix item to ONE flavor, so its program
-- tag (Everyday/Seasonal/LTO/...) can be shown on Manage Items, Current
-- Stock, Order List, and Count. Nullable -- an unlinked item shows nothing
-- and behaves exactly as today (no stock math, par, or Order List content
-- is touched by this column at all). Several items may point at the same
-- flavor; no uniqueness is enforced on this column. The badge is meant to
-- be read LIVE at display time (a join), never copied/snapshotted --
-- changing a flavor's program tag in the catalog updates every screen
-- showing it immediately, including a flavor that's currently linked to
-- more than one item.
--
-- NOT RUN. Review and run in the Supabase SQL Editor, then tell Claude to
-- proceed to Phase 2.

alter table items add column if not exists flavor_id uuid references public.flavors(id) on delete set null;

create index if not exists idx_items_flavor_id on items(flavor_id);
