-- Per-prospect "Opportunity" overview: mirrors client_projects
-- conceptually (progress + file repository), plus a sales-timeline
-- checkpoint table mapping expected value and financial gain across the
-- four pipeline stages (New, Qualified, Meeting, Proposal). current_stage
-- marks where the opportunity actually sits on that timeline right now.
-- Captured into the prospect snapshot (services/prospectSnapshot.js) at
-- promotion time so the figures merge into the exported CSV.

CREATE TABLE IF NOT EXISTS crm_opportunities (
  opportunity_id   SERIAL PRIMARY KEY,
  organisation_id  INTEGER NOT NULL UNIQUE REFERENCES crm_organisations(organisation_id) ON DELETE CASCADE,
  current_stage    TEXT NOT NULL DEFAULT 'New' CHECK (current_stage IN ('New', 'Qualified', 'Meeting', 'Proposal')),
  progress_pct     INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  summary          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_opportunity_checkpoints (
  checkpoint_id    SERIAL PRIMARY KEY,
  opportunity_id   INTEGER NOT NULL REFERENCES crm_opportunities(opportunity_id) ON DELETE CASCADE,
  stage            TEXT NOT NULL CHECK (stage IN ('New', 'Qualified', 'Meeting', 'Proposal')),
  expected_value   NUMERIC,
  financial_gain   NUMERIC,
  target_date      DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_crm_opportunity_checkpoints_opportunity ON crm_opportunity_checkpoints(opportunity_id);

CREATE TABLE IF NOT EXISTS crm_opportunity_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  INTEGER NOT NULL REFERENCES crm_opportunities(opportunity_id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  content_type    TEXT,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_opportunity_files_opportunity ON crm_opportunity_files(opportunity_id);
