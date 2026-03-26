-- Pulse link-only participants (no app user). Token is set on first send / each resend.

CREATE TABLE IF NOT EXISTS pulse_link_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  last_invited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email is stored lowercased by the application.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_link_invites_org_email
  ON pulse_link_invites (organization_id, email);

CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_org ON pulse_link_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_token_hash ON pulse_link_invites(token_hash)
  WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS pulse_link_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES pulse_link_invites(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES pulse_sessions(id) ON DELETE CASCADE,
  current_step INT NOT NULL DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 5),
  step1_data JSONB NOT NULL DEFAULT '{}',
  step2_data JSONB NOT NULL DEFAULT '{}',
  step3_data JSONB NOT NULL DEFAULT '{}',
  step4_data JSONB NOT NULL DEFAULT '{}',
  contribution_style TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invite_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_pulse_link_responses_session ON pulse_link_responses(session_id);
