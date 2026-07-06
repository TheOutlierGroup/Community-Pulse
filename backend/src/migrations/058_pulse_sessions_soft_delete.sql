-- Allow platform admins to soft-delete During checkpoints from Rhythm Engine
-- settings without losing the underlying session/response data.
ALTER TABLE pulse_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pulse_sessions_org_deleted
  ON pulse_sessions (organization_id, deleted_at);
