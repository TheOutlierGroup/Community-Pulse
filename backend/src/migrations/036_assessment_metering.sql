-- INF-04 + INF-05 wiring.
--
-- INF-05: per-session respondent cap override. NULL means "fall back to
-- licence_config.respondent_cap_per_assessment" (and ultimately "no cap"
-- when both are NULL, e.g. enterprise_unlimited tier or platform clients
-- with no licensee parent).
ALTER TABLE pulse_sessions
  ADD COLUMN IF NOT EXISTS respondent_cap_override INTEGER;

ALTER TABLE pulse_sessions
  DROP CONSTRAINT IF EXISTS pulse_sessions_respondent_cap_override_positive;

ALTER TABLE pulse_sessions
  ADD CONSTRAINT pulse_sessions_respondent_cap_override_positive
  CHECK (respondent_cap_override IS NULL OR respondent_cap_override >= 0);

-- INF-04: audit trail for assessment consumption events. Each row is a
-- single "assessment opened" event charged against a licensee's quota.
-- Stored separately from the licence_config counter so platform admins
-- can audit/refund and so we can correlate consumption with the
-- pulse_session it was opened for. The licence_config.assessments_consumed
-- counter is still authoritative for fast cap checks; this table is the
-- ledger.
CREATE TABLE IF NOT EXISTS assessment_consumption_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  licensee_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pulse_session_id UUID REFERENCES pulse_sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  assessments_charged INTEGER NOT NULL DEFAULT 1,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assessment_consumption_events_charged_positive
    CHECK (assessments_charged >= 0),
  CONSTRAINT assessment_consumption_events_source_check
    CHECK (source IN (
      'platform_during_checkpoint',
      'client_admin_session',
      'platform_session_create',
      'manual_override',
      'manual_refund'
    ))
);

CREATE INDEX IF NOT EXISTS idx_assessment_consumption_events_licensee
  ON assessment_consumption_events (licensee_organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_consumption_events_client
  ON assessment_consumption_events (client_organization_id, created_at DESC);
