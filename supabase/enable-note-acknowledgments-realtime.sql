-- Lets Supabase Realtime push INSERT events on `note_acknowledgments` to
-- connected browsers (NotesBoard subscribes via postgres_changes), same as
-- `notes` and `note_replies`. Run in the Supabase SQL Editor after
-- add-note-acknowledgments.sql.
-- RLS is not enabled on `note_acknowledgments`, so no SELECT policy is
-- needed for the anon client to receive these change events.

alter publication supabase_realtime add table note_acknowledgments;
