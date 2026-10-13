-- Splits the single generic Owner PIN into named owner PINs (Josh, Gina),
-- each with equal full owner access, with login remembering which owner
-- matched so their name can auto-fill "Added by" and similar fields.
-- Run in the Supabase SQL Editor before deploying the code that uses it.
--
-- IMPORTANT: replace the two placeholder PIN values below with the actual
-- PINs you want Josh and Gina to use before running this.

create table owners (
  name text primary key,
  pin text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into owners (name, pin) values
  ('Josh', '0418'),
  ('Gina', '0507');

-- The old generic 'owner' row in the pins table is superseded by the above.
-- shift_lead stays as-is, untouched.
delete from pins where name = 'owner';
