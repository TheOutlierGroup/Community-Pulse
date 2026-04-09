-- One-time short-lived cross-domain auth handoff tokens.

CREATE TABLE IF NOT EXISTS pulse_handoff_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  audience TEXT NOT NULL DEFAULT 'pulse',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pulse_handoff_tokens_expires
  ON pulse_handoff_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_pulse_handoff_tokens_user_org
  ON pulse_handoff_tokens(user_id, organization_id);
