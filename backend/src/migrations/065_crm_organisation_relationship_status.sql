-- Prospects get the same Relationship Status vocabulary as Clients, so it
-- can carry through cleanly when a prospect is promoted.

ALTER TABLE crm_organisations ADD COLUMN relationship_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE crm_organisations ADD CONSTRAINT crm_organisations_relationship_status_check
  CHECK (relationship_status IN ('warm', 'cold', 'lost', 'new', 'active-campaign'));
