-- Distinguish admin-created Pulse waves from the auto-managed session used for personal invite links.

ALTER TABLE pulse_sessions
  ADD COLUMN IF NOT EXISTS session_purpose TEXT NOT NULL DEFAULT 'standard';

-- At most one link-invite template session per org per audience (staff vs manager).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_sessions_one_link_invite_row
  ON pulse_sessions (organization_id, audience)
  WHERE session_purpose = 'link_invite';
