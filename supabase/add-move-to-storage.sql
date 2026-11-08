-- Patch 39 Part B: adds 'move_to_storage' (store -> storage) alongside the
-- existing 'move_to_store' (storage -> store), 'add', 'receive_to_storage',
-- and 'correction' kinds on storage_moves.
--
-- Idempotent: drops the existing CHECK constraint if present (Postgres's
-- default auto-generated name for an unnamed column CHECK is
-- <table>_<column>_check, i.e. storage_moves_kind_check -- which is what
-- add-storage-stock.sql's original inline CHECK (kind IN (...)) produced),
-- then re-adds it with the new kind included. Safe to re-run.
ALTER TABLE storage_moves DROP CONSTRAINT IF EXISTS storage_moves_kind_check;
ALTER TABLE storage_moves ADD CONSTRAINT storage_moves_kind_check
  CHECK (kind IN ('add', 'move_to_store', 'receive_to_storage', 'correction', 'move_to_storage'));
