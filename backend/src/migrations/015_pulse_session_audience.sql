-- Separate active staff vs manager survey waves; link invites target one or the other.

ALTER TABLE pulse_sessions
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'staff'
  CHECK (audience IN ('staff', 'manager'));

ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS survey_role TEXT NOT NULL DEFAULT 'staff'
  CHECK (survey_role IN ('staff', 'manager'));

-- At most one active session per org per audience.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_sessions_one_active_staff
  ON pulse_sessions (organization_id)
  WHERE status = 'active' AND audience = 'staff';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_sessions_one_active_manager
  ON pulse_sessions (organization_id)
  WHERE status = 'active' AND audience = 'manager';
