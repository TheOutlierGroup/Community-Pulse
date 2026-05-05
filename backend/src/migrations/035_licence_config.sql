-- Per-organization licence metadata used to scope what a licensee can do
-- (tier, caps, contract window) and to support automated lifecycle actions
-- (renewal reminders, suspension on expiry). One row per organization;
-- presently only `licensee` orgs get a row, but the schema is general so
-- platform-managed `client` orgs could also be metered later.

CREATE TABLE IF NOT EXISTS licence_config (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  licence_tier TEXT NOT NULL DEFAULT 'practitioner',
  status TEXT NOT NULL DEFAULT 'active',
  contract_start TIMESTAMPTZ,
  contract_end TIMESTAMPTZ,
  assessments_included INTEGER NOT NULL DEFAULT 0,
  assessments_consumed INTEGER NOT NULL DEFAULT 0,
  respondent_cap_per_assessment INTEGER,
  admin_user_limit INTEGER NOT NULL DEFAULT 5,
  benchmark_access BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_fee_paid BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT licence_config_status_check
    CHECK (status IN ('active', 'suspended', 'expired')),
  CONSTRAINT licence_config_tier_check
    CHECK (licence_tier IN (
      'practitioner',
      'enterprise_mid',
      'enterprise_large',
      'enterprise_unlimited'
    )),
  CONSTRAINT licence_config_assessments_nonneg
    CHECK (assessments_included >= 0 AND assessments_consumed >= 0),
  CONSTRAINT licence_config_admin_limit_positive
    CHECK (admin_user_limit >= 1)
);

CREATE INDEX IF NOT EXISTS idx_licence_config_status
  ON licence_config (status);
CREATE INDEX IF NOT EXISTS idx_licence_config_contract_end
  ON licence_config (contract_end);

-- Backfill: any existing licensee orgs get a default-active row so the
-- enforcement code can assume the row exists.
INSERT INTO licence_config (organization_id)
SELECT o.id FROM organizations o
WHERE o.kind = 'licensee'
  AND NOT EXISTS (
    SELECT 1 FROM licence_config lc WHERE lc.organization_id = o.id
  );
