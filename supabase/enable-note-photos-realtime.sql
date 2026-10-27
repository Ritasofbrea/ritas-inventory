-- Lets Supabase Realtime push INSERT events on `note_photos` to connected
-- browsers (NotesBoard subscribes via postgres_changes), same as
-- `note_replies`/`note_acknowledgments`. Run in the Supabase SQL Editor
-- after add-note-multi-photos.sql.
-- RLS is not enabled on `note_photos`, so no SELECT policy is needed for
-- the anon client to receive these change events.

alter publication supabase_realtime add table note_photos;
