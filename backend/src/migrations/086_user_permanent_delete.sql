-- Deactivated users had no way back (they simply vanished from every user
-- list query) and no way to be permanently removed either. Reinstating a
-- deactivated user is just clearing deactivated_at (see reactivateUserInOrg
-- in models/User.js, already used by the re-invite flow). Permanent
-- deletion can't be a real row DELETE though: generated_reports.generated_by
-- references users(id) ON DELETE RESTRICT (migration 029), so any user who
-- ever generated a report would make the delete fail outright, and several
-- other tables reference users(id) ON DELETE SET NULL, which would quietly
-- blank out "who did this" on unrelated historical records. purged_at marks
-- a row that's been scrubbed in place instead: PII cleared, but the row (and
-- every foreign key pointing at it) stays intact.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_org_purged
  ON users (organization_id, purged_at);
