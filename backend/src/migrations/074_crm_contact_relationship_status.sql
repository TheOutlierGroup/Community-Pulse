-- A contact's relationship status is independent of the org(s) it's linked
-- to — the same person can be warm even if the deal at their old employer
-- went cold, or vice versa. Same Warm/Cold/Lost/New/Active Campaign
-- vocabulary as crm_organisations/organizations for a consistent badge set.

ALTER TABLE crm_contacts ADD COLUMN relationship_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new', 'active-campaign'));
