-- Shared, cross-device in-progress count draft. Single row ('current') —
-- there's only ever one count in progress across the store at a time, so a
-- handoff between devices (e.g. Val -> Riley) just reads/writes this row
-- instead of localStorage, which is per-device.
--
-- updated_at is bumped on every save (including keystroke-level autosaves),
-- so the 4hr expiry clock resets on any activity and won't lapse mid-shift.

CREATE TABLE IF NOT EXISTS count_draft (
  id TEXT PRIMARY KEY DEFAULT 'current',
  counts JSONB NOT NULL DEFAULT '{}',
  secondary_counts JSONB NOT NULL DEFAULT '{}',
  counted_by TEXT NOT NULL DEFAULT '',
  is_test_count BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
