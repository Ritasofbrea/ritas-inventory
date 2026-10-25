-- Lets Supabase Realtime push INSERT events on `note_replies` to connected
-- browsers (NotesBoard subscribes via postgres_changes), same as `notes`
-- itself. Run in the Supabase SQL Editor after add-note-replies.sql.
-- RLS is not enabled on `note_replies`, so no SELECT policy is needed for
-- the anon client to receive these change events.

alter publication supabase_realtime add table note_replies;
