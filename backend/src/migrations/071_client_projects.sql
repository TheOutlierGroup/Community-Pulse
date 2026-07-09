-- Per-client "Projects" overview: one project record per client
-- organization, with a milestone timeline, a manual progress percentage,
-- and an uploaded-file repository. Separate from the unrelated,
-- workspace-scoped Project/Lead tables added earlier (backend/src/models/
-- Project.js) — those track Outlier's own sales-to-delivery pipeline and
-- are not wired into any client-facing page.

CREATE TABLE IF NOT EXISTS client_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  summary         TEXT,
  progress_pct    INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_project_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  target_date  DATE,
  status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'complete')),
  notes        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_project_milestones_project ON client_project_milestones(project_id);

CREATE TABLE IF NOT EXISTS client_project_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  content_type  TEXT,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_project_files_project ON client_project_files(project_id);
