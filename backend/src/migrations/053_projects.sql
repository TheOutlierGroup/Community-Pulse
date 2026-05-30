-- Phase 3a: Projects
--
-- A Project is born from a converted Lead via the "Mark as Won" transition.
-- It retains a permanent historical link back to the originating lead and
-- stores the baseline budget (copied from the lead's estimate line items at
-- conversion time) alongside real-time actual totals computed from time logs.
--
-- Projects are scoped to both an organization and a business unit so
-- row-level access rules from the BU model apply here too.

CREATE TABLE IF NOT EXISTS projects (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id UUID        NOT NULL REFERENCES business_units(id) ON DELETE RESTRICT,
  lead_id          UUID        REFERENCES leads(id) ON DELETE SET NULL,
  account_id       UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES contacts(id) ON DELETE SET NULL,

  name             TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'planning'
                               CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'archived')),

  -- Baseline is frozen at conversion from the lead's estimate sum.
  -- Never recalculated — it is the immutable contract figure.
  baseline_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
  baseline_cost    NUMERIC(14,2) NOT NULL DEFAULT 0,

  start_date       DATE,
  due_date         DATE,
  completed_at     TIMESTAMPTZ,

  created_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects (organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_bu
  ON projects (business_unit_id);
CREATE INDEX IF NOT EXISTS idx_projects_lead
  ON projects (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects (organization_id, status);

-- ── Project activity log ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_activity (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_activity_project
  ON project_activity (project_id, created_at DESC);
