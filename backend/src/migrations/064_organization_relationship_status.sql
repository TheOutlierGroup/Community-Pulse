-- Client status is split into two independent concepts:
--   1. client_status: a simple Current/Previous flag (already exists).
--   2. relationship_status: the CRM-style Warm/Cold/Lost/New/Active
--      Campaign vocabulary, independent of whether the org is a current or
--      previous client.
-- updated_at is added so the Clients table can sort by "Last updated" the
-- same way the Prospects table already does.

ALTER TABLE organizations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE organizations ADD COLUMN relationship_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE organizations ADD CONSTRAINT organizations_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new', 'active-campaign'));
