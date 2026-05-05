-- INF-08: platform-wide status incidents shown on the public status page
-- and as an in-app banner. Severity drives banner colour. resolved_at IS
-- NULL means "currently active" — that's the index the public feed and
-- the banner check both query.

CREATE TABLE IF NOT EXISTS platform_status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'maintenance',
  components TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_status_incidents_severity_check
    CHECK (severity IN ('maintenance', 'minor', 'major', 'critical')),
  CONSTRAINT platform_status_incidents_title_nonempty
    CHECK (length(trim(title)) > 0),
  CONSTRAINT platform_status_incidents_body_nonempty
    CHECK (length(trim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_platform_status_incidents_active
  ON platform_status_incidents (started_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_status_incidents_history
  ON platform_status_incidents (started_at DESC);
