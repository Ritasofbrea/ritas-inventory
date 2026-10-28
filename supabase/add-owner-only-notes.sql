-- Private "Owners Only" notes (patch 21). Run in the Supabase SQL Editor.
alter table notes add column owner_only boolean not null default false;
