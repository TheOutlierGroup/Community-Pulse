-- Quizzes: read-only ingestion of WordPress (Formidable) quiz entries, shown as
-- a subtab on a campaign. Quizzes are global to the workspace and linked to
-- campaigns many-to-many (a quiz can run across several campaigns). Entries are
-- never created in-app — admins upload the Formidable CSV; everyone else reads.
CREATE TABLE quizzes (
  quiz_id         SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  platform_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE campaign_quizzes (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, quiz_id)
);

CREATE TABLE quiz_entries (
  entry_id           SERIAL PRIMARY KEY,
  quiz_id            INTEGER NOT NULL REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  -- Formidable's entry ID — the reconciliation key. Re-uploading an export
  -- updates rows in place instead of duplicating.
  external_id        TEXT NOT NULL,
  name               TEXT,
  email              TEXT,
  persona            TEXT,
  change_state       TEXT,
  change_risk        TEXT,
  submitted_at       TIMESTAMPTZ,
  utm_source         TEXT,
  utm_campaign       TEXT,
  utm_medium         TEXT,
  utm_content        TEXT,
  -- Everything else from the export (question answers, scores, IP, keys…) so
  -- nothing is lost; the noisy columns just aren't first-class.
  raw                JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Best-effort link to an existing contact (by email, then unique name).
  -- Nullable — a quiz respondent may not be a contact yet.
  matched_contact_id INTEGER REFERENCES crm_contacts(contact_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quiz_id, external_id)
);

CREATE INDEX idx_quizzes_platform_org ON quizzes(platform_org_id);
CREATE INDEX idx_quiz_entries_quiz ON quiz_entries(quiz_id);
CREATE INDEX idx_campaign_quizzes_quiz ON campaign_quizzes(quiz_id);
