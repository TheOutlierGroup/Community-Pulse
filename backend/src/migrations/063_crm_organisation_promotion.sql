-- CRM: track a "do not contact" flag on prospects, and whether a prospect
-- has been promoted to a real Client organization (and which one).

ALTER TABLE crm_organisations ADD COLUMN do_not_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crm_organisations ADD COLUMN promoted_to_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE crm_organisations ADD COLUMN promoted_at TIMESTAMPTZ;

CREATE INDEX idx_crm_orgs_promoted_to_org ON crm_organisations(promoted_to_org_id);
