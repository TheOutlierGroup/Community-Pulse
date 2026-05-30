-- Phase 1d: Leads, Estimation, and Lead Activity
--
-- A Lead captures a sales opportunity. It belongs to:
--   - one Account (the client company)
--   - one Contact (the primary person at that company)
--   - one Business Unit (the team responsible for converting it)
--   - one pipeline_stage (its current position in that BU's funnel)
--
-- When a lead is won it is locked (locked_at is set) and a Project is created
-- from it (handled in Phase 3). The lead record is never deleted; it becomes
-- a permanent historical record.
--
-- `lead_estimates` stores line-item cost/hour estimates attached to the lead
-- before conversion. The total is copied to the project as its Baseline budget.
--
-- `lead_routing_rules` define how inbound leads are auto-assigned to BUs based
-- on metadata fields (e.g., product_type = "advisory" → BU-A). Rules are
-- evaluated in ascending priority order; first match wins.
--
-- `lead_activity` is an append-only log of every state change on a lead record.

-- ── Leads ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id UUID        NOT NULL REFERENCES business_units(id) ON DELETE RESTRICT,
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  contact_id       UUID        NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  pipeline_stage_id UUID       NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,

  title            TEXT        NOT NULL,
  description      TEXT,
  source           TEXT,                      -- e.g. "web_form", "referral", "manual"
  source_metadata  JSONB       NOT NULL DEFAULT '{}',  -- raw inbound payload

  assigned_to      UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- Lifecycle timestamps
  locked_at        TIMESTAMPTZ,               -- set on Mark as Won; blocks further edits
  won_at           TIMESTAMPTZ,
  lost_at          TIMESTAMPTZ,
  lost_reason      TEXT,
  expected_close_date DATE,

  custom_fields    JSONB       NOT NULL DEFAULT '{}',
  created_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT leads_terminal_state
    CHECK (
      (won_at IS NULL AND lost_at IS NULL) OR
      (won_at IS NOT NULL AND lost_at IS NULL) OR
      (won_at IS NULL AND lost_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_leads_org
  ON leads (organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_bu
  ON leads (business_unit_id);
CREATE INDEX IF NOT EXISTS idx_leads_account
  ON leads (account_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned
  ON leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_stage
  ON leads (pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_locked
  ON leads (locked_at) WHERE locked_at IS NOT NULL;

-- ── Lead Estimates (line items) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_estimates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  description TEXT        NOT NULL,
  hours       NUMERIC(10,2),
  unit_cost   NUMERIC(12,2),
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  position    INTEGER     NOT NULL DEFAULT 0,  -- display order
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_estimates_lead
  ON lead_estimates (lead_id, position);

-- ── Lead Routing Rules ────────────────────────────────────────────────────────
-- Evaluates source_metadata fields from inbound leads to route them to a BU.
-- field_path: dot-notation key into source_metadata (e.g. "product_type")
-- field_value: value that must match (exact string)
-- priority: lower number = evaluated first

CREATE TABLE IF NOT EXISTS lead_routing_rules (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id UUID    NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  field_path       TEXT    NOT NULL,
  field_value      TEXT    NOT NULL,
  priority         INTEGER NOT NULL DEFAULT 100,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID    REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_routing_rules_org
  ON lead_routing_rules (organization_id, priority)
  WHERE is_active = TRUE;

-- ── Lead Activity Log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_activity (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  event_type  TEXT        NOT NULL,    -- e.g. stage_changed, assigned, won, lost, note_added
  payload     JSONB       NOT NULL DEFAULT '{}',  -- before/after values
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead
  ON lead_activity (lead_id, created_at DESC);
