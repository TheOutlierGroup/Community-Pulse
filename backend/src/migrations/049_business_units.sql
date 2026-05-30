-- Phase 1a: Business Units
--
-- A Business Unit (BU) is a distinct operating division within an organization.
-- BUs are scoped to a single parent organization (typically a licensee or platform
-- org) and are used to isolate leads, pipelines, and delivery projects.
--
-- Users are assigned to one or more BUs via `business_unit_members`. A BU member
-- can carry an explicit BU-level role that narrows their permissions within that
-- unit without changing their org-level role.

CREATE TABLE IF NOT EXISTS business_units (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  code          TEXT,                        -- short identifier, e.g. "BU-A"
  description   TEXT,
  settings      JSONB       NOT NULL DEFAULT '{}',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_business_units_org
  ON business_units (organization_id);
CREATE INDEX IF NOT EXISTS idx_business_units_active
  ON business_units (organization_id, is_active);

-- Junction table: which users belong to which BUs and in what capacity.
-- bu_role narrows permissions within the BU:
--   bu_manager  – can configure the BU pipeline, assign leads, view all BU data
--   sales_rep   – can own and progress leads assigned to this BU
--   delivery    – can manage projects / tasks once a lead converts
--   viewer      – read-only access to BU data
CREATE TABLE IF NOT EXISTS business_unit_members (
  business_unit_id UUID   NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  user_id          UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bu_role          TEXT   NOT NULL DEFAULT 'viewer'
                          CHECK (bu_role IN ('bu_manager', 'sales_rep', 'delivery', 'viewer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_unit_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bu_members_user
  ON business_unit_members (user_id);
CREATE INDEX IF NOT EXISTS idx_bu_members_bu
  ON business_unit_members (business_unit_id);
