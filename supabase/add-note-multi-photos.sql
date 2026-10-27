-- Expands patch 22's single photo_url column into a note_photos table,
-- supporting up to 3 photos per note (the 3-photo cap is enforced
-- client-side; sort_order just preserves upload order, no reordering).
-- Still uses the same note-photos storage bucket from patch 22. Run in the
-- Supabase SQL Editor.

create table note_photos (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  photo_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index on note_photos (note_id, sort_order);

-- Migrate any existing single-photo notes into the new table before
-- dropping the old column.
insert into note_photos (note_id, photo_url, sort_order)
select id, photo_url, 0 from notes where photo_url is not null;

alter table notes drop column photo_url;
