-- Lets Supabase Realtime push INSERT/DELETE events on `notes` to connected
-- browsers (NotesBoard subscribes via postgres_changes) instead of the app
-- having to poll. Run in the Supabase SQL Editor after add-notes.sql.
-- RLS is not enabled on `notes`, so no SELECT policy is needed for the
-- anon client to receive these change events.

alter publication supabase_realtime add table notes;
