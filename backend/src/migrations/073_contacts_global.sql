-- Decouple contacts from being purely a child of a Prospect. A contact can
-- now be linked to a Prospect, a Client, both (e.g. after promotion), or
-- neither (a standalone contact — someone who left their org but is still
-- a warm lead, or a referral who can introduce us to an org we haven't
-- engaged yet). Renamed organisation_id -> crm_organisation_id now that a
-- second org link exists, and switched the FK from CASCADE to SET NULL so
-- contacts survive their linked Prospect being deleted, per the new global
-- Contacts page (platform sidebar) that lists every contact regardless of
-- link state.

ALTER TABLE crm_contacts RENAME COLUMN organisation_id TO crm_organisation_id;
ALTER TABLE crm_contacts ALTER COLUMN crm_organisation_id DROP NOT NULL;
ALTER TABLE crm_contacts DROP CONSTRAINT crm_contacts_organisation_id_fkey;
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_crm_organisation_id_fkey
  FOREIGN KEY (crm_organisation_id) REFERENCES crm_organisations(organisation_id) ON DELETE SET NULL;

ALTER TABLE crm_contacts ADD COLUMN client_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE crm_contacts ADD COLUMN platform_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE crm_contacts ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_crm_contacts_client_org ON crm_contacts(client_organization_id);
CREATE INDEX idx_crm_contacts_platform_org ON crm_contacts(platform_org_id);

-- Backfill platform_org_id for existing contacts from their linked prospect
-- (every existing row has crm_organisation_id set, since it was NOT NULL
-- until this migration).
UPDATE crm_contacts c
   SET platform_org_id = o.platform_org_id
  FROM crm_organisations o
 WHERE c.crm_organisation_id = o.organisation_id
   AND c.platform_org_id IS NULL;

ALTER TABLE crm_contacts ALTER COLUMN platform_org_id SET NOT NULL;
