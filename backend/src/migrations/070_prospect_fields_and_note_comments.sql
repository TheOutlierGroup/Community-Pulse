-- Prospect enrichment: an internal Owner (platform staff responsible for
-- the lead), a Last Contact timestamp, and a generic per-Business-Unit
-- custom_fields blob (starts with Outlier Skate's field set: State, Town,
-- Amount Won so far, Date of Next Audit, Number of Skateparks, Date of
-- Next Strategy Review, Engagement Type). JSONB rather than dedicated
-- columns so future BUs can get their own field sets without a migration
-- each time — validated at the application layer per business_unit.
ALTER TABLE crm_organisations ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crm_organisations ADD COLUMN last_contact_at TIMESTAMPTZ;
ALTER TABLE crm_organisations ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_crm_organisations_owner ON crm_organisations (owner_user_id);

-- A single freeform tag per card (not a full label-management system —
-- crm_organisation_tasks intentionally stays simple; see 060's comment).
ALTER TABLE crm_organisation_tasks ADD COLUMN tag TEXT;

-- Comments on a note — any platform/licensee staff member can comment on
-- or delete any comment within their own org's notes, matching how notes
-- themselves already work (CrmNote.deleteNote scopes by org/contact
-- ownership, not by author).
CREATE TABLE crm_note_comments (
  comment_id   SERIAL PRIMARY KEY,
  note_id      INT NOT NULL REFERENCES crm_notes(note_id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_note_comments_note ON crm_note_comments (note_id);
