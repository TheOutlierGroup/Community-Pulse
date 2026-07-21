-- Contact enrichment + import provenance. Contacts can now be created/updated
-- from CSV imports (MeetAlfred/LinkedIn and Firmable) in addition to manual
-- entry. We track:
--   linkedin_url        normalised match key for upsert (primary join key)
--   source              how the record first came to exist
--   enrichment          namespaced imported fields ({ linkedin: {...}, firmable: {...} })
--   enrichment_sources  which systems have enriched it (drives the badge)
--   protected_fields    core columns a human set by hand — imports never overwrite these
--   last_enriched_at    when an import last touched it
ALTER TABLE crm_contacts ADD COLUMN linkedin_url TEXT;
ALTER TABLE crm_contacts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'linkedin', 'firmable'));
ALTER TABLE crm_contacts ADD COLUMN enrichment JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_contacts ADD COLUMN enrichment_sources TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE crm_contacts ADD COLUMN protected_fields TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE crm_contacts ADD COLUMN last_enriched_at TIMESTAMPTZ;

-- Match key lookups are always workspace-scoped.
CREATE INDEX idx_crm_contacts_linkedin_url ON crm_contacts(platform_org_id, linkedin_url);

-- Every existing contact was entered by hand, so protect the core fields it
-- already has — a later CSV import must not clobber manual data (there is no
-- cleaning step between imports). Only non-empty fields are protected.
UPDATE crm_contacts SET protected_fields = (
  (CASE WHEN contact_firstname   IS NOT NULL AND contact_firstname   <> '' THEN ARRAY['contact_firstname']   ELSE ARRAY[]::text[] END)
  || (CASE WHEN contact_lastname IS NOT NULL AND contact_lastname    <> '' THEN ARRAY['contact_lastname']    ELSE ARRAY[]::text[] END)
  || (CASE WHEN contact_email    IS NOT NULL AND contact_email       <> '' THEN ARRAY['contact_email']       ELSE ARRAY[]::text[] END)
  || (CASE WHEN contact_phone    IS NOT NULL AND contact_phone       <> '' THEN ARRAY['contact_phone']       ELSE ARRAY[]::text[] END)
  || (CASE WHEN contact_role     IS NOT NULL AND contact_role        <> '' THEN ARRAY['contact_role']        ELSE ARRAY[]::text[] END)
  || ARRAY['relationship_status']
);
