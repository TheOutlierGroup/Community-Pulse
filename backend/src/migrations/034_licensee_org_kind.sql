-- Introduce the `licensee` organization kind, which sub-licenses the platform
-- to a third party. Licensees act like a restricted platform org over their own
-- downstream client orgs (linked via parent_organization_id).

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_kind_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_kind_check
  CHECK (kind IN ('platform', 'client', 'licensee'));

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id UUID
    REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_parent
  ON organizations (parent_organization_id);

-- A parent must be a platform or licensee org; clients/licensees can have a parent.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_parent_self_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_parent_self_check
  CHECK (parent_organization_id IS NULL OR parent_organization_id <> id);

-- Allow `client_status` to apply to licensee rows the same way it applies to clients.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_client_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_client_status_check
  CHECK (
    (
      kind IN ('client', 'licensee')
      AND client_status IN (
        'client-current',
        'client-previous',
        'prospect-warm',
        'prospect-cold',
        'prospect-lost',
        'prospect-new',
        'prospect-active-campaign',
        'do-not-call-contact-blocked'
      )
    )
    OR
    (
      kind = 'platform'
      AND client_status = 'active'
    )
  );
