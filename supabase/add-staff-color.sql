-- Adds an optional color to staff, for coloring their name wherever it
-- appears in the app (task completions, "Added by", notes authorship, etc).
-- Nullable — unset staff just render in the normal default text color.
-- Run in the Supabase SQL Editor before deploying the code that uses it.

alter table staff add column color text;
