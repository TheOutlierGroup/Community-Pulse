-- Privacy and compliance controls: lifecycle, audit, retention, DSAR, MFA, and archive metadata.

-- 1) Extend pulse session lifecycle with paused state.
ALTER TABLE pulse_sessions
  DROP CONSTRAINT IF EXISTS pulse_sessions_status_check;

ALTER TABLE pulse_sessions
  ADD CONSTRAINT pulse_sessions_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'closed'));

-- 2) Track lifecycle transitions.
CREATE TABLE IF NOT EXISTS pulse_session_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES pulse_sessions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pulse_session_status_events_session
  ON pulse_session_status_events (session_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_session_status_events_org
  ON pulse_session_status_events (organization_id, changed_at DESC);

-- 3) Retention job heartbeat/state.
CREATE TABLE IF NOT EXISTS retention_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  records_scanned INT NOT NULL DEFAULT 0,
  records_anonymized INT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_retention_job_runs_job_started
  ON retention_job_runs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_job_runs_job_status
  ON retention_job_runs (job_name, status, started_at DESC);

-- 4) Immutable audit event stream.
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  actor_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  result TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target_org
  ON audit_events (target_organization_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_no_update ON audit_events;
CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();

DROP TRIGGER IF EXISTS trg_audit_events_no_delete ON audit_events;
CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();

-- 5) Admin-initiated permanent deletion requests.
CREATE TABLE IF NOT EXISTS privacy_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'blocked', 'completed', 'failed')),
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_privacy_deletion_requests_org_created
  ON privacy_deletion_requests (organization_id, created_at DESC);

-- 6) DSAR / APP12/13 request tracking.
CREATE TABLE IF NOT EXISTS privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'deletion')),
  subject_email TEXT NOT NULL,
  subject_name TEXT,
  request_details TEXT,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (
    status IN ('received', 'in_review', 'fulfilled', 'denied', 'cancelled')
  ),
  due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  fulfilled_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_org_status
  ON privacy_requests (organization_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_due_at
  ON privacy_requests (due_at, status);

-- 7) Dashboard purpose-bound login token flow.
CREATE TABLE IF NOT EXISTS client_dashboard_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_session_id UUID REFERENCES pulse_sessions(id) ON DELETE SET NULL,
  contact_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_dashboard_login_tokens_org_email
  ON client_dashboard_login_tokens (organization_id, contact_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_dashboard_login_tokens_expires
  ON client_dashboard_login_tokens (expires_at);

-- 8) User MFA metadata.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_mfa_verified_at TIMESTAMPTZ;

-- 9) Org archive/disposal metadata.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier3_archive_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier3_disposal_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_residency_policy TEXT;

-- 10) Residency + consent metadata for invite/respondent records.
ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS respondent_country_code TEXT,
  ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT;

ALTER TABLE pulse_link_responses
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ;
