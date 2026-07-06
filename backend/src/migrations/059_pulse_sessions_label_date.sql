-- Cosmetic display-date override for Pre/Post checkpoints. Pre/Post are
-- singleton sessions whose created_at reflects when the org record was
-- bootstrapped, not the real engagement start/end date, so admins can set
-- an explicit label instead. Stored as TEXT (not DATE) to avoid timezone
-- round-tripping since this is a display label only, never used for
-- filtering/cutoffs.
ALTER TABLE pulse_sessions
  ADD COLUMN IF NOT EXISTS label_date TEXT;

ALTER TABLE pulse_sessions
  DROP CONSTRAINT IF EXISTS pulse_sessions_label_date_format;

ALTER TABLE pulse_sessions
  ADD CONSTRAINT pulse_sessions_label_date_format
  CHECK (label_date IS NULL OR label_date ~ '^\d{4}-\d{2}-\d{2}$');
