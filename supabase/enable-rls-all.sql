-- Patch 29 C2: enables Row Level Security, with NO policies, on every public
-- table that doesn't already have it. The app never uses the anon key for
-- table access (src/lib/supabase.ts's getServerSupabase() always prefers
-- SUPABASE_SERVICE_ROLE_KEY, which is set in Vercel for every environment),
-- so the app is completely unaffected by this -- the service role bypasses
-- RLS regardless. This only removes what the PUBLIC anon key (embedded in
-- every client bundle) can do directly against Supabase's REST API,
-- bypassing the app's routes, sessions, and rate limiting entirely.
--
-- Verified directly with ONLY the anon key before writing this file: it can
-- currently read owners, shift_leads, staff, checklists, flavors,
-- flavor_weeks, flavor_week_slots, notes, note_replies, note_acknowledgments,
-- note_photos, task_templates, task_template_steps, and task_instances in
-- full. Since RLS has no column-level granularity, the same exposure
-- applies to EVERY column on an exposed table -- including owners.pin and
-- shift_leads.pin, which were never directly requested in this testing (per
-- instruction), but are not protected from this path either.
--
-- NOT run. Run the WHOLE file in the Supabase SQL Editor when ready; it's
-- all idempotent (ENABLE ROW LEVEL SECURITY is a no-op if already enabled).
-- login_attempts already has RLS enabled (see add-login-attempts.sql) and
-- is deliberately left out below.

alter table public.checklists enable row level security;
alter table public.clover_item_mappings enable row level security;
alter table public.clover_items enable row level security;
alter table public.count_draft enable row level security;
alter table public.flavor_week_slots enable row level security;
alter table public.flavor_weeks enable row level security;
alter table public.flavors enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.items enable row level security;
alter table public.note_acknowledgments enable row level security;
alter table public.note_photos enable row level security;
alter table public.note_replies enable row level security;
alter table public.notes enable row level security;
alter table public.order_history enable row level security;
alter table public.order_history_items enable row level security;
alter table public.owners enable row level security;
alter table public.pins enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.shift_leads enable row level security;
alter table public.staff enable row level security;
alter table public.task_instance_step_checks enable row level security;
alter table public.task_instances enable row level security;
alter table public.task_template_steps enable row level security;
alter table public.task_templates enable row level security;
