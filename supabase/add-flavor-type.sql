-- Adds a "type" column to flavors (italian_ice / cream_ice / sugar_free)
-- so the planner can show what kind each flavor is and help confirm a
-- sugar-free and cream ice are covered each week.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

alter table flavors add column type text not null default 'italian_ice'
  check (type in ('italian_ice', 'cream_ice', 'sugar_free'));
