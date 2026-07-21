-- Segments: named, saved filters over the contacts list. A segment lives in
-- the workspace (platform_org_id) and is either 'personal' (visible only to
-- its owner) or 'shared' (visible to everyone in the workspace, created by an
-- admin). The `definition` JSONB holds the filter predicates — validated
-- app-side, kept schema-flexible while the predicate set is still settling
-- (same pattern as crm_organisations.custom_fields). NB: this table is renamed
-- to crm_custom_filters in migration 076; the model now lives in
-- backend/src/models/CrmCustomFilter.js.
-- `business_unit` is an optional tag; when set, it scopes visibility to users
-- who can already see that BU (enforced app-side, not by the DB).
CREATE TABLE crm_segments (
  segment_id      SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  definition      JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope           TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'shared')),
  business_unit   TEXT,
  owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  platform_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_segments_platform_org ON crm_segments(platform_org_id);
CREATE INDEX idx_crm_segments_owner ON crm_segments(owner_user_id);

-- Retire the 'active-campaign' relationship status. "Active campaign" state now
-- belongs to the forthcoming Campaigns feature (a contact's membership in a
-- live campaign), not to the Warm/Cold/Lost/New relationship vocabulary — and
-- active client engagements are already covered by the Clients layer. Backfill
-- any existing rows to 'new' before tightening each CHECK constraint.
UPDATE crm_contacts       SET relationship_status = 'new' WHERE relationship_status = 'active-campaign';
UPDATE crm_organisations  SET relationship_status = 'new' WHERE relationship_status = 'active-campaign';
UPDATE organizations      SET relationship_status = 'new' WHERE relationship_status = 'active-campaign';

ALTER TABLE crm_contacts DROP CONSTRAINT crm_contacts_relationship_status_check;
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new'));

ALTER TABLE crm_organisations DROP CONSTRAINT crm_organisations_relationship_status_check;
ALTER TABLE crm_organisations ADD CONSTRAINT crm_organisations_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new'));

ALTER TABLE organizations DROP CONSTRAINT organizations_relationship_status_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new'));
