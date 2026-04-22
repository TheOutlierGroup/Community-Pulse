ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE organizations
SET slug = CASE
  WHEN slug IS NOT NULL AND btrim(slug) <> '' THEN slug
  ELSE regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')
END;

UPDATE organizations
SET slug = regexp_replace(slug, '(^-+|-+$)', '', 'g')
WHERE slug IS NOT NULL;

UPDATE organizations
SET slug = CONCAT('org-', left(id::text, 8))
WHERE slug IS NULL OR slug = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_slug_not_blank'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_slug_not_blank CHECK (btrim(slug) <> '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique
  ON organizations (lower(slug));

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hierarchy_levels VARCHAR(500);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS report_contact VARCHAR(200);

CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  generated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('pre', 'mid', 'post')),
  date_from TIMESTAMPTZ,
  date_to TIMESTAMPTZ,
  format TEXT NOT NULL CHECK (format IN ('docx', 'pdf')),
  file_path VARCHAR NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  failure_reason TEXT,
  meta JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_generated_reports_org_generated_at
  ON generated_reports (organization_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_org_stage_generated_at
  ON generated_reports (organization_id, stage, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_expires_at
  ON generated_reports (expires_at);
