-- SEC-03: licensee API keys for programmatic access. Keys are stored
-- as bcrypt hashes; the plaintext is shown to the user exactly once at
-- mint time and never retrievable. Each key carries a `name` (for the
-- admin to recognise it) and a `prefix` (the first 8 chars of the
-- plaintext, stored unhashed so the UI can render "rk_AbC… (created
-- 5d ago)" without exposing the full secret).

CREATE TABLE IF NOT EXISTS licensee_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hashed_key TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT licensee_api_keys_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT licensee_api_keys_prefix_format CHECK (length(prefix) BETWEEN 4 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_licensee_api_keys_org_active
  ON licensee_api_keys (organization_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_licensee_api_keys_prefix
  ON licensee_api_keys (prefix);
