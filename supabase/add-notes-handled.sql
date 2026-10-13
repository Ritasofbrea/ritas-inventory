-- Adds a simple "handled" toggle to notes, strikes through the text when on.
-- No attribution tracking, just a plain boolean. Run in the Supabase SQL
-- Editor before deploying the code that uses it.

alter table notes add column handled boolean not null default false;
