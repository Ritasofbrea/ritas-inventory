-- Optional photo attachments on notes (patch 22). Run in the Supabase SQL Editor.
alter table notes add column photo_url text;

-- Public bucket for note photos (uploads go through server-issued signed
-- upload URLs, same pattern as task-photos) — kept separate from
-- task-photos so a future cleanup cron (mirroring patch 8's sweep, not
-- built yet) can target just one bucket or the other.
insert into storage.buckets (id, name, public)
values ('note-photos', 'note-photos', true)
on conflict (id) do nothing;
