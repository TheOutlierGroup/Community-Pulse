ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS client_status TEXT NOT NULL DEFAULT 'lead';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_client_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_client_status_check
  CHECK (client_status IN ('lead', 'active', 'inactive', 'closed'));

UPDATE organizations
SET client_status = 'active'
WHERE kind = 'client' AND client_status = 'lead';
