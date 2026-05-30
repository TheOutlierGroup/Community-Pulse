-- Phase 1c: Lead Pipeline Stages
--
-- Each BU defines its own ordered set of pipeline stages. This lets BU-A run a
-- 4-step funnel while BU-B runs a 6-step funnel independently.
--
-- `pipeline_stages` are configured per BU by a bu_manager or org admin.
-- Leads (added in the next phase) reference a stage from their own BU's set.

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id UUID        NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,           -- e.g. "Discovery", "Proposal Sent"
  position         INTEGER     NOT NULL,           -- 1-based ordering within the BU
  is_won           BOOLEAN     NOT NULL DEFAULT FALSE,  -- marks the terminal "Won" stage
  is_lost          BOOLEAN     NOT NULL DEFAULT FALSE,  -- marks the terminal "Lost" stage
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_unit_id, position),
  UNIQUE (business_unit_id, name),
  -- Only one stage per BU may be the won/lost terminal stage
  CONSTRAINT pipeline_stages_won_uniqueness
    CHECK (NOT (is_won AND is_lost))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_bu
  ON pipeline_stages (business_unit_id, position);
